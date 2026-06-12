const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const CATALOGO = require('./catalogo');
require('dotenv').config();

const app = express();
app.use(express.json());

const anthropic = new Anthropic();

const SAUDACOES = ['oi', 'olÃ¡', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hello', 'hi', 'e aÃ­', 'eai', 'oii', 'oiii', 'opa', 'salve'];

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

const SYSTEM_PROMPT = `VocÃª Ã© o atendente virtual da TG, vape shop que funciona exclusivamente pelo WhatsApp. NÃ£o temos loja fÃ­sica e nunca passamos nosso endereÃ§o.

HORÃRIO: Segunda a sÃ¡bado das 9h Ã s 21h30. Domingo das 10h Ã s 18h.
PAGAMENTO: Somente Pix â€” tgshopbr@gmail.com â€” sem valor mÃ­nimo.
ENTREGA: Somente entrega, frete Ã  parte. Nunca passamos nosso endereÃ§o.
PROMOÃ‡ÃƒO COPA 2026: A cada R$200 em compras o cliente ganha um pacote de figurinhas.

COMPORTAMENTO:
- Direto, breve e objetivo
- No mÃ¡ximo 1 emoji por mensagem, sÃ³ quando necessÃ¡rio
- Nunca diga que Ã© bot ou IA
- Nunca prometa o que nÃ£o pode garantir
- Sem mensagens de aguarde ou estou calculando
- Quando tiver produto + sabor + endereÃ§o: pare e aguarde

SAUDAÃ‡ÃƒO: Quando o cliente cumprimentar, responda apenas a saudaÃ§Ã£o brevemente. O catÃ¡logo jÃ¡ serÃ¡ enviado automaticamente pelo sistema.

ENTREGA/RETIRADA: Infelizmente nÃ£o passamos nosso endereÃ§o, mandamos o uber atÃ© vocÃª

RECOMENDAÃ‡ÃƒO DE SABOR: Indique os mais vendidos + sempre inclua uma opÃ§Ã£o menta

GARANTIA: NÃ£o vai acontecer, mas se vier com defeito resolvemos na hora

PRAZO DE ENTREGA: Pergunte o endereÃ§o antes de estimar. Nunca prometa sem ter certeza.

NEGOCIAÃ‡ÃƒO: Se houver promoÃ§Ã£o informe. Se nÃ£o houver diga que infelizmente nÃ£o consegue nesse

FLUXO DO PEDIDO:
1. Cliente mostra interesse: confirme disponibilidade e liste os sabores
2. Produto + sabor + endereÃ§o recebidos: pare e aguarde o atendente`;

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
    if (isSaudacao(message)) {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
      });
      const saudacaoReply = response.content[0].text;
      await enviarMensagem(phone, saudacaoReply);
      await enviarMensagem(phone, CATALOGO);
      console.log(`[SAUDAÃ‡ÃƒO] Respondido + catÃ¡logo enviado`);
      return;
    }

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message }],
    });

    const reply = response.content[0].text;
    console.log(`[RESPOSTA] ${reply}`);
    await enviarMensagem(phone, reply);

  } catch (err) {
    console.error('[ERRO]', err.message);
  }
});

app.get('/', (req, res) => res.send('Bot TG rodando'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
