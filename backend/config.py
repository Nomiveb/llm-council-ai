"""Configuration for the LLM Council."""

import os
import json
import base64
import hashlib
from dotenv import load_dotenv
from cryptography.fernet import Fernet
import db

load_dotenv()

# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Council members - list of OpenRouter model identifiers
COUNCIL_MODELS = [
    "openai/gpt-5.5",
    "google/gemini-3.1-pro-preview",
    "moonshotai/kimi-k2.6",
    "x-ai/grok-4.3",
]

# Chairman model - synthesizes final response
CHAIRMAN_MODEL = "anthropic/claude-sonnet-4.6"
TITLE_MODEL = "openai/gpt-5.4-nano"

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Data directory for conversation storage
DATA_DIR = "data/conversations"
MODEL_CONFIG_PATH = "data/model_config.json"
API_KEY_CONFIG_PATH = "data/openrouter_api_key.json"


def get_openrouter_api_key():
    """Return OpenRouter API key from env first, then editable local config."""
    env_key = os.getenv("OPENROUTER_API_KEY")
    if env_key:
        return env_key
    try:
        with open(API_KEY_CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return data.get("openrouter_api_key") or None


def get_user_openrouter_api_key(user_id=db.DEFAULT_USER_ID):
    """Return user-scoped OpenRouter API key from DB, then global fallback."""
    if db.enabled():
        with db.connection() as conn:
            db.ensure_user(conn, user_id)
            row = conn.execute(
                "select encrypted_openrouter_api_key from api_keys where user_id = %s",
                (user_id,),
            ).fetchone()
            conn.commit()
        if row:
            return decrypt_secret(row["encrypted_openrouter_api_key"])
    return get_openrouter_api_key()


def get_api_key_config():
    """Return safe API key metadata for UI."""
    env_key = os.getenv("OPENROUTER_API_KEY")
    local_key = get_openrouter_api_key()
    active_key = env_key or local_key
    return {
        "has_openrouter_api_key": bool(active_key),
        "source": "environment" if env_key else ("site" if local_key else "missing"),
        "masked": mask_api_key(active_key),
    }


def get_user_api_key_config(user_id=db.DEFAULT_USER_ID):
    env_key = os.getenv("OPENROUTER_API_KEY")
    active_key = get_user_openrouter_api_key(user_id)
    source = "environment" if env_key else ("database" if db.enabled() and active_key else ("site" if active_key else "missing"))
    return {
        "has_openrouter_api_key": bool(active_key),
        "source": source,
        "masked": mask_api_key(active_key),
    }


def mask_api_key(value):
    if not value:
        return ""
    if len(value) <= 10:
        return "••••"
    return f"{value[:6]}...{value[-4:]}"


def save_openrouter_api_key(api_key):
    """Persist OpenRouter API key edited from the UI."""
    api_key = str(api_key or "").strip()
    os.makedirs(os.path.dirname(API_KEY_CONFIG_PATH), exist_ok=True)
    with open(API_KEY_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump({"openrouter_api_key": api_key}, f, indent=2)
    return get_api_key_config()


def encryption_key():
    secret = os.getenv("API_KEY_ENCRYPTION_SECRET") or os.getenv("APP_SECRET") or "llm-council-local-dev-secret"
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(value):
    return Fernet(encryption_key()).encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value):
    return Fernet(encryption_key()).decrypt(value.encode("utf-8")).decode("utf-8")


def save_user_openrouter_api_key(api_key, user_id=db.DEFAULT_USER_ID):
    api_key = str(api_key or "").strip()
    if db.enabled():
        with db.connection() as conn:
            db.ensure_user(conn, user_id)
            conn.execute(
                """
                insert into api_keys (user_id, encrypted_openrouter_api_key)
                values (%s, %s)
                on conflict (user_id) do update set
                  encrypted_openrouter_api_key = excluded.encrypted_openrouter_api_key,
                  updated_at = now()
                """,
                (user_id, encrypt_secret(api_key)),
            )
            conn.commit()
        return get_user_api_key_config(user_id)
    return save_openrouter_api_key(api_key)


def get_model_config(user_id=db.DEFAULT_USER_ID):
    """Return editable model configuration, falling back to defaults."""
    defaults = {
        "council_models": COUNCIL_MODELS,
        "chairman_model": CHAIRMAN_MODEL,
        "title_model": TITLE_MODEL,
    }
    if db.enabled():
        row = db.get_model_config(user_id)
        if row:
            return {
                "council_models": row["council_models"],
                "chairman_model": row["chairman_model"],
                "title_model": row["title_model"],
            }
    try:
        with open(MODEL_CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return defaults
    except json.JSONDecodeError:
        return defaults

    council_models = data.get("council_models")
    if not isinstance(council_models, list):
        council_models = defaults["council_models"]
    council_models = [str(model).strip() for model in council_models if str(model).strip()]

    return {
        "council_models": council_models or defaults["council_models"],
        "chairman_model": str(data.get("chairman_model") or defaults["chairman_model"]).strip(),
        "title_model": str(data.get("title_model") or defaults["title_model"]).strip(),
    }


def save_model_config(council_models, chairman_model, title_model=None, user_id=db.DEFAULT_USER_ID):
    """Persist model configuration edited from the UI."""
    clean_council = []
    for model in council_models:
        model = str(model).strip()
        if model and model not in clean_council:
            clean_council.append(model)

    if not clean_council:
        raise ValueError("At least one council model is required.")
    chairman_model = str(chairman_model).strip()
    if not chairman_model:
        raise ValueError("Chairman model is required.")

    os.makedirs(os.path.dirname(MODEL_CONFIG_PATH), exist_ok=True)
    config = {
        "council_models": clean_council,
        "chairman_model": chairman_model,
        "title_model": str(title_model or TITLE_MODEL).strip(),
    }
    if db.enabled():
        db.save_model_config(user_id, clean_council, chairman_model, config["title_model"])
        return config
    with open(MODEL_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    return config
