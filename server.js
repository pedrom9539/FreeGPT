'use strict';
// Ponte local: serve index.html e guarda a conversa em chat-log.json.
// Apenas escuta em 127.0.0.1. Sem dependências externas.
//
//   node server.js                  -> inicia em http://127.0.0.1:3000
//   GET  /api/messages?after=ID     -> mensagens com id > ID
//   POST /api/messages {text}       -> mensagem do utilizador (página)
//   POST /api/reply    {text}       -> resposta do assistente (curl/terminal)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const DIR = __dirname;
const INDEX = path.join(DIR, 'index.html');
const LOG = path.join(DIR, 'chat-log.json');
const MAX_TEXT = 8000;
const MAX_BODY = 64 * 1024;

function loadLog() {
  try {
    const data = JSON.parse(fs.readFileSync(LOG, 'utf8'));
    if (Array.isArray(data.messages)) return data;
  } catch { /* ficheiro inexistente ou corrompido */ }
  return { nextId: 1, messages: [] };
}

let log = loadLog();

function saveLog() {
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2));
}

function addMessage(role, text) {
  const msg = { id: log.nextId++, role, text, ts: Date.now() };
  log.messages.push(msg);
  saveLog();
  return msg;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = (typeof body === 'string' || Buffer.isBuffer(body)) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Pedido demasiado grande.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('JSON inválido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(INDEX), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/api/messages') {
      const after = Number(url.searchParams.get('after')) || 0;
      const messages = log.messages.filter((m) => m.id > after);
      return send(res, 200, { messages, last: log.nextId - 1 });
    }

    if (req.method === 'POST' && (url.pathname === '/api/messages' || url.pathname === '/api/reply')) {
      const body = await readJson(req);
      const text = cleanText(body.text);
      if (!text) return send(res, 400, { error: 'Mensagem vazia.' });
      if (text.length > MAX_TEXT) return send(res, 413, { error: `Limite de ${MAX_TEXT} caracteres excedido.` });
      const role = url.pathname === '/api/reply' ? 'assistant' : 'user';
      const msg = addMessage(role, text);
      return send(res, 201, msg);
    }

    return send(res, 404, { error: 'Não encontrado.' });
  } catch (err) {
    const status = err.status || 500;
    return send(res, status, { error: err.message || 'Erro interno.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ponte em http://${HOST}:${PORT}  (log: ${path.basename(LOG)})`);
});
