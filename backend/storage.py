"""Conversation storage with Postgres production backend and JSON local fallback."""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import db
from config import DATA_DIR


def is_vercel_runtime():
    return os.getenv("VERCEL") == "1" or os.getenv("VERCEL_ENV") is not None


def require_writable_local_storage():
    if is_vercel_runtime():
        raise RuntimeError("DATABASE_URL or POSTGRES_URL is required for production storage.")


def ensure_data_dir():
    require_writable_local_storage()
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str) -> str:
    return os.path.join(DATA_DIR, f"{conversation_id}.json")


def create_conversation(conversation_id: str, user_id: str = db.DEFAULT_USER_ID) -> Dict[str, Any]:
    if db.enabled():
        return db.create_conversation(conversation_id, user_id)

    ensure_data_dir()
    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "messages": [],
    }
    with open(get_conversation_path(conversation_id), "w", encoding="utf-8") as f:
        json.dump(conversation, f, indent=2)
    return conversation


def get_conversation(conversation_id: str, user_id: str = db.DEFAULT_USER_ID) -> Optional[Dict[str, Any]]:
    if db.enabled():
        return db.get_conversation(conversation_id, user_id)

    path = get_conversation_path(conversation_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_conversation(conversation: Dict[str, Any]):
    require_writable_local_storage()
    ensure_data_dir()
    with open(get_conversation_path(conversation["id"]), "w", encoding="utf-8") as f:
        json.dump(conversation, f, indent=2)


def list_conversations(user_id: str = db.DEFAULT_USER_ID) -> List[Dict[str, Any]]:
    if db.enabled():
        return db.list_conversations(user_id)

    ensure_data_dir()
    conversations = []
    for filename in os.listdir(DATA_DIR):
        if not filename.endswith(".json"):
            continue
        with open(os.path.join(DATA_DIR, filename), "r", encoding="utf-8") as f:
            data = json.load(f)
        conversations.append({
            "id": data["id"],
            "created_at": data["created_at"],
            "title": data.get("title", "New Conversation"),
            "message_count": len(data["messages"]),
        })
    conversations.sort(key=lambda x: x["created_at"], reverse=True)
    return conversations


def delete_conversation(conversation_id: str, user_id: str = db.DEFAULT_USER_ID) -> bool:
    if db.enabled():
        return db.delete_conversation(conversation_id, user_id)

    path = get_conversation_path(conversation_id)
    if not os.path.exists(path):
        return False
    os.remove(path)
    return True


def delete_conversations(conversation_ids: List[str], user_id: str = db.DEFAULT_USER_ID) -> int:
    if db.enabled():
        return db.delete_conversations(conversation_ids, user_id)

    deleted = 0
    for conversation_id in conversation_ids:
        if delete_conversation(conversation_id, user_id):
            deleted += 1
    return deleted


def delete_empty_conversations(except_id: str | None = None, user_id: str = db.DEFAULT_USER_ID) -> int:
    if db.enabled():
        items = list_conversations(user_id)
        return delete_conversations(
            [item["id"] for item in items if item["id"] != except_id and item.get("message_count", 0) == 0],
            user_id,
        )

    deleted = 0
    for item in list_conversations(user_id):
        if item["id"] != except_id and item.get("message_count", 0) == 0:
            if delete_conversation(item["id"], user_id):
                deleted += 1
    return deleted


def add_user_message(conversation_id: str, content: str, user_id: str = db.DEFAULT_USER_ID):
    if db.enabled():
        return db.add_user_message(conversation_id, user_id, content)

    conversation = get_conversation(conversation_id, user_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")
    conversation["messages"].append({"role": "user", "content": content})
    save_conversation(conversation)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any],
    user_id: str = db.DEFAULT_USER_ID,
    metadata: Dict[str, Any] | None = None,
):
    if db.enabled():
        return db.add_assistant_message(conversation_id, user_id, stage1, stage2, stage3, metadata)

    conversation = get_conversation(conversation_id, user_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")
    message = {"role": "assistant", "stage1": stage1, "stage2": stage2, "stage3": stage3}
    if metadata:
        message["metadata"] = metadata
    conversation["messages"].append(message)
    save_conversation(conversation)


def update_conversation_title(conversation_id: str, title: str, user_id: str = db.DEFAULT_USER_ID):
    if db.enabled():
        return db.update_conversation_title(conversation_id, user_id, title)

    conversation = get_conversation(conversation_id, user_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")
    conversation["title"] = title
    save_conversation(conversation)
