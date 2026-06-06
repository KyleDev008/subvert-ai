"""Pydantic models for Ollama Cloud API."""
from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field


class OllamaMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    images: Optional[List[str]] = None  # Base64 encoded images for vision
    tool_calls: Optional[List[Dict[str, Any]]] = None


class OllamaToolFunction(BaseModel):
    name: str
    description: Optional[str] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)


class OllamaTool(BaseModel):
    type: Literal["function"] = "function"
    function: OllamaToolFunction


class OllamaChatRequest(BaseModel):
    model: str
    messages: List[OllamaMessage]
    stream: bool = True
    options: Optional[Dict[str, Any]] = None
    tools: Optional[List[OllamaTool]] = None


class OllamaResponseMessage(BaseModel):
    role: str = "assistant"
    content: str = ""
    tool_calls: Optional[List[Dict[str, Any]]] = None


class OllamaStreamChunk(BaseModel):
    model: str
    created_at: str
    message: OllamaResponseMessage
    done: bool = False
    total_duration: Optional[int] = None
    load_duration: Optional[int] = None
    prompt_eval_count: Optional[int] = None
    eval_count: Optional[int] = None
    eval_duration: Optional[int] = None


class OllamaChatResponse(BaseModel):
    model: str
    created_at: str
    message: OllamaResponseMessage
    done: bool
    total_duration: Optional[int] = None
    load_duration: Optional[int] = None
    prompt_eval_count: Optional[int] = None
    eval_count: Optional[int] = None
    eval_duration: Optional[int] = None


class OllamaModelDetails(BaseModel):
    format: Optional[str] = None
    family: Optional[str] = None
    families: Optional[List[str]] = None
    parameter_size: Optional[str] = None
    quantization_level: Optional[str] = None


class OllamaModel(BaseModel):
    name: str
    model: str
    modified_at: Optional[str] = None
    size: Optional[int] = None
    digest: Optional[str] = None
    details: Optional[OllamaModelDetails] = None


class OllamaModelsResponse(BaseModel):
    models: List[OllamaModel]
