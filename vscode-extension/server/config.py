"""Configuration for the Ollama-OpenAI proxy server."""
import os
import json
import re
from pathlib import Path
from dotenv import load_dotenv, set_key

load_dotenv()

# Ollama Cloud Configuration
OLLAMA_CLOUD_URL = os.getenv("OLLAMA_CLOUD_URL", "https://ollama.com")
OLLAMA_CLOUD_KEY = os.getenv("OLLAMA_CLOUD_KEY", "")

# Server Configuration
PORT = int(os.getenv("PORT", "11435"))
HOST = os.getenv("HOST", "0.0.0.0")

# Local Ollama Configuration
LOCAL_OLLAMA_URL = os.getenv("LOCAL_OLLAMA_URL", "http://localhost:11434")
LOCAL_OLLAMA_PORT = int(os.getenv("LOCAL_OLLAMA_PORT", "11436"))
LOCAL_OLLAMA_ENABLED: bool = os.getenv("LOCAL_OLLAMA_ENABLED", "false").lower() == "true"
LOCAL_TOOL_MODE: str = os.getenv("LOCAL_TOOL_MODE", "ask")

# Multi-Mode: allow multiple named API keys and switch between them at runtime.
# Stored as a JSON array in .env: MULTI_MODE_KEYS=[{"name":"...","key":"..."},...]
MULTI_MODE: bool = os.getenv("MULTI_MODE", "false").lower() == "true"
_raw_keys = os.getenv("MULTI_MODE_KEYS", "[]")
try:
    MULTI_MODE_KEYS: list[dict] = json.loads(_raw_keys)
except Exception:
    MULTI_MODE_KEYS = []
ACTIVE_KEY_INDEX: int = int(os.getenv("ACTIVE_KEY_INDEX", "0"))

# Optional: Model Mapping for aliasing (e.g., map "gpt-4" to "llama3")
# If empty, models pass through as-is
MODEL_MAP: dict[str, str] = {}

# Default model to use if request doesn't specify one
DEFAULT_MODEL = "gpt-oss:120b-cloud"

ENV_FILE = Path(__file__).parent / ".env"


def get_ollama_model(openai_model: str) -> str:
    """Map an OpenAI model name to an Ollama Cloud model name.
    
    If no mapping exists, returns the model name as-is.
    """
    return MODEL_MAP.get(openai_model, openai_model)


def get_active_key() -> str:
    """Return the API key that is currently active.

    In multi-mode this is the entry at ACTIVE_KEY_INDEX in MULTI_MODE_KEYS.
    Falls back to the single OLLAMA_CLOUD_KEY when multi-mode is off or the
    list is empty.
    """
    if os.getenv("MULTI_MODE", "false").lower() == "true":
        keys = get_api_keys()
        idx = int(os.getenv("ACTIVE_KEY_INDEX", "0"))
        if keys and 0 <= idx < len(keys):
            return keys[idx].get("key", "")
    return os.getenv("OLLAMA_CLOUD_KEY", OLLAMA_CLOUD_KEY)


def get_api_keys() -> list[dict]:
    """Return the current list of named API keys."""
    try:
        return json.loads(os.getenv("MULTI_MODE_KEYS", "[]"))
    except Exception:
        return []


def get_current_settings() -> dict:
    """Return current runtime settings."""
    return {
        "ollama_cloud_url": os.getenv("OLLAMA_CLOUD_URL", OLLAMA_CLOUD_URL),
        "ollama_cloud_key": os.getenv("OLLAMA_CLOUD_KEY", OLLAMA_CLOUD_KEY),
        "port": int(os.getenv("PORT", str(PORT))),
        "host": os.getenv("HOST", HOST),
        "multi_mode": os.getenv("MULTI_MODE", "false").lower() == "true",
        "api_keys": get_api_keys(),
        "active_key_index": int(os.getenv("ACTIVE_KEY_INDEX", "0")),
        "local_ollama_url": os.getenv("LOCAL_OLLAMA_URL", LOCAL_OLLAMA_URL),
        "local_ollama_port": int(os.getenv("LOCAL_OLLAMA_PORT", str(LOCAL_OLLAMA_PORT))),
        "local_ollama_enabled": os.getenv("LOCAL_OLLAMA_ENABLED", "false").lower() == "true",
        "local_tool_mode": os.getenv("LOCAL_TOOL_MODE", LOCAL_TOOL_MODE),
    }


def save_settings(settings: dict) -> None:
    """Persist settings to .env file and update os.environ."""
    mapping = {
        "ollama_cloud_url": "OLLAMA_CLOUD_URL",
        "ollama_cloud_key": "OLLAMA_CLOUD_KEY",
        "port": "PORT",
        "host": "HOST",
        "local_ollama_url": "LOCAL_OLLAMA_URL",
        "local_ollama_port": "LOCAL_OLLAMA_PORT",
    }
    env_path = str(ENV_FILE)
    for key, env_key in mapping.items():
        if key in settings:
            value = str(settings[key])
            set_key(env_path, env_key, value)
            os.environ[env_key] = value

    if "local_ollama_enabled" in settings:
        v = "true" if settings["local_ollama_enabled"] else "false"
        set_key(env_path, "LOCAL_OLLAMA_ENABLED", v)
        os.environ["LOCAL_OLLAMA_ENABLED"] = v

    if "multi_mode" in settings:
        v = "true" if settings["multi_mode"] else "false"
        set_key(env_path, "MULTI_MODE", v)
        os.environ["MULTI_MODE"] = v

    if "api_keys" in settings:
        v = json.dumps(settings["api_keys"])
        set_key(env_path, "MULTI_MODE_KEYS", v)
        os.environ["MULTI_MODE_KEYS"] = v

    if "active_key_index" in settings:
        v = str(int(settings["active_key_index"]))
        set_key(env_path, "ACTIVE_KEY_INDEX", v)
        os.environ["ACTIVE_KEY_INDEX"] = v

    if "local_tool_mode" in settings:
        v = str(settings["local_tool_mode"])
        set_key(env_path, "LOCAL_TOOL_MODE", v)
        os.environ["LOCAL_TOOL_MODE"] = v


def model_id_to_name(model_id: str) -> str:
    """Convert a model ID like 'gemma4:31b' to a display name like 'Gemma 4 31B'."""
    # Replace colons and hyphens with spaces, capitalise each word
    name = re.sub(r"[:\-_]", " ", model_id)
    # Capitalise each word; keep numeric suffixes upper-ish
    parts = name.split()
    titled = []
    for p in parts:
        # If it looks like a version/size token keep as-is uppercased
        if re.match(r"^[\d.]+[bBtTkK]?$", p) or re.match(r"^v[\d.]+", p, re.I):
            titled.append(p.upper() if len(p) <= 4 else p.capitalize())
        else:
            titled.append(p.capitalize())
    return " ".join(titled)
