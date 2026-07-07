"""Main FastAPI application for Ollama-OpenAI proxy server."""
import json
import logging
import os
import threading
import time as _time
import uuid
from pathlib import Path
from typing import AsyncGenerator, Optional
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import (
    OLLAMA_CLOUD_URL, OLLAMA_CLOUD_KEY, PORT, DEFAULT_MODEL,
    LOCAL_OLLAMA_URL, LOCAL_OLLAMA_PORT, LOCAL_OLLAMA_ENABLED,
    LOCAL_TOOL_MODE,
    get_current_settings, save_settings, model_id_to_name,
    get_active_key, get_api_keys,
)
from models.openai import (
    OpenAIChatRequest,
    OpenAIModelsResponse,
    OpenAIModel,
    OpenAIErrorResponse,
    OpenAIErrorDetail,
)
from translators.openai_to_ollama_local import translate_chat_request
from translators.ollama_local_to_openai import (
    translate_tags_to_models,
    translate_chat_response,
    translate_stream_chunk,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# HTTP client for Ollama Cloud
httpx_client: Optional[httpx.AsyncClient] = None

# HTTP client for local Ollama
local_httpx_client: Optional[httpx.AsyncClient] = None

# Tracks whether the local proxy thread has been started
_local_proxy_started: bool = False


async def _rebuild_client() -> None:
    """Replace the global httpx_client with fresh credentials from config."""
    global httpx_client
    if httpx_client:
        await httpx_client.aclose()
    url = os.getenv("OLLAMA_CLOUD_URL", OLLAMA_CLOUD_URL)
    key = get_active_key()
    httpx_client = httpx.AsyncClient(
        base_url=url,
        timeout=httpx.Timeout(300.0, connect=30.0),
        headers={
            "Authorization": f"Bearer {key}" if key else "",
            "Content-Type": "application/json",
        },
        follow_redirects=True,
    )
    logger.info(f"HTTP client rebuilt. URL={url} key={'*set*' if key else '*unset*'}")


async def _rebuild_local_client() -> None:
    """Replace the global local_httpx_client with fresh settings from config.

    Also starts the local proxy thread if LOCAL_OLLAMA_ENABLED is true and
    the thread has not been started yet (handles the case where the user
    enables local Ollama from the UI after the server is already running).
    """
    global local_httpx_client, _local_proxy_started
    if local_httpx_client:
        await local_httpx_client.aclose()
    url = os.getenv("LOCAL_OLLAMA_URL", LOCAL_OLLAMA_URL)
    local_httpx_client = httpx.AsyncClient(
        base_url=url,
        timeout=httpx.Timeout(300.0, connect=10.0),
        headers={"Content-Type": "application/json"},
        follow_redirects=True,
    )
    logger.info(f"Local Ollama HTTP client rebuilt. URL={url}")

    enabled = os.getenv("LOCAL_OLLAMA_ENABLED", "false").lower() in ("true", "1", "yes")
    if enabled and not _local_proxy_started:
        _local_proxy_started = True
        local_thread = threading.Thread(target=_run_local_server, daemon=True)
        local_thread.start()
        logger.info(
            f"Local Ollama proxy thread started on port "
            f"{os.getenv('LOCAL_OLLAMA_PORT', str(LOCAL_OLLAMA_PORT))}"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    await _rebuild_client()
    await _rebuild_local_client()
    logger.info(f"Ollama-OpenAI proxy starting on port {PORT}")
    logger.info(f"Ollama Cloud URL: {OLLAMA_CLOUD_URL}")
    yield
    if httpx_client:
        await httpx_client.aclose()
    if local_httpx_client:
        await local_httpx_client.aclose()
    logger.info("Ollama-OpenAI proxy shutting down")


@asynccontextmanager
async def local_lifespan(app: FastAPI):
    """Manage local proxy application lifespan."""
    await _rebuild_local_client()
    local_port = int(os.getenv("LOCAL_OLLAMA_PORT", str(LOCAL_OLLAMA_PORT)))
    local_url = os.getenv("LOCAL_OLLAMA_URL", LOCAL_OLLAMA_URL)
    logger.info(f"Local Ollama proxy starting on port {local_port}")
    logger.info(f"Local Ollama URL: {local_url}")
    yield
    logger.info("Local Ollama proxy shutting down")


app = FastAPI(
    title="Ollama-OpenAI Proxy",
    description="A proxy server that translates between OpenAI API and Ollama Cloud",
    version="1.0.0",
    lifespan=lifespan,
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle all unhandled exceptions."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    error_response = OpenAIErrorResponse(
        error=OpenAIErrorDetail(
            message=str(exc),
            type="internal_error",
        )
    )
    return JSONResponse(
        status_code=500,
        content=error_response.model_dump(),
    )


@app.get("/v1/models")
async def list_models() -> OpenAIModelsResponse:
    """Fetch models from Ollama Cloud and return in OpenAI format."""
    logger.info("GET /v1/models - fetching from Ollama Cloud")

    try:
        response = await httpx_client.get("/v1/models")
        if response.status_code != 200:
            logger.error(f"Failed to fetch models: {response.status_code} - {response.text}")
            return OpenAIModelsResponse(data=[
                OpenAIModel(id=DEFAULT_MODEL, owned_by="ollama"),
            ])

        ollama_data = response.json()
        models_data = ollama_data.get("data", [])

        models = []
        for model_data in models_data:
            if isinstance(model_data, dict) and "id" in model_data:
                models.append(OpenAIModel(
                    id=model_data["id"],
                    owned_by=model_data.get("owned_by", "ollama"),
                ))

        if not models:
            logger.warning(f"No models found in response. Raw data: {ollama_data}")
            models = [OpenAIModel(id=DEFAULT_MODEL, owned_by="ollama")]

        models.sort(key=lambda m: m.id.lower())
        logger.info(f"Returning {len(models)} models from Ollama Cloud")
        return OpenAIModelsResponse(data=models)

    except Exception as e:
        logger.error(f"Error fetching models: {e}", exc_info=True)
        return OpenAIModelsResponse(data=[
            OpenAIModel(id=DEFAULT_MODEL, owned_by="ollama"),
        ])


def _remap_model(model: str) -> str:
    """Return an Ollama-compatible model ID.

    Copilot sends internal model IDs (e.g. ``gpt-4o-mini-2024-07-18``) for
    housekeeping requests like title generation.  These are not valid Ollama
    model identifiers and cause a 400 from Ollama Cloud.  Map them to the
    configured default so all requests succeed.
    """
    default = DEFAULT_MODEL
    known_prefixes = ("llama", "mistral", "qwen", "gemma", "phi", "deepseek",
                      "codellama", "vicuna", "falcon", "orca", "solar",
                      "nous", "wizardlm", "dolphin", "tinyllama", "stablelm",
                      "neural", "openchat", "yarn", "kimi", "cogito",
                      "devstral", "minimax", "glm", "gemini", "nemotron",
                      "ministral", "gpt-oss")
    if any(model.lower().startswith(p) for p in known_prefixes):
        return model
    logger.info(f"Remapping unknown model '{model}' → '{default}'")
    return default


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    """Handle chat completion requests with streaming support."""
    try:
        body = await request.json()
        original_model = body.get("model", DEFAULT_MODEL)
        remapped_model = _remap_model(original_model)
        if remapped_model != original_model:
            body = dict(body)
            body["model"] = remapped_model
        logger.info(f"POST /v1/chat/completions - model: {original_model}" +
                    (f" → {remapped_model}" if remapped_model != original_model else ""))

        openai_request = OpenAIChatRequest(**body)

        if openai_request.stream:
            return StreamingResponse(
                stream_chat(body, openai_request.model),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )
        else:
            return await non_stream_chat(body, openai_request.model)

    except Exception as e:
        logger.error(f"Error in chat_completions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def stream_chat(request_body: dict, original_model: str) -> AsyncGenerator[str, None]:
    """Stream chat completions from Ollama Cloud.

    Intercepts the SSE stream to ensure a proper terminal chunk with
    finish_reason and usage is always present before [DONE].  Copilot's
    context-budget reducer ("lre") crashes if those fields are absent.
    """
    try:
        logger.debug(f"Streaming request to Ollama: {json.dumps(request_body)}")

        async with httpx_client.stream(
            "POST",
            "/v1/chat/completions",
            json=request_body,
        ) as response:
            if response.status_code != 200:
                error_text = await response.aread()
                logger.error(f"Ollama error: {response.status_code} - {error_text}")
                error_data = OpenAIErrorResponse(
                    error=OpenAIErrorDetail(
                        message=f"Ollama Cloud error: {error_text.decode()}",
                        type="api_error",
                        code=str(response.status_code),
                    )
                )
                yield f'data: {error_data.model_dump_json()}\n\n'
                yield 'data: [DONE]\n\n'
                return

            chunk_id: str = f"chatcmpl-{uuid.uuid4().hex[:12]}"
            saw_finish: bool = False
            saw_usage: bool = False

            async for line in response.aiter_lines():
                if not line:
                    continue
                if line == "data: [DONE]":
                    break
                if not line.startswith("data: "):
                    yield f'{line}\n\n'
                    continue
                try:
                    chunk = json.loads(line[6:])
                    # Track whether upstream already sent finish_reason / usage
                    for choice in chunk.get("choices", []):
                        if choice.get("finish_reason"):
                            saw_finish = True
                    if chunk.get("usage"):
                        saw_usage = True
                    chunk_id = chunk.get("id", chunk_id)
                    yield f'{line}\n\n'
                except json.JSONDecodeError:
                    yield f'{line}\n\n'

            # Inject a terminal chunk if upstream omitted finish_reason or usage
            if not saw_finish or not saw_usage:
                terminal: dict = {
                    "id": chunk_id,
                    "object": "chat.completion.chunk",
                    "created": int(_time.time()),
                    "model": original_model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                }
                if not saw_usage:
                    terminal["usage"] = {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                    }
                yield f'data: {json.dumps(terminal)}\n\n'

            yield 'data: [DONE]\n\n'

    except Exception as e:
        logger.error(f"Error in stream_chat: {e}", exc_info=True)
        error_data = OpenAIErrorResponse(
            error=OpenAIErrorDetail(
                message=str(e),
                type="internal_error",
            )
        )
        yield f'data: {error_data.model_dump_json()}\n\n'
        yield 'data: [DONE]\n\n'


async def non_stream_chat(request_body: dict, original_model: str) -> Response:
    """Non-streaming chat completion from Ollama Cloud - pass through."""
    try:
        logger.debug(f"Non-streaming request to Ollama: {json.dumps(request_body)}")

        response = await httpx_client.post(
            "/v1/chat/completions",
            json=request_body,
        )

        if response.status_code != 200:
            logger.error(f"Ollama error: {response.status_code} - {response.text}")
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Ollama Cloud error: {response.text}",
            )

        return JSONResponse(content=response.json())

    except Exception as e:
        logger.error(f"Error in non_stream_chat: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/embeddings")
async def create_embeddings(request: Request):
    """Stub for embeddings endpoint."""
    logger.info("POST /v1/embeddings - stub")
    body = await request.json()

    return JSONResponse(content={
        "object": "list",
        "data": [
            {
                "object": "embedding",
                "embedding": [0.0] * 1536,
                "index": 0,
            }
        ],
        "model": body.get("model", "text-embedding-ada-002"),
        "usage": {
            "prompt_tokens": 0,
            "total_tokens": 0,
        },
    })


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "ollama-openai-proxy"}


# ── UI API routes ────────────────────────────────────────────────────────────

@app.get("/ui/settings")
async def ui_get_settings():
    """Return current configuration (key is masked for display)."""
    settings = get_current_settings()
    display = dict(settings)
    key = display.get("ollama_cloud_key", "")
    if key:
        display["ollama_cloud_key"] = key[:6] + "•" * max(0, len(key) - 6)
    return JSONResponse(content=display)


@app.get("/ui/settings/raw")
async def ui_get_settings_raw():
    """Return current configuration with full key (for form pre-fill)."""
    return JSONResponse(content=get_current_settings())


@app.post("/ui/settings")
async def ui_save_settings(request: Request):
    """Persist configuration to .env."""
    body = await request.json()
    allowed = {"ollama_cloud_url", "ollama_cloud_key", "port", "host", "multi_mode"}
    filtered = {k: v for k, v in body.items() if k in allowed}
    save_settings(filtered)
    await _rebuild_client()
    logger.info(f"Settings updated. New Ollama Cloud URL: {os.getenv('OLLAMA_CLOUD_URL', OLLAMA_CLOUD_URL)}")
    return JSONResponse(content={"message": "Settings saved. Proxy client refreshed.", "ok": True})


@app.post("/ui/test-connection")
async def ui_test_connection(request: Request):
    """Test connectivity to a given Ollama Cloud URL + key."""
    body = await request.json()
    url = body.get("ollama_cloud_url", "").strip() or os.getenv("OLLAMA_CLOUD_URL", OLLAMA_CLOUD_URL)
    key = body.get("ollama_cloud_key", "").strip() or os.getenv("OLLAMA_CLOUD_KEY", OLLAMA_CLOUD_KEY)
    if "•" in key:
        key = os.getenv("OLLAMA_CLOUD_KEY", OLLAMA_CLOUD_KEY)

    if not key:
        return JSONResponse(content={
            "success": False,
            "error": "No API key provided. An API key is required to authenticate with Ollama Cloud.",
        })

    try:
        async with httpx.AsyncClient(
            base_url=url,
            timeout=httpx.Timeout(20.0, connect=10.0),
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            follow_redirects=True,
        ) as client:
            first_model = None
            models_resp = await client.get("/v1/models")
            if models_resp.status_code == 200:
                raw_models = models_resp.json().get("data", [])
                if raw_models and isinstance(raw_models[0], dict):
                    first_model = raw_models[0].get("id")

            auth_resp = await client.post("/v1/chat/completions", json={
                "model": first_model or "llama3.2",
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 1,
            })

            if auth_resp.status_code in (401, 403):
                return JSONResponse(content={
                    "success": False,
                    "error": f"Authentication failed (HTTP {auth_resp.status_code}): invalid or expired API key.",
                })

            if models_resp.status_code != 200:
                return JSONResponse(content={
                    "success": False,
                    "error": f"HTTP {models_resp.status_code}: {models_resp.text[:500]}",
                })

            models = [
                {
                    "id": m["id"],
                    "name": model_id_to_name(m["id"]),
                    "owned_by": m.get("owned_by", "ollama"),
                }
                for m in models_resp.json().get("data", []) if isinstance(m, dict) and "id" in m
            ]
            models.sort(key=lambda m: m["id"].lower())
            return JSONResponse(content={
                "success": True,
                "model_count": len(models),
                "models": models,
            })
    except Exception as e:
        logger.error(f"Test connection error: {e}", exc_info=True)
        return JSONResponse(content={"success": False, "error": str(e)})


@app.get("/ui/vscode-config")
async def ui_vscode_config():
    """Generate VS Code LM config from live models."""
    settings = get_current_settings()
    proxy_port = settings.get("port", PORT)
    proxy_url = f"http://localhost:{proxy_port}/v1/chat/completions"

    try:
        resp = await httpx_client.get("/v1/models")
        raw = resp.json().get("data", []) if resp.status_code == 200 else []
    except Exception:
        raw = []

    models_list = []
    for m in raw:
        if isinstance(m, dict) and "id" in m:
            models_list.append({
                "id": m["id"],
                "name": model_id_to_name(m["id"]),
                "url": proxy_url,
                "toolCalling": True,
                "vision": True,
                "maxInputTokens": 128000,
                "maxOutputTokens": 16000,
            })
    models_list.sort(key=lambda m: m["id"].lower())

    config = {
        "name": "Ollama Cloud",
        "vendor": "customendpoint",
        "apiKey": "${input:chat.lm.secret.-7f68f383}",
        "apiType": "chat-completions",
        "models": models_list,
    }
    return JSONResponse(content=config)


# ── Multi-Mode key management ───────────────────────────────────────────────

@app.get("/ui/keys")
async def ui_list_keys():
    """Return the named API key list (keys are masked) and which index is active."""
    keys = get_api_keys()
    masked = [
        {"name": e.get("name", ""), "key": (e["key"][:6] + "•" * max(0, len(e["key"]) - 6)) if e.get("key") else ""}
        for e in keys
    ]
    return JSONResponse(content={
        "multi_mode": os.getenv("MULTI_MODE", "false").lower() == "true",
        "active_index": int(os.getenv("ACTIVE_KEY_INDEX", "0")),
        "keys": masked,
    })


@app.post("/ui/keys")
async def ui_add_key(request: Request):
    """Append a new named key to the list."""
    body = await request.json()
    name = str(body.get("name", "")).strip()
    key = str(body.get("key", "")).strip()
    if not name or not key:
        return JSONResponse(status_code=400, content={"error": "Both 'name' and 'key' are required."})
    keys = get_api_keys()
    keys.append({"name": name, "key": key})
    save_settings({"api_keys": keys})
    return JSONResponse(content={"ok": True, "index": len(keys) - 1, "total": len(keys)})


@app.delete("/ui/keys/{index}")
async def ui_delete_key(index: int):
    """Remove a key by index. Adjusts active_index if necessary."""
    keys = get_api_keys()
    if index < 0 or index >= len(keys):
        return JSONResponse(status_code=404, content={"error": "Index out of range."})
    keys.pop(index)
    active = int(os.getenv("ACTIVE_KEY_INDEX", "0"))
    if active >= len(keys):
        active = max(0, len(keys) - 1)
    save_settings({"api_keys": keys, "active_key_index": active})
    await _rebuild_client()
    return JSONResponse(content={"ok": True, "active_index": active, "total": len(keys)})


@app.post("/ui/keys/{index}/activate")
async def ui_activate_key(index: int):
    """Switch the active key to the given index and rebuild the proxy client."""
    keys = get_api_keys()
    if index < 0 or index >= len(keys):
        return JSONResponse(status_code=404, content={"error": "Index out of range."})
    save_settings({"active_key_index": index})
    await _rebuild_client()
    active_name = keys[index].get("name", str(index))
    logger.info(f"Switched active key to index {index} ('{active_name}')")
    return JSONResponse(content={"ok": True, "active_index": index, "active_name": active_name})


# ── Local Ollama UI API routes (on the main cloud app) ──────────────────────

@app.get("/ui/local-settings")
async def ui_get_local_settings():
    """Return current local Ollama configuration."""
    settings = get_current_settings()
    return JSONResponse(content={
        "local_ollama_url": settings.get("local_ollama_url", LOCAL_OLLAMA_URL),
        "local_ollama_port": settings.get("local_ollama_port", LOCAL_OLLAMA_PORT),
        "local_ollama_enabled": settings.get("local_ollama_enabled", False),
        "local_tool_mode": settings.get("local_tool_mode", LOCAL_TOOL_MODE),
    })


@app.post("/ui/local-settings")
async def ui_save_local_settings(request: Request):
    """Persist local Ollama configuration to .env and rebuild the local client."""
    body = await request.json()
    allowed = {"local_ollama_url", "local_ollama_port", "local_ollama_enabled", "local_tool_mode"}
    filtered = {k: v for k, v in body.items() if k in allowed}
    save_settings(filtered)
    await _rebuild_local_client()
    logger.info(f"Local Ollama settings updated. URL={os.getenv('LOCAL_OLLAMA_URL', LOCAL_OLLAMA_URL)}")
    return JSONResponse(content={"message": "Local Ollama settings saved.", "ok": True})


@app.post("/ui/test-local-connection")
async def ui_test_local_connection(request: Request):
    """Test reachability of local Ollama and return available models."""
    body = await request.json()
    url = body.get("local_ollama_url", "").strip() or os.getenv("LOCAL_OLLAMA_URL", LOCAL_OLLAMA_URL)
    proxy_port = int(os.getenv("LOCAL_OLLAMA_PORT", str(LOCAL_OLLAMA_PORT)))

    try:
        async with httpx.AsyncClient(
            base_url=url,
            timeout=httpx.Timeout(10.0, connect=5.0),
            follow_redirects=True,
        ) as client:
            resp = await client.get("/api/tags")
            if resp.status_code != 200:
                return JSONResponse(content={
                    "success": False,
                    "error": f"HTTP {resp.status_code}: {resp.text[:500]}",
                })
            tags = resp.json()
            enriched = translate_tags_to_models(tags, proxy_port)
            models = [
                {
                    "id": m["id"],
                    "name": m.get("name", model_id_to_name(m["id"])),
                    "owned_by": "ollama-local",
                    "vision": m.get("vision", False),
                    "toolCalling": m.get("toolCalling", False),
                    "maxInputTokens": m.get("maxInputTokens", 8192),
                    "maxOutputTokens": m.get("maxOutputTokens", 4096),
                }
                for m in enriched["data"]
            ]
            return JSONResponse(content={
                "success": True,
                "model_count": len(models),
                "models": models,
            })
    except Exception as e:
        logger.error(f"Test local connection error: {e}", exc_info=True)
        return JSONResponse(content={"success": False, "error": str(e)})


@app.get("/ui/local-vscode-config")
async def ui_local_vscode_config():
    """Generate VS Code LM config for local Ollama models."""
    settings = get_current_settings()
    proxy_port = settings.get("local_ollama_port", LOCAL_OLLAMA_PORT)
    proxy_url = f"http://localhost:{proxy_port}/v1/chat/completions"
    local_url = settings.get("local_ollama_url", LOCAL_OLLAMA_URL)

    try:
        async with httpx.AsyncClient(
            base_url=local_url,
            timeout=httpx.Timeout(10.0, connect=5.0),
            follow_redirects=True,
        ) as client:
            resp = await client.get("/api/tags")
            tags = resp.json() if resp.status_code == 200 else {"models": []}
    except Exception:
        tags = {"models": []}

    enriched = translate_tags_to_models(tags, proxy_port)
    models_list = [
        {
            "id": m["id"],
            "name": m.get("name", model_id_to_name(m["id"])),
            "url": proxy_url,
            "toolCalling": m.get("toolCalling", False),
            "vision": m.get("vision", False),
            "maxInputTokens": m.get("maxInputTokens", 8192),
            "maxOutputTokens": m.get("maxOutputTokens", 4096),
        }
        for m in enriched["data"]
    ]

    config = {
        "name": "Ollama Local",
        "vendor": "customendpoint",
        "apiKey": "local",
        "apiType": "chat-completions",
        "models": models_list,
    }
    return JSONResponse(content=config)


# ── Static UI (must be last to avoid catching API routes) ───────────────────
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")


# ── Local Ollama proxy app ───────────────────────────────────────────────────

local_app = FastAPI(
    title="Ollama Local Proxy",
    description="Proxy server bridging local Ollama to the OpenAI-compatible API",
    version="1.0.0",
    lifespan=local_lifespan,
)


@local_app.exception_handler(Exception)
async def local_global_exception_handler(request: Request, exc: Exception):
    """Handle all unhandled exceptions in the local proxy."""
    logger.error(f"[local] Unhandled exception: {exc}", exc_info=True)
    error_response = OpenAIErrorResponse(
        error=OpenAIErrorDetail(message=str(exc), type="internal_error")
    )
    return JSONResponse(status_code=500, content=error_response.model_dump())


@local_app.get("/v1/models")
async def local_list_models():
    """Fetch local Ollama models via /api/tags and return in OpenAI format."""
    logger.info("[local] GET /v1/models - fetching from local Ollama")
    try:
        proxy_port = int(os.getenv("LOCAL_OLLAMA_PORT", str(LOCAL_OLLAMA_PORT)))
        response = await local_httpx_client.get("/api/tags")
        if response.status_code != 200:
            logger.error(f"[local] Failed to fetch models: {response.status_code}")
            return JSONResponse(content={"object": "list", "data": []})
        enriched = translate_tags_to_models(response.json(), proxy_port)
        logger.info(f"[local] Returning {len(enriched['data'])} local models")
        return JSONResponse(content=enriched)
    except Exception as e:
        logger.error(f"[local] Error fetching models: {e}", exc_info=True)
        return JSONResponse(content={"object": "list", "data": []})


def _tool_name(tool: dict) -> str | None:
    """Extract the tool name from an OpenAI tool definition."""
    if not isinstance(tool, dict):
        return None
    if tool.get("type") == "function":
        fn = tool.get("function", {})
        if isinstance(fn, dict):
            return fn.get("name")
    return tool.get("name")


# Tools allowed in "plan" mode (read-only / research tools).
_PLAN_ALLOWED_TOOLS = {
    "read_file",
    "read_notebook_cell_output",
    "copilot_getNotebookSummary",
    "list_dir",
    "file_search",
    "grep_search",
    "semantic_search",
    "view_image",
    "memory",
    "get_errors",
    "get_vscode_api",
    "fetch_webpage",
    "github_repo",
    "github_text_search",
    "session_store_sql",
    "get_task_output",
    "get_terminal_output",
    "terminal_last_command",
    "terminal_selection",
    "mcp_context7_query-docs",
    "mcp_context7_resolve-library-id",
    "mcp_docs_by_langc_search_docs_by_lang_chain",
    "mcp_provides_tool_pylanceDocString",
    "mcp_provides_tool_pylanceDocuments",
    "mcp_gitkraken_cli_git_status",
    "mcp_gitkraken_cli_gitkraken_workspace_list",
    "mcp_gitkraken_cli_issues_assigned_to_me",
    "mcp_gitkraken_cli_gitlens_launchpad",
    "recommended_dotnet_sdk_version",
    "list_available_dotnet_versions_to_install",
    "list_installed_dotnet_versions",
    "find_dotnet_executable_path",
    "get_settings_info_for_dotnet_installation_management",
}


def _filter_local_tools(body: dict, mode: str) -> dict:
    """Filter the Copilot tool schemas sent to local Ollama models.

    Modes:
    - ask: strip all tools.
    - plan: keep only read-only / research tools.
    - agent: pass everything through.
    """
    if mode == "agent" or ("tools" not in body and "tool_choice" not in body):
        return body

    if mode == "ask":
        return {k: v for k, v in body.items() if k not in ("tools", "tool_choice")}

    # plan: keep only the allowed tools.
    tools = body.get("tools", [])
    if not isinstance(tools, list):
        tools = []
    kept_tools = []
    for tool in tools:
        name = _tool_name(tool)
        if name in _PLAN_ALLOWED_TOOLS:
            kept_tools.append(tool)
        else:
            logger.debug(f"[local] Dropping tool '{name}' from plan mode request")

    new_body = dict(body)
    if kept_tools:
        new_body["tools"] = kept_tools
        # Ensure tool_choice doesn't reference a removed tool.
        tool_choice = new_body.get("tool_choice")
        if isinstance(tool_choice, dict):
            chosen_name = tool_choice.get("function", {}).get("name")
            if chosen_name not in _PLAN_ALLOWED_TOOLS:
                new_body["tool_choice"] = "auto"
    else:
        new_body.pop("tools", None)
        new_body.pop("tool_choice", None)

    return new_body


@local_app.post("/v1/chat/completions")
async def local_chat_completions(request: Request):
    """Handle chat completion requests, translating to/from native Ollama format."""
    try:
        body = await request.json()
        model = body.get("model", "llama3.2")
        logger.info(f"[local] POST /v1/chat/completions - model: {model}")

        # Filter tool schemas before translation according to the local tool mode.
        # ask = no tools, plan = read-only tools, agent = keep everything.
        tool_mode = get_current_settings().get("local_tool_mode", "ask")
        body = _filter_local_tools(body, tool_mode)
        if "tools" not in body:
            logger.debug(f"[local] Tools removed for {tool_mode} mode (model {model})")

        ollama_body = translate_chat_request(body)

        if ollama_body.get("stream"):
            return StreamingResponse(
                _local_stream_chat(ollama_body, model),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )
        else:
            return await _local_non_stream_chat(ollama_body, model)

    except Exception as e:
        logger.error(f"[local] Error in chat_completions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def _local_stream_chat(ollama_body: dict, model: str) -> AsyncGenerator[str, None]:
    """Stream chat completions from local Ollama, translating each chunk."""
    chunk_id = f"chatcmpl-local-{uuid.uuid4().hex[:12]}"
    try:
        async with local_httpx_client.stream(
            "POST",
            "/api/chat",
            json=ollama_body,
        ) as response:
            if response.status_code != 200:
                error_text = await response.aread()
                logger.error(f"[local] Ollama error: {response.status_code} - {error_text}")
                error_data = OpenAIErrorResponse(
                    error=OpenAIErrorDetail(
                        message=f"Local Ollama error: {error_text.decode()}",
                        type="api_error",
                        code=str(response.status_code),
                    )
                )
                yield f"data: {error_data.model_dump_json()}\n\n"
                yield "data: [DONE]\n\n"
                return

            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                    yield translate_stream_chunk(chunk, model, chunk_id)
                    if chunk.get("done"):
                        yield "data: [DONE]\n\n"
                        return
                except json.JSONDecodeError:
                    continue

    except Exception as e:
        logger.error(f"[local] Error in stream_chat: {e}", exc_info=True)
        error_data = OpenAIErrorResponse(
            error=OpenAIErrorDetail(message=str(e), type="internal_error")
        )
        yield f"data: {error_data.model_dump_json()}\n\n"
        yield "data: [DONE]\n\n"


async def _local_non_stream_chat(ollama_body: dict, model: str) -> JSONResponse:
    """Non-streaming chat completion from local Ollama."""
    try:
        response = await local_httpx_client.post("/api/chat", json=ollama_body)
        if response.status_code != 200:
            logger.error(f"[local] Ollama error: {response.status_code} - {response.text}")
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Local Ollama error: {response.text}",
            )
        openai_response = translate_chat_response(response.json(), model)
        return JSONResponse(content=openai_response)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[local] Error in non_stream_chat: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@local_app.get("/health")
async def local_health_check():
    """Health check endpoint for the local proxy."""
    return {"status": "healthy", "service": "ollama-local-proxy"}


# ── Entry point ──────────────────────────────────────────────────────────────

def _run_local_server():
    """Run the local Ollama proxy server in a background thread."""
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("LOCAL_OLLAMA_PORT", str(LOCAL_OLLAMA_PORT)))
    uvicorn.run(local_app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
