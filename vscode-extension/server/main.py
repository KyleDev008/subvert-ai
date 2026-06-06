"""Main FastAPI application for Ollama-OpenAI proxy server."""
import json
import logging
import os
from pathlib import Path
from typing import AsyncGenerator, Optional
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import (
    OLLAMA_CLOUD_URL, OLLAMA_CLOUD_KEY, PORT, DEFAULT_MODEL,
    get_current_settings, save_settings, model_id_to_name,
)
from models.openai import (
    OpenAIChatRequest,
    OpenAIModelsResponse,
    OpenAIModel,
    OpenAIErrorResponse,
    OpenAIErrorDetail,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# HTTP client for Ollama Cloud
httpx_client: Optional[httpx.AsyncClient] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan."""
    global httpx_client
    httpx_client = httpx.AsyncClient(
        base_url=OLLAMA_CLOUD_URL,
        timeout=httpx.Timeout(300.0, connect=30.0),
        headers={
            "Authorization": f"Bearer {OLLAMA_CLOUD_KEY}" if OLLAMA_CLOUD_KEY else "",
            "Content-Type": "application/json",
        },
        follow_redirects=True,
    )
    logger.info(f"Ollama-OpenAI proxy starting on port {PORT}")
    logger.info(f"Ollama Cloud URL: {OLLAMA_CLOUD_URL}")
    yield
    if httpx_client:
        await httpx_client.aclose()
    logger.info("Ollama-OpenAI proxy shutting down")


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
            # Return default models as fallback
            return OpenAIModelsResponse(data=[
                OpenAIModel(id=DEFAULT_MODEL, owned_by="ollama"),
            ])
        
        ollama_data = response.json()
        
        # Ollama Cloud returns OpenAI-compatible format: {'object': 'list', 'data': [...]}
        # Extract models from 'data' array
        models_data = ollama_data.get("data", [])
        
        # Transform to OpenAI format (already mostly compatible)
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
        
        logger.info(f"Returning {len(models)} models from Ollama Cloud")
        return OpenAIModelsResponse(data=models)
        
    except Exception as e:
        logger.error(f"Error fetching models: {e}", exc_info=True)
        # Return default models on error
        return OpenAIModelsResponse(data=[
            OpenAIModel(id=DEFAULT_MODEL, owned_by="ollama"),
        ])


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    """Handle chat completion requests with streaming support."""
    try:
        body = await request.json()
        logger.info(f"POST /v1/chat/completions - model: {body.get('model', 'unknown')}")
        
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
    """Stream chat completions from Ollama Cloud - pass through as-is."""
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
            
            # Pass through the response as-is (already in OpenAI SSE format)
            async for line in response.aiter_lines():
                if line:
                    yield f'{line}\n\n'
        
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
        
        # Return response directly (already OpenAI format)
        return JSONResponse(content=response.json())
        
    except Exception as e:
        logger.error(f"Error in non_stream_chat: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/embeddings")
async def create_embeddings(request: Request):
    """Stub for embeddings endpoint."""
    logger.info("POST /v1/embeddings - stub")
    body = await request.json()
    
    # Return a minimal stub response
    return JSONResponse(content={
        "object": "list",
        "data": [
            {
                "object": "embedding",
                "embedding": [0.0] * 1536,  # Stub embedding
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
    allowed = {"ollama_cloud_url", "ollama_cloud_key", "port", "host"}
    filtered = {k: v for k, v in body.items() if k in allowed}
    save_settings(filtered)
    # Rebuild httpx client with new settings
    global httpx_client
    if httpx_client:
        await httpx_client.aclose()
    new_url = os.getenv("OLLAMA_CLOUD_URL", OLLAMA_CLOUD_URL)
    new_key = os.getenv("OLLAMA_CLOUD_KEY", OLLAMA_CLOUD_KEY)
    httpx_client = httpx.AsyncClient(
        base_url=new_url,
        timeout=httpx.Timeout(300.0, connect=30.0),
        headers={
            "Authorization": f"Bearer {new_key}" if new_key else "",
            "Content-Type": "application/json",
        },
        follow_redirects=True,
    )
    logger.info(f"Settings updated. New Ollama Cloud URL: {new_url}")
    return JSONResponse(content={"message": "Settings saved. Proxy client refreshed.", "ok": True})


@app.post("/ui/test-connection")
async def ui_test_connection(request: Request):
    """Test connectivity to a given Ollama Cloud URL + key."""
    body = await request.json()
    url = body.get("ollama_cloud_url", "").strip() or os.getenv("OLLAMA_CLOUD_URL", OLLAMA_CLOUD_URL)
    key = body.get("ollama_cloud_key", "").strip() or os.getenv("OLLAMA_CLOUD_KEY", OLLAMA_CLOUD_KEY)
    # Strip masked placeholder — user didn't change it
    if "•" in key:
        key = os.getenv("OLLAMA_CLOUD_KEY", OLLAMA_CLOUD_KEY)

    try:
        async with httpx.AsyncClient(
            base_url=url,
            timeout=httpx.Timeout(20.0, connect=10.0),
            headers={
                "Authorization": f"Bearer {key}" if key else "",
                "Content-Type": "application/json",
            },
            follow_redirects=True,
        ) as client:
            resp = await client.get("/v1/models")
            if resp.status_code != 200:
                return JSONResponse(content={
                    "success": False,
                    "error": f"HTTP {resp.status_code}: {resp.text[:500]}",
                })
            data = resp.json()
            raw_models = data.get("data", [])
            models = [
                {
                    "id": m["id"],
                    "name": model_id_to_name(m["id"]),
                    "owned_by": m.get("owned_by", "ollama"),
                }
                for m in raw_models if isinstance(m, dict) and "id" in m
            ]
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

    config = {
        "name": "Ollama Cloud",
        "vendor": "customendpoint",
        "apiKey": "${input:chat.lm.secret.-7f68f383}",
        "apiType": "chat-completions",
        "models": models_list,
    }
    return JSONResponse(content=config)


# ── Static UI (must be last to avoid catching API routes) ───────────────────
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
