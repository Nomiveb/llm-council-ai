"""FastAPI backend for LLM Council."""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any
import uuid
import json
import asyncio

import storage
from config import get_user_api_key_config, get_model_config, save_model_config, save_user_openrouter_api_key
from council import run_full_council, generate_conversation_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings
from openrouter import list_openrouter_models

app = FastAPI(title="LLM Council API")


@app.middleware("http")
async def require_internal_secret(request: Request, call_next):
    expected = os.getenv("INTERNAL_API_SECRET")
    if expected and request.headers.get("x-internal-api-secret") != expected:
        return Response("Unauthorized", status_code=401)
    return await call_next(request)


def current_user_id(request: Request) -> str:
    """Auth boundary. Auth.js/Next proxy should forward a verified user id here."""
    return request.headers.get("x-user-id") or "local-dev-user"


def log_event(user_id: str, event: str, **kwargs):
    try:
        import db
        if db.enabled():
            db.log_event(user_id=user_id, event=event, **kwargs)
    except Exception as error:
        print(json.dumps({"level": "error", "event": "log_write_failed", "message": str(error)}))

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str


class ModelConfigRequest(BaseModel):
    """Editable OpenRouter model configuration."""
    council_models: List[str]
    chairman_model: str
    title_model: str | None = None


class ApiKeyRequest(BaseModel):
    """OpenRouter API key update."""
    openrouter_api_key: str


class DeleteConversationsRequest(BaseModel):
    """Batch delete request."""
    conversation_ids: List[str]


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations(request: Request):
    """List all conversations (metadata only)."""
    return storage.list_conversations(current_user_id(request))


@app.get("/api/model-config")
async def read_model_config(request: Request):
    """Return current model configuration."""
    return get_model_config(current_user_id(request))


@app.get("/api/api-key-config")
async def read_api_key_config(request: Request):
    """Return safe OpenRouter API key metadata."""
    return get_user_api_key_config(current_user_id(request))


@app.put("/api/api-key-config")
async def update_api_key_config(payload: ApiKeyRequest, request: Request):
    """Update OpenRouter API key used when env key is not set."""
    return save_user_openrouter_api_key(payload.openrouter_api_key, current_user_id(request))


@app.put("/api/model-config")
async def update_model_config(payload: ModelConfigRequest, request: Request):
    """Update model configuration used by new council runs."""
    try:
        return save_model_config(
            payload.council_models,
            payload.chairman_model,
            payload.title_model,
            current_user_id(request),
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/openrouter-models")
async def read_openrouter_models(request: Request):
    """Return available OpenRouter models for UI autocomplete."""
    try:
        return {"models": await list_openrouter_models(current_user_id(request))}
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Failed to load OpenRouter models: {error}") from error


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(payload: CreateConversationRequest, request: Request):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    user_id = current_user_id(request)
    conversation = storage.create_conversation(conversation_id, user_id)
    log_event(user_id, "conversation_created", conversation_id=conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str, request: Request):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id, current_user_id(request))
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, request: Request):
    """Delete a single conversation."""
    user_id = current_user_id(request)
    if not storage.delete_conversation(conversation_id, user_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    log_event(user_id, "conversation_deleted", conversation_id=conversation_id)
    return {"deleted": 1}


@app.post("/api/conversations/delete")
async def delete_conversations(payload: DeleteConversationsRequest, request: Request):
    """Delete selected conversations."""
    user_id = current_user_id(request)
    deleted = storage.delete_conversations(payload.conversation_ids, user_id)
    log_event(user_id, "conversations_batch_deleted", metadata={"count": deleted})
    return {"deleted": deleted}


@app.post("/api/conversations/delete-empty")
async def delete_empty_conversations(request: Request, except_id: str | None = None):
    """Delete empty placeholder conversations."""
    return {"deleted": storage.delete_empty_conversations(except_id, current_user_id(request))}


@app.get("/api/logs")
async def read_logs(request: Request, conversation_id: str | None = None, limit: int = 200):
    """Return detailed production run logs for the current user."""
    import db
    if not db.enabled():
        return {"logs": []}
    return {"logs": db.list_logs(current_user_id(request), conversation_id=conversation_id, limit=min(limit, 500))}


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, payload: SendMessageRequest, request: Request):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    # Check if conversation exists
    user_id = current_user_id(request)
    conversation = storage.get_conversation(conversation_id, user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(conversation_id, payload.content, user_id)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(payload.content, user_id=user_id)
        storage.update_conversation_title(conversation_id, title, user_id)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        payload.content,
        user_id=user_id,
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result,
        user_id,
        metadata,
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, payload: SendMessageRequest, request: Request):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    # Check if conversation exists
    user_id = current_user_id(request)
    conversation = storage.get_conversation(conversation_id, user_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        try:
            # Add user message
            log_event(user_id, "run_started", conversation_id=conversation_id)
            storage.add_user_message(conversation_id, payload.content, user_id)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(payload.content, user_id=user_id))

            # Stage 1: Collect responses
            model_config = get_model_config(user_id)
            log_event(user_id, "stage_started", conversation_id=conversation_id, stage="individual_responses", metadata={"models": model_config["council_models"]})
            yield f"data: {json.dumps({'type': 'stage1_start', 'models': model_config['council_models'], 'model_config': model_config})}\n\n"
            stage1_results = await stage1_collect_responses(payload.content, user_id=user_id)
            log_event(user_id, "stage_completed", conversation_id=conversation_id, stage="individual_responses", metadata={"responses": len(stage1_results)})
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            log_event(user_id, "stage_started", conversation_id=conversation_id, stage="peer_review", metadata={"models": model_config["council_models"]})
            yield f"data: {json.dumps({'type': 'stage2_start', 'models': model_config['council_models'], 'model_config': model_config})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(payload.content, stage1_results, user_id=user_id)
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            log_event(user_id, "stage_completed", conversation_id=conversation_id, stage="peer_review", metadata={"rankings": len(stage2_results)})
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize final answer
            log_event(user_id, "stage_started", conversation_id=conversation_id, stage="final_answer", model=model_config["chairman_model"])
            yield f"data: {json.dumps({'type': 'stage3_start', 'models': [model_config['chairman_model']], 'model_config': model_config})}\n\n"
            stage3_result = await stage3_synthesize_final(payload.content, stage1_results, stage2_results, user_id=user_id)
            log_event(user_id, "stage_completed", conversation_id=conversation_id, stage="final_answer", model=model_config["chairman_model"])
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title, user_id)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save complete assistant message
            storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result,
                user_id,
                {"label_to_model": label_to_model, "aggregate_rankings": aggregate_rankings, "model_config": model_config},
            )

            # Send completion event
            log_event(user_id, "run_completed", conversation_id=conversation_id)
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            log_event(user_id, "run_failed", level="error", conversation_id=conversation_id, message=str(e))
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8001, reload=True)
