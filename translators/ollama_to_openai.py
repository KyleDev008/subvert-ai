"""Translate Ollama Cloud responses to OpenAI format."""
import time
import secrets
from typing import Optional, Dict, Any, List
from models.ollama import OllamaStreamChunk, OllamaChatResponse
from models.openai import (
    OpenAIStreamResponse,
    OpenAIChatResponse,
    OpenAIChoice,
    OpenAIDeltaMessage,
    OpenAIUsage,
)


def generate_id() -> str:
    """Generate a unique ID for OpenAI responses."""
    return f"chatcmpl-{secrets.token_hex(12)}"


def get_current_timestamp() -> int:
    """Get current Unix timestamp."""
    return int(time.time())


def translate_ollama_chunk_to_stream(
    chunk: OllamaStreamChunk,
    model: str,
    completion_id: Optional[str] = None,
) -> OpenAIStreamResponse:
    """Translate an Ollama stream chunk to OpenAI stream format."""
    if completion_id is None:
        completion_id = generate_id()
    
    # Extract content from Ollama message
    content = chunk.message.content if chunk.message else ""
    
    # Handle tool calls if present
    tool_calls = chunk.message.tool_calls if chunk.message and chunk.message.tool_calls else None
    
    # Build delta
    delta = OpenAIDeltaMessage(
        role="assistant" if content or tool_calls else None,
        content=content if content else None,
        tool_calls=tool_calls if tool_calls else None,
    )
    
    # Determine finish reason
    finish_reason = None
    if chunk.done:
        finish_reason = "stop"
    
    choice = OpenAIChoice(
        index=0,
        delta=delta,
        finish_reason=finish_reason,
    )
    
    # Calculate usage if done
    usage = None
    if chunk.done:
        usage = OpenAIUsage(
            prompt_tokens=chunk.prompt_eval_count or 0,
            completion_tokens=chunk.eval_count or 0,
            total_tokens=(chunk.prompt_eval_count or 0) + (chunk.eval_count or 0),
        )
    
    return OpenAIStreamResponse(
        id=completion_id,
        created=get_current_timestamp(),
        model=model,
        choices=[choice],
        usage=usage,
    )


def translate_ollama_response_to_openai(
    response: OllamaChatResponse,
    model: str,
) -> OpenAIChatResponse:
    """Translate a complete Ollama response to OpenAI format."""
    completion_id = generate_id()
    
    message = OpenAIDeltaMessage(
        role="assistant",
        content=response.message.content if response.message else "",
        tool_calls=response.message.tool_calls if response.message and response.message.tool_calls else None,
    )
    
    choice = OpenAIChoice(
        index=0,
        message=message,
        finish_reason="stop" if response.done else None,
    )
    
    usage = OpenAIUsage(
        prompt_tokens=response.prompt_eval_count or 0,
        completion_tokens=response.eval_count or 0,
        total_tokens=(response.prompt_eval_count or 0) + (response.eval_count or 0),
    )
    
    return OpenAIChatResponse(
        id=completion_id,
        created=get_current_timestamp(),
        model=model,
        choices=[choice],
        usage=usage,
    )


def create_stream_done_event(completion_id: str, model: str) -> str:
    """Create the final [DONE] event for SSE streaming."""
    return f'data: [DONE]\n\n'


def convert_to_sse(response: OpenAIStreamResponse) -> str:
    """Convert an OpenAI stream response to SSE format."""
    import json
    return f'data: {response.model_dump_json()}\n\n'
