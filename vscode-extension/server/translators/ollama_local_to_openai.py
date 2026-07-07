"""Translate native Ollama API responses to OpenAI-compatible format.

Covers:
  - GET /api/tags  →  OpenAI models list
  - POST /api/chat (non-stream)  →  OpenAI ChatCompletion
  - POST /api/chat (stream)  →  OpenAI SSE chunks
"""
import json
import re
import time
import uuid
from typing import Any

from config import model_id_to_name


# ── Capability heuristics ─────────────────────────────────────────────────────

_VISION_PATTERNS = re.compile(
    r"llava|vision|moondream|minicpm.?v|bakllava|cogvlm|phi.*vision|qwen.*vl|internvl",
    re.IGNORECASE,
)

_TOOL_PATTERNS = re.compile(
    r"qwen|mistral|llama.?3|hermes|functionary|command.?r|firefunction|xwin|nexus",
    re.IGNORECASE,
)

_CONTEXT_128K = re.compile(r"128k|128000", re.IGNORECASE)
_CONTEXT_32K = re.compile(r"32k|32000", re.IGNORECASE)
_CONTEXT_16K = re.compile(r"16k|16000", re.IGNORECASE)


def _infer_capabilities(model_id: str) -> dict[str, Any]:
    """Derive VS Code LM capability hints from the model identifier."""
    vision = bool(_VISION_PATTERNS.search(model_id))
    tool_calling = bool(_TOOL_PATTERNS.search(model_id))

    if _CONTEXT_128K.search(model_id):
        max_input = 128000
    elif _CONTEXT_32K.search(model_id):
        max_input = 32768
    elif _CONTEXT_16K.search(model_id):
        max_input = 16384
    else:
        max_input = 8192

    return {
        "vision": vision,
        "toolCalling": tool_calling,
        "maxInputTokens": max_input,
        "maxOutputTokens": 4096,
    }


# ── Model list ────────────────────────────────────────────────────────────────

def translate_tags_to_models(tags_response: dict, proxy_port: int) -> dict:
    """Convert GET /api/tags response to OpenAI /v1/models format.

    Also returns enriched model metadata for /ui/local-vscode-config.
    """
    models_raw = tags_response.get("models", [])
    proxy_url = f"http://localhost:{proxy_port}/v1/chat/completions"

    models = []
    for m in models_raw:
        model_id = m.get("name", "")
        if not model_id:
            continue
        caps = _infer_capabilities(model_id)
        models.append({
            "id": model_id,
            "object": "model",
            "created": int(time.time()),
            "owned_by": "ollama-local",
            "name": model_id_to_name(model_id),
            # extra fields used by vscode-config endpoint
            "url": proxy_url,
            **caps,
        })

    models.sort(key=lambda m: m["id"].lower())
    return {"object": "list", "data": models}


# ── Non-streaming chat ────────────────────────────────────────────────────────

def translate_chat_response(ollama_response: dict, model: str) -> dict:
    """Convert a non-streaming Ollama /api/chat response to OpenAI ChatCompletion."""
    message = ollama_response.get("message", {})
    content = message.get("content", "")

    prompt_tokens = ollama_response.get("prompt_eval_count", 0) or 0
    completion_tokens = ollama_response.get("eval_count", 0) or 0

    finish_reason = "stop"
    if ollama_response.get("done_reason") == "length":
        finish_reason = "length"

    return {
        "id": f"chatcmpl-local-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content,
                },
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


# ── Streaming chat ────────────────────────────────────────────────────────────

def translate_stream_chunk(ollama_chunk: dict, model: str, chunk_id: str) -> str:
    """Convert one Ollama streaming chunk to an OpenAI SSE data line.

    Returns the full SSE line (including the "data: " prefix and trailing newlines).
    The final chunk (done=True) includes a ``usage`` field so that Copilot's
    context-budget reducer ("lre"/"Yre") does not crash with
    "No lowest priority node found".
    """
    message = ollama_chunk.get("message", {})
    content = message.get("content", "")
    done = ollama_chunk.get("done", False)

    finish_reason = None
    if done:
        done_reason = ollama_chunk.get("done_reason", "stop")
        finish_reason = "length" if done_reason == "length" else "stop"

    openai_chunk: dict = {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": {"role": "assistant", "content": content} if not done else {},
                "finish_reason": finish_reason,
            }
        ],
    }

    if done:
        prompt_tokens = ollama_chunk.get("prompt_eval_count", 0) or 0
        completion_tokens = ollama_chunk.get("eval_count", 0) or 0
        openai_chunk["usage"] = {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        }

    return f"data: {json.dumps(openai_chunk)}\n\n"
