<div align="center">

# ⚡ Subvert AI

**A local OpenAI-compatible proxy for [Ollama Cloud](https://ollama.com) — with a polished web UI.**

Use frontier models (Gemma 4, DeepSeek, Kimi, Qwen, and more) inside **VS Code Copilot**, **Cursor**, **Continue**, or any OpenAI-compatible tool. For a fraction of the cost.

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

</div>

---

## What is this?

Subvert AI runs a tiny local web server that **speaks OpenAI** on one side and **Ollama Cloud** on the other. Your AI coding tools never know the difference — they think they're talking to OpenAI, but all requests go to Ollama Cloud where you get access to dozens of powerful open-weight models.

```
VS Code Copilot  ──►  Subvert AI (localhost:11435)  ──►  Ollama Cloud
     (OpenAI API)           (translates silently)          (your models)
```

It also ships with a **built-in web dashboard** for browsing models, managing settings, and generating ready-to-paste VS Code configs.

---

## Features

- **OpenAI-compatible API** — drop-in replacement for `/v1/chat/completions`, `/v1/models`, and `/v1/embeddings`
- **Streaming support** — real-time token streaming via SSE, just like OpenAI
- **Web dashboard** — browse available models, select them, export VS Code configs with one click
- **Settings UI** — configure your API key and connection from the browser, with a live connection test
- **Dark & light mode** — polished UI with a toggle, theme persisted across sessions
- **VS Code config generator** — select specific models and export a ready-to-paste `settings.json` snippet
- **Hot-reload settings** — change your API key in the UI and the proxy updates instantly, no restart needed
- **Zero build step** — pure Python backend, vanilla HTML/JS frontend

---

## Requirements

- Python **3.10** or newer
- An [Ollama Cloud](https://ollama.com) account and API key
- That's it — no Node, no Docker, no build tools

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/your-username/subvert-ai.git
cd subvert-ai
```

### 2. Create a virtual environment and install dependencies

```bash
# Create venv
python -m venv .venv

# Activate it
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Configure your environment

```bash
cp .env.example .env
```

Open `.env` and fill in your details:

```env
OLLAMA_CLOUD_URL=https://ollama.com
OLLAMA_CLOUD_KEY=your_api_key_here
PORT=11435
HOST=0.0.0.0
```

> **Where do I get an API key?** Sign up at [ollama.com](https://ollama.com), go to your account settings, and generate an API key.

### 4. Start the server

```bash
python main.py
```

You should see:

```
INFO: Ollama-OpenAI proxy starting on port 11435
INFO: Uvicorn running on http://0.0.0.0:11435
```

### 5. Open the dashboard

Visit **[http://localhost:11435](http://localhost:11435)** in your browser to see your models and generate configs.

---

## Connecting to VS Code Copilot

The dashboard's **Export VS Code Config** button does this for you — but here's the manual version.

Open your VS Code `settings.json` (`Ctrl+Shift+P` → *"Open User Settings JSON"*) and add:

```json
{
  "chat.extensionLanguageModelAccess": {
    "github.copilot-chat": {
      "allowed": true
    }
  }
}
```

Then paste the exported config from the dashboard into your `settings.json`. It looks like this:

```json
{
  "name": "Ollama Cloud",
  "vendor": "customendpoint",
  "apiKey": "${input:chat.lm.secret.-7f68f383}",
  "apiType": "chat-completions",
  "models": [
    {
      "id": "gemma4:31b",
      "name": "Gemma 4 31B",
      "url": "http://localhost:11435/v1/chat/completions",
      "toolCalling": true,
      "vision": true,
      "maxInputTokens": 128000,
      "maxOutputTokens": 16000
    }
  ]
}
```

> **Tip:** Use the dashboard to cherry-pick exactly which models you want to expose to Copilot, then click **Export**.

---

## Dashboard Overview

| Page | What it does |
|------|-------------|
| **Dashboard** (`/`) | Shows all available models from Ollama Cloud. Click cards to select them, then export a filtered VS Code config. |
| **Settings** (`/settings`) | Edit your API key, URL, host, and port. Test the connection live and see the full model list on success. |

---

## API Endpoints

These are the proxy endpoints your AI tools talk to:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/models` | List all available models |
| `POST` | `/v1/chat/completions` | Chat completions (streaming + non-streaming) |
| `POST` | `/v1/embeddings` | Embeddings stub |
| `GET` | `/health` | Health check |

Internal UI endpoints (used by the dashboard):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ui/settings` | Read current config (key masked) |
| `POST` | `/ui/settings` | Save config and hot-reload proxy client |
| `POST` | `/ui/test-connection` | Test a URL + key combination |
| `GET` | `/ui/vscode-config` | Generate VS Code config JSON from live models |

---

## Configuration Reference

All config lives in `.env`. Never commit this file — it's in `.gitignore`.

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_CLOUD_URL` | `https://ollama.com` | Ollama Cloud API base URL |
| `OLLAMA_CLOUD_KEY` | *(required)* | Your Ollama Cloud API key |
| `PORT` | `11435` | Local proxy port |
| `HOST` | `0.0.0.0` | Bind address (`0.0.0.0` = all interfaces) |

### Optional: Model Aliasing

If you want to remap model names (e.g. make Copilot's `gpt-4` request route to `gemma4:31b`), edit `MODEL_MAP` in `config.py`:

```python
MODEL_MAP = {
    "gpt-4": "gemma4:31b",
    "gpt-3.5-turbo": "qwen3-coder:480b",
}
```

Leave it empty (the default) to pass model names through unchanged.

---

## Project Structure

```
subvert-ai/
├── main.py              # Shim — delegates to vscode-extension/server/main.py
├── requirements.txt     # Shim — pip -r includes vscode-extension/server/requirements.txt
├── .env.example         # Template for your .env (safe to commit)
├── .env                 # Your actual secrets — NEVER commit this
│
└── vscode-extension/
    └── server/          # Canonical server — shared by the extension and standalone use
        ├── main.py          # FastAPI app — all routes including UI API
        ├── config.py        # Settings, env loading, helpers
        ├── requirements.txt # Python dependencies
        │
        ├── static/
        │   ├── index.html       # Dashboard — model browser + VS Code config export
        │   └── settings.html    # Settings page — connection config + live test
        │
        ├── models/
        │   ├── openai.py        # Pydantic schemas for OpenAI request/response shapes
        │   └── ollama.py        # Pydantic schemas for Ollama request/response shapes
        │
        └── translators/
            ├── openai_to_ollama.py   # Request translation layer
            └── ollama_to_openai.py   # Response translation layer
```

---

## Troubleshooting

**Models list is empty**
→ Check your `OLLAMA_CLOUD_KEY` in `.env` or via the Settings page. Use the **Test Connection** button to verify.

**Copilot shows an auth error**
→ The `apiKey` value in your VS Code config is a VS Code secret input placeholder — VS Code will prompt you to enter it the first time. Enter any non-empty string (the actual auth happens via your Ollama key in the proxy).

**Port 11435 is already in use**
→ Change `PORT` in your `.env` and update the `url` fields in your VS Code config to match.

**Changes to `.env` not taking effect**
→ Restart the server, or use the Settings page in the dashboard — it hot-reloads the connection without a restart.

---

## Contributing

PRs and issues are welcome. Please open an issue first for anything beyond small fixes.

---

## License

MIT — see [LICENSE](LICENSE) for details.
