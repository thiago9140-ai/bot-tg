const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const CATALOGO = require('./catalogo');
require('dotenv').config();

const app = express();
app.use(express.json());

const anthropic = new Anthropic();

// Histórico e estado por número
const conversationHistory = new Map();
const pedidoCompleto = new Set(); // números que já fecharam pedido

const ADMIN_NUMBER = process.env.ADMIN_NUMBER || '';

const SAUDACOES = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hello', 'hi', 'e aí', 'eai', 'oii', 'oiii', 'opa', 'salve'];

function isSaudacao(msg) {
  const lower = msg.toLowerCase().trim();
  return SAUDACOES.some(s => lower === s || lower.startsWith(s + ' ') || lower.startsWith(s + '!') || lower.startsWith(s + ','));
}

async function enviarMensagem(phone, message) {
  await axios.post(
    `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/send-text`,
    { phone, message },
    { headers: { 'Client-Token': process.env.ZAPI_CLIENT_TOKEN } }
  );
}

const ALLOWED_NUMBERS = process.env.ALLOWED_NUMBERS
  ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim())
  : [];

const SYSTEM_PROMPT = `Você é o atendente da TG, vape shop que funciona exclusivamente por WhatsApp e entrega. Não temos loja física e nunca passamos nosso endereço.

REGRAS DE OURO:
- Seja MUITO breve, direto e objetivo. Sem enrolação.
- NUNCA elogie o pedido ("ótima escolha", "um dos mais vendidos", "vape maneiro"). Não somos sommelier de pod, cada um tem seu gosto.
- NUNCA diga que é bot, IA ou que está "processando" ou "aguardando atendente".
- Máximo 1 emoji por mensagem, e só quando fizer sentido.
- Faça UMA pergunta por vez, curta.

INFORMAÇÕES:
- HORÁRIO: Seg a sáb 9h-21h30. Dom 10h-18h.
- PAGAMENTO: Somente Pix — tgshopbr@gmail.com — sem mínimo.
- ENTREGA: Todos os envios são IMEDIATOS. Nunca diga que não consegue entregar "pra agora" — sempre entregamos na hora. Frete à parte.
- PROMOÇÃO COPA: A cada R$200 ganha um pacote de figurinhas.

ENVIO IMEDIATO: Se o cliente pedir "pra agora" ou "imediato", confirme que sim, enviamos na hora. Nunca crie dificuldade.

ENTREGA/ENDEREÇO: "Infelizmente não passamos nosso endereço, mandamos o uber até você."

PRODUTO GENÉRICO: Se o cliente falar só a marca ou sabor sem o modelo (ex: "ignite de menta"), pergunte direto o modelo de forma curta: "Ok, de quantos puffs?". Sem elogiar.

ERRO DE DIGITAÇÃO E VARIAÇÕES: Reconheça erros de digitação e variações. Ex: "triple mando" = "triple mango", que é variação do V400 Sweet e TEMOS em estoque. Não negue produtos que existem no catálogo. Na dúvida, assuma a variação mais próxima que existe.

PRODUTO INDISPONÍVEL: Só se realmente não existir no catálogo. Aí diga curto: "Esse não tenho. Tem algum outro que você prefira?" Sem oferecer "ver o catálogo" repetidamente.

GARANTIA: "Não vai acontecer, mas se vier com defeito resolvemos na hora."

FLUXO:
1. Cliente quer um produto → confirme o modelo se faltar, de forma curta.
2. Modelo definido → pergunte o sabor (se aplicável) ou o endereço.
3. Quando tiver PRODUTO + ENDEREÇO definidos, responda APENAS com a tag interna: [PEDIDO_COMPLETO] e nada mais. Não escreva mais nada para o cliente.

NUNCA repita informação que já foi dada na conversa.`;

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;

  if (body.fromMe) return;
  if (body.isGroup || body.isGroupMsg) return;
  if (body.type !== 'ReceivedCallback') return;

  const phone = body.phone;
  const message = body.text?.message;

  if (!phone || !message) return;

  if (ALLOWED_NUMBERS.length > 0) {
    const normalizedPhone = phone.replace(/^(\d{4})9(\d{8})$/, '$1$2');
    const normalizedList = ALLOWED_NUMBERS.map(n => n.replace(/^(\d{4})9(\d{8})$/, '$1$2'));
    if (!normalizedList.includes(normalizedPhone)) {
      console.log(`[BLOQUEADO] ${phone}`);
      return;
    }
  }

  console.log(`[MENSAGEM] ${phone}: ${message}`);

  try {
    // Saudação: reseta tudo, responde e manda catálogo
    if (isSaudacao(message)) {
      conversationHistory.delete(phone);
      pedidoCompleto.delete(phone);
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
      });
      const saudacaoReply = response.content[0].text;
      await enviarMensagem(phone, saudacaoReply);
      await enviarMensagem(phone, CATALOGO);
      console.log(`[SAUDAÇÃO] ${phone}`);
      return;
    }

    // Se o pedido já está completo, bot fica em silêncio (atendente assume)
    if (pedidoCompleto.has(phone)) {
      console.log(`[SILÊNCIO] ${phone} já tem pedido completo`);
      return;
    }

    // Conversa normal com histórico
    const history = conversationHistory.get(phone) || [];
    history.push({ role: 'user', content: message });

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: history,
    });

    const reply = response.content[0].text;

    // Pedido completo detectado
    if (reply.includes('[PEDIDO_COMPLETO]')) {
      pedidoCompleto.add(phone);
      conversationHistory.delete(phone);

      // Monta resumo da conversa para o admin
      const resumoConversa = history
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .join(' | ');

      if (ADMIN_NUMBER) {
        await enviarMensagem(
          ADMIN_NUMBER,
          `🔔 RESPONDER CLIENTE\n\nNúmero: ${phone}\n\nConversa: ${resumoConversa}\n\n→ Calcular frete e enviar total + Pix`
        );
      }
      console.log(`[PEDIDO COMPLETO] ${phone} — admin avisado`);
      return;
    }

    history.push({ role: 'assistant', content: reply });
    if (history.length > 20) history.splice(0, 2);
    conversationHistory.set(phone, history);

    console.log(`[RESPOSTA] ${phone}: ${reply}`);
    await enviarMensagem(phone, reply);

  } catch (err) {
    console.error('[ERRO]', err.message);
  }
});

app.get('/', (req, res) => res.send('Bot TG rodando'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
