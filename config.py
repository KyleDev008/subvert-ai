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


def get_current_settings() -> dict:
    """Return current runtime settings."""
    return {
        "ollama_cloud_url": os.getenv("OLLAMA_CLOUD_URL", OLLAMA_CLOUD_URL),
        "ollama_cloud_key": os.getenv("OLLAMA_CLOUD_KEY", OLLAMA_CLOUD_KEY),
        "port": int(os.getenv("PORT", str(PORT))),
        "host": os.getenv("HOST", HOST),
    }


def save_settings(settings: dict) -> None:
    """Persist settings to .env file and update os.environ."""
    mapping = {
        "ollama_cloud_url": "OLLAMA_CLOUD_URL",
        "ollama_cloud_key": "OLLAMA_CLOUD_KEY",
        "port": "PORT",
        "host": "HOST",
    }
    env_path = str(ENV_FILE)
    for key, env_key in mapping.items():
        if key in settings:
            value = str(settings[key])
            set_key(env_path, env_key, value)
            os.environ[env_key] = value


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
