# CodeQuest ⚡ — Learn to Code by Playing

A coding quiz game with **unlimited, AI-generated questions** (plus an offline
fallback so it always works).

## Files
| File | What it is |
|------|-----------|
| `codequest.html` | The game (frontend). |
| `questions.js`   | Offline question bank (used as automatic fallback). |
| `server.js`      | Tiny Node server: serves the game **and** generates fresh AI questions while keeping your API key safe. |

---

## ▶ Quick start (unlimited AI questions)

**1. Get a free API key** (both have free tiers, no credit card):
- **Groq** (fast): https://console.groq.com/keys
- Google Gemini: https://aistudio.google.com/apikey

> 🔒 **Security:** your key is a secret. Only ever put it in the `export`
> command in your own terminal. Never paste it into chat, code, or share it.
> If a key is ever exposed, revoke it and create a new one.

**2. Start the server with your key:**

macOS / Linux:
```bash
export GROQ_API_KEY="your_key_here"
node server.js
```

Windows (PowerShell):
```powershell
$env:GROQ_API_KEY="your_key_here"
node server.js
```

**3. Open** http://localhost:3000

You'll see `Unlimited AI-generated questions are ENABLED 🎉` in the terminal.
Every question is now generated fresh by the AI — effectively infinite.

---

## ▶ Run without a key (offline mode)

Just run:
```bash
node server.js
```
…then open http://localhost:3000. The game uses the built-in question bank.
(You can even open `codequest.html` directly without the server — it falls
back to the offline bank automatically.)

---

## Use a different AI provider
The server auto-detects whichever key is set (priority: Groq → Gemini → OpenAI → Anthropic):

```bash
export GROQ_API_KEY="gsk_..."         # uses llama-3.3-70b-versatile
# or
export OPENAI_API_KEY="sk-..."        # uses gpt-4o-mini
# or
export ANTHROPIC_API_KEY="sk-ant-..." # uses claude-3-5-haiku
```

Override the model if you like:
```bash
export GROQ_MODEL="llama-3.3-70b-versatile"
export GEMINI_MODEL="gemini-2.0-flash"
export OPENAI_MODEL="gpt-4o-mini"
export ANTHROPIC_MODEL="claude-3-5-haiku-20241022"
```

---

## Why a server is required for "unlimited AI"
AI models are only reachable with an **API key**. That key must **never** sit in
browser code (anyone could steal it, and providers block direct browser calls).
`server.js` holds the key privately and is the *only* thing that talks to the AI —
your browser just calls your own `localhost` server. This is also exactly why the
original version errored: it tried to call the AI directly from the browser with no key.

## Requirements
- Node.js 18+ (uses built-in `fetch`). **No `npm install` needed** — zero dependencies.
