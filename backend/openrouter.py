"""OpenRouter API client for making LLM requests."""

import httpx
from typing import List, Dict, Any, Optional
from config import OPENROUTER_API_URL, get_user_openrouter_api_key

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 120.0,
    user_id: str = "local-dev-user",
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via OpenRouter API.

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    headers = {
        "Authorization": f"Bearer {get_user_openrouter_api_key(user_id)}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                OPENROUTER_API_URL,
                headers=headers,
                json=payload
            )
            response.raise_for_status()

            data = response.json()
            message = data['choices'][0]['message']

            return {
                'content': message.get('content'),
                'reasoning_details': message.get('reasoning_details')
            }

    except Exception as e:
        print(f"Error querying model {model}: {e}")
        return None


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]],
    user_id: str = "local-dev-user",
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel.

    Args:
        models: List of OpenRouter model identifiers
        messages: List of message dicts to send to each model

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    import asyncio

    # Create tasks for all models
    tasks = [query_model(model, messages, user_id=user_id) for model in models]

    # Wait for all to complete
    responses = await asyncio.gather(*tasks)

    # Map models to their responses
    return {model: response for model, response in zip(models, responses)}


async def list_openrouter_models(user_id: str = "local-dev-user") -> List[Dict[str, Any]]:
    """Fetch model ids and names available from OpenRouter."""
    api_key = get_user_openrouter_api_key(user_id)
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(OPENROUTER_MODELS_URL, headers=headers)
        response.raise_for_status()
        data = response.json()
    models = []
    for item in data.get("data", []):
        model_id = item.get("id")
        if not model_id:
            continue
        models.append({
            "id": model_id,
            "name": item.get("name") or model_id,
            "context_length": item.get("context_length"),
        })
    return sorted(models, key=lambda model: model["id"])
