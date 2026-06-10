const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const anthropic = new Anthropic();

const ALLOWED_NUMBERS = process.env.ALLOWED_NUMBERS
  ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim())
  : [];

const SYSTEM_PROMPT = `Você é o atendente virtual da TG, uma vape shop em Belo Horizonte que funciona exclusivamente pelo WhatsApp.
Horário de atendimento: segunda a sábado, das 9h às 21h30.
Responda de forma rápida, direta e simpática.
Não use muitos emojis.
Se pedirem catálogo, diga que vai enviar e pergunte o que o cliente procura.
Nunca diga que é um bot ou inteligência artificial.`;

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;

  console.log('[WEBHOOK]', JSON.stringify(body));

  if (body.fromMe) { console.log('[IGNORADO] fromMe'); return; }
  if (body.isGroup || body.isGroupMsg) { console.log('[IGNORADO] grupo'); return; }

  const phone = body.phone;
  const message = body.text?.message;

  console.log('[TIPO]', body.type, '[PHONE]', phone, '[MSG]', message);

  if (!phone || !message) { console.log('[IGNORADO] sem phone ou message'); return; }

  if (ALLOWED_NUMBERS.length > 0 && !ALLOWED_NUMBERS.includes(phone)) {
    console.log(`[BLOQUEADO] ${phone}`);
    return;
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message }],
    });
    const reply = response.content[0].text;
    console.log(`[RESPOSTA] ${reply}`);
    await axios.post(
      `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/send-text`,
      { phone, message: reply },
      { headers: { 'Client-Token': process.env.ZAPI_CLIENT_TOKEN } }
    );
  } catch (err) {
    console.error('[ERRO]', err.message);
  }
});

app.get('/', (req, res) => res.send('Bot TG rodando'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
