"""Translate OpenAI requests to Ollama Cloud format."""
import base64
from typing import List, Dict, Any, Optional
from models.openai import (
    OpenAIChatRequest,
    OpenAIMessage,
    OpenAITool,
)
from models.ollama import (
    OllamaChatRequest,
    OllamaMessage,
    OllamaTool,
    OllamaToolFunction,
)
from config import get_ollama_model


def extract_text_content(content: Any) -> str:
    """Extract text content from OpenAI message content."""
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        # Handle multi-modal content
        text_parts = []
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    text_parts.append(part.get("text", ""))
                elif part.get("type") == "image_url":
                    # Image URLs are handled separately in message translation
                    pass
        return "\n".join(text_parts)
    return ""


def extract_images(content: Any) -> Optional[List[str]]:
    """Extract base64 images from OpenAI message content."""
    if not isinstance(content, list):
        return None
    
    images = []
    for part in content:
        if isinstance(part, dict) and part.get("type") == "image_url":
            image_url = part.get("image_url", {})
            url = image_url.get("url", "")
            if url.startswith("data:image"):
                # Extract base64 data from data URL
                base64_data = url.split(",")[1] if "," in url else url
                images.append(base64_data)
    
    return images if images else None


def translate_message(openai_msg: OpenAIMessage) -> OllamaMessage:
    """Translate an OpenAI message to Ollama format."""
    content = extract_text_content(openai_msg.content)
    images = extract_images(openai_msg.content)
    
    return OllamaMessage(
        role=openai_msg.role,
        content=content,
        images=images,
        tool_calls=openai_msg.tool_calls,
    )


def translate_messages(openai_messages: List[OpenAIMessage]) -> List[OllamaMessage]:
    """Translate a list of OpenAI messages to Ollama format."""
    return [translate_message(msg) for msg in openai_messages]


def translate_tool(openai_tool: OpenAITool) -> OllamaTool:
    """Translate an OpenAI tool definition to Ollama format."""
    return OllamaTool(
        type="function",
        function=OllamaToolFunction(
            name=openai_tool.function.name,
            description=openai_tool.function.description,
            parameters=openai_tool.function.parameters,
        )
    )


def translate_tools(openai_tools: Optional[List[OpenAITool]]) -> Optional[List[OllamaTool]]:
    """Translate OpenAI tool definitions to Ollama format."""
    if not openai_tools:
        return None
    return [translate_tool(tool) for tool in openai_tools]


def build_options(request: OpenAIChatRequest) -> Dict[str, Any]:
    """Build Ollama options from OpenAI request parameters."""
    options: Dict[str, Any] = {}
    
    if request.temperature is not None:
        options["temperature"] = request.temperature
    if request.top_p is not None:
        options["top_p"] = request.top_p
    if request.max_tokens is not None:
        options["num_predict"] = request.max_tokens
    if request.presence_penalty is not None:
        options["presence_penalty"] = request.presence_penalty
    if request.frequency_penalty is not None:
        options["frequency_penalty"] = request.frequency_penalty
    if request.stop is not None:
        if isinstance(request.stop, str):
            options["stop"] = [request.stop]
        else:
            options["stop"] = request.stop
    
    return options


def translate_chat_request(request: OpenAIChatRequest) -> OllamaChatRequest:
    """Translate an OpenAI chat request to Ollama format."""
    ollama_model = get_ollama_model(request.model)
    ollama_messages = translate_messages(request.messages)
    ollama_tools = translate_tools(request.tools)
    options = build_options(request)
    
    return OllamaChatRequest(
        model=ollama_model,
        messages=ollama_messages,
        stream=request.stream if request.stream is not None else True,
        options=options if options else None,
        tools=ollama_tools,
    )
