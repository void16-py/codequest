/* ==========================================================================
   CodeQuest — Local AI Question Server
   --------------------------------------------------------------------------
   A tiny zero-dependency Node.js server (Node 18+ has built-in fetch).
   It does two jobs:
     1. Serves the game files (codequest.html, questions.js).
     2. Exposes POST /api/question  -> calls an AI provider to generate ONE
        fresh quiz question, keeping your API key safe on the server.

   The browser NEVER sees your key. If no key is set (or the AI call fails),
   the game automatically falls back to the offline question bank, so it
   never shows the "error generating" problem again.

   ------------------------------------------------------------------
   HOW TO RUN
   ------------------------------------------------------------------
   1. Get a FREE key (recommended: Google Gemini, no credit card):
        https://aistudio.google.com/apikey
   2. Set it as an environment variable and start the server:

        macOS / Linux:
          export GEMINI_API_KEY="your_key_here"
          node server.js

        Windows (PowerShell):
          $env:GEMINI_API_KEY="your_key_here"
          node server.js

   3. Open  http://localhost:3000  in your browser.

   (You can also use OpenAI or Anthropic — see PROVIDER config below.)
   ========================================================================== */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

/* ----------------------------------------------------------------
   PROVIDER CONFIG
   Pick automatically based on whichever key is present.
   Priority: Gemini -> OpenAI -> Anthropic.
   ---------------------------------------------------------------- */
const GROQ_KEY      = process.env.GROQ_API_KEY      || '';
const GEMINI_KEY    = process.env.GEMINI_API_KEY    || '';
const OPENAI_KEY    = process.env.OPENAI_API_KEY    || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

let PROVIDER = 'none';
if      (GROQ_KEY)      PROVIDER = 'groq';
else if (GEMINI_KEY)    PROVIDER = 'gemini';
else if (OPENAI_KEY)    PROVIDER = 'openai';
else if (ANTHROPIC_KEY) PROVIDER = 'anthropic';

const GROQ_MODEL      = process.env.GROQ_MODEL      || 'llama-3.3-70b-versatile';
const GEMINI_MODEL    = process.env.GEMINI_MODEL    || 'gemini-2.0-flash';
const OPENAI_MODEL    = process.env.OPENAI_MODEL    || 'gpt-4o-mini';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';

/* ----------------------------------------------------------------
   Build the prompt for a single question.
   ---------------------------------------------------------------- */
function buildPrompt({ lang, diff, topics, recent }) {
  const topicLine = (topics && topics.length)
    ? `Focus ONLY on these specific topics: ${topics.join(', ')}.`
    : 'Cover any common topic from the language.';

  const avoid = (recent && recent.length)
    ? `Do NOT repeat or closely resemble any of these recent questions: ${recent.slice(-6).join(' | ')}.`
    : '';

  return `You are a coding quiz generator for learners.
Generate exactly ONE ${diff}-level ${lang} multiple-choice question.
${topicLine}
${avoid}

Return ONLY raw JSON (no markdown, no code fences, no commentary) in this exact shape:
{"question":"...","code":"","options":["A) ...","B) ...","C) ...","D) ..."],"correct":"A","explanation":"..."}

Rules:
- "code": a short relevant snippet if the question involves reading/predicting code, otherwise "".
- "options": exactly 4 plausible choices, each prefixed "A) ", "B) ", "C) ", "D) ". Exactly one is correct.
- "correct": a single uppercase letter A, B, C, or D matching the correct option.
- "explanation": 1-2 clear sentences explaining why the answer is correct.
- Keep it accurate, self-contained, and appropriate for the ${diff} level.`;
}

/* ----------------------------------------------------------------
   Provider callers — each returns the raw text the model produced.
   ---------------------------------------------------------------- */
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, responseMimeType: 'application/json' }
    })
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

async function callGroq(prompt) {
  // Groq exposes an OpenAI-compatible chat completions endpoint.
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callOpenAI(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map(b => b.text || '').join('');
}

/* ----------------------------------------------------------------
   Parse + validate the model output into a clean question object.
   ---------------------------------------------------------------- */
function parseQuestion(raw) {
  const clean = String(raw || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const p = JSON.parse(clean);

  if (!p.question || !Array.isArray(p.options) || p.options.length < 2 || !p.correct) {
    throw new Error('Malformed question JSON');
  }
  // Normalize: ensure options are prefixed A)/B)/C)/D)
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  p.options = p.options.map((o, i) => {
    const s = String(o).trim();
    return /^[A-Fa-f][).]/.test(s) ? s : `${letters[i]}) ${s}`;
  });
  p.correct = String(p.correct).trim().toUpperCase().charAt(0);
  if (!letters.includes(p.correct)) p.correct = 'A';
  p.code = typeof p.code === 'string' ? p.code : '';
  p.explanation = p.explanation || '';
  return p;
}

async function generateQuestion(body) {
  const prompt = buildPrompt(body);
  let raw;
  if      (PROVIDER === 'groq')      raw = await callGroq(prompt);
  else if (PROVIDER === 'gemini')    raw = await callGemini(prompt);
  else if (PROVIDER === 'openai')    raw = await callOpenAI(prompt);
  else if (PROVIDER === 'anthropic') raw = await callAnthropic(prompt);
  else throw new Error('No AI provider configured');
  return parseQuestion(raw);
}

/* ----------------------------------------------------------------
   Static file serving
   ---------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/codequest.html';
  const filePath = path.join(__dirname, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ----------------------------------------------------------------
   HTTP server
   ---------------------------------------------------------------- */
const server = http.createServer((req, res) => {
  // health / status endpoint -> lets the browser know if AI is available
  if (req.method === 'GET' && req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ai: PROVIDER !== 'none', provider: PROVIDER }));
  }

  if (req.method === 'POST' && req.url === '/api/question') {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(buf || '{}'); } catch (_) {}
      try {
        const q = await generateQuestion(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, question: q, provider: PROVIDER }));
      } catch (e) {
        // Tell the browser to fall back to its offline bank.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log('\n  ⚡  CodeQuest server running');
  console.log(`     →  http://localhost:${PORT}`);
  console.log(`     AI provider: ${PROVIDER === 'none' ? 'NONE (offline bank only)' : PROVIDER}`);
  if (PROVIDER === 'none') {
    console.log('\n  ℹ  No API key found. The game still works using the offline');
    console.log('     question bank. To enable UNLIMITED AI questions, set a key:');
    console.log('       export GROQ_API_KEY="your_key"     (free: https://console.groq.com/keys)');
    console.log('       export GEMINI_API_KEY="your_key"   (free: https://aistudio.google.com/apikey)');
    console.log('     then restart:  node server.js\n');
  } else {
    console.log('     Unlimited AI-generated questions are ENABLED. 🎉\n');
  }
});
