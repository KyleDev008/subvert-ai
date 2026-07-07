"""Translate OpenAI-format chat completion requests to native Ollama API format."""
import os
from typing import Any

DEFAULT_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "32768"))


def translate_chat_request(openai_body: dict) -> dict:
    """Convert an OpenAI ChatCompletion request body to an Ollama /api/chat request.

    Reference: https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion
    """
    ollama_body: dict[str, Any] = {
        "model": openai_body.get("model", "llama3.2"),
        "messages": _translate_messages(openai_body.get("messages", [])),
        "stream": bool(openai_body.get("stream", False)),
    }

    options: dict[str, Any] = {}
    if openai_body.get("temperature") is not None:
        options["temperature"] = float(openai_body["temperature"])
    if openai_body.get("top_p") is not None:
        options["top_p"] = float(openai_body["top_p"])
    if openai_body.get("max_tokens") is not None:
        options["num_predict"] = int(openai_body["max_tokens"])
    if openai_body.get("seed") is not None:
        options["seed"] = int(openai_body["seed"])
    if openai_body.get("stop") is not None:
        stop = openai_body["stop"]
        options["stop"] = [stop] if isinstance(stop, str) else stop

    # Always set num_ctx so Ollama loads the model with a proper context window.
    # Without this, Ollama defaults to 4096 tokens and truncates longer prompts.
    # The value matches maxInputTokens in chatLanguageModels.json (32768) but can
    # be overridden via the OLLAMA_NUM_CTX environment variable.
    options["num_ctx"] = DEFAULT_NUM_CTX

    ollama_body["options"] = options

    return ollama_body


def _translate_messages(messages: list) -> list:
    """Pass messages through — Ollama /api/chat uses the same role/content shape.

    Handle the case where content is a list of content parts (vision messages).
    """
    translated = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if isinstance(content, list):
            text_parts = []
            images = []
            for part in content:
                if isinstance(part, dict):
                    if part.get("type") == "text":
                        text_parts.append(part.get("text", ""))
                    elif part.get("type") == "image_url":
                        url = part.get("image_url", {}).get("url", "")
                        if url.startswith("data:"):
                            # base64 encoded image: data:image/jpeg;base64,<data>
                            b64 = url.split(",", 1)[-1] if "," in url else url
                            images.append(b64)
            entry: dict[str, Any] = {"role": role, "content": " ".join(text_parts)}
            if images:
                entry["images"] = images
            translated.append(entry)
        else:
            translated.append({"role": role, "content": content})

    return translated
