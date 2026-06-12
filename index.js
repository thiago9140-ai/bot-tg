const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const CATALOGO = require('./catalogo');
require('dotenv').config();

const app = express();
app.use(express.json());

const anthropic = new Anthropic();

// Histórico de conversa por número
const conversationHistory = new Map();

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

const SYSTEM_PROMPT = `Você é o atendente virtual da TG, vape shop que funciona exclusivamente pelo WhatsApp. Não temos loja física e nunca passamos nosso endereço.

HORÁRIO: Segunda a sábado das 9h às 21h30. Domingo das 10h às 18h.
PAGAMENTO: Somente Pix — tgshopbr@gmail.com — sem valor mínimo.
ENTREGA: Somente entrega, frete à parte. Nunca passamos nosso endereço.
PROMOÇÃO COPA 2026: A cada R$200 em compras o cliente ganha um pacote de figurinhas.

COMPORTAMENTO:
- Direto, breve e objetivo
- No máximo 1 emoji por mensagem, só quando necessário
- Nunca diga que é bot ou IA
- Nunca prometa o que não pode garantir
- Quando tiver produto + sabor + endereço: pare e aguarde

SAUDAÇÃO: Quando o cliente cumprimentar, responda apenas a saudação brevemente. O catálogo já será enviado automaticamente pelo sistema.

ENTREGA/RETIRADA: Infelizmente não passamos nosso endereço, mandamos o uber até você

RECOMENDAÇÃO DE SABOR: Indique os mais vendidos + sempre inclua uma opção menta

GARANTIA: Não vai acontecer, mas se vier com defeito resolvemos na hora

PRAZO DE ENTREGA: Pergunte o endereço antes de estimar. Nunca prometa sem ter certeza.

NEGOCIAÇÃO: Se houver promoção informe. Se não houver diga que infelizmente não consegue nesse

FLUXO DO PEDIDO:
1. Cliente mostra interesse: confirme disponibilidade e liste os sabores
2. Produto + sabor + endereço recebidos: pare e aguarde o atendente`;

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
    // Saudação: reseta histórico + responde + envia catálogo
    if (isSaudacao(message)) {
      conversationHistory.delete(phone);
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
      });
      const saudacaoReply = response.content[0].text;
      await enviarMensagem(phone, saudacaoReply);
      await enviarMensagem(phone, CATALOGO);
      console.log(`[SAUDAÇÃO] ${phone}`);
      return;
    }

    // Busca ou cria histórico do cliente
    const history = conversationHistory.get(phone) || [];
    history.push({ role: 'user', content: message });

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history,
    });

    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });

    // Mantém só as últimas 20 mensagens (10 trocas)
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
