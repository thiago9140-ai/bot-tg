const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Números liberados para teste (formato: 5531999999999)
// Quando quiser abrir para todos, deixe ALLOWED_NUMBERS vazio no .env
const ALLOWED_NUMBERS = process.env.ALLOWED_NUMBERS
  ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim())
  : [];

const SYSTEM_PROMPT = `Você é o atendente virtual da TG, uma vape shop em Belo Horizonte que funciona exclusivamente pelo WhatsApp.

Horário de atendimento: segunda a sábado, das 9h às 21h30.

Como se comportar:
- Responda de forma rápida, direta e simpática
- Não use muitos emojis, apenas quando necessário
- Se o cliente pedir o catálogo, diga que vai enviar em breve e pergunte o que ele procura
- Nunca diga que é um bot ou inteligência artificial
- Se não souber responder algo específico, diga que vai verificar e retornar em breve`;

// Rota que recebe as mensagens via Z-API
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responde imediatamente para o Z-API não reenviar

  const body = req.body;

  // Ignora mensagens enviadas por você mesmo
  if (body.fromMe) return;

  // Ignora mensagens de grupo
  if (body.isGroup || body.isGroupMsg) return;

  // Ignora se não for mensagem de texto
  if (body.type !== 'TEXT') return;

  const phone = body.phone;
  const message = body.text?.message;

  if (!phone || !message) return;

  // Filtra por número permitido (durante testes)
  if (ALLOWED_NUMBERS.length > 0 && !ALLOWED_NUMBERS.includes(phone)) {
    console.log(`[BLOQUEADO] ${phone}`);
    return;
  }

  console.log(`[MENSAGEM] ${phone}: ${message}`);

  try {
    // Chama a API do Claude Haiku
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message }],
    });

    const reply = response.content[0].text;
    console.log(`[RESPOSTA] ${reply}`);

    // Envia a resposta via Z-API
    await axios.post(
      `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/send-text`,
      { phone, message: reply },
      { headers: { 'Client-Token': process.env.ZAPI_CLIENT_TOKEN } }
    );

  } catch (err) {
    console.error('[ERRO]', err.message);
  }
});

app.get('/', (req, res) => res.send('Bot TG rodando ✓'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
