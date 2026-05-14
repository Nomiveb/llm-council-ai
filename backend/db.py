"""Postgres persistence for production deployments."""

import json
import os
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.getenv("DATABASE_URL")
DEFAULT_USER_ID = "local-dev-user"


def enabled() -> bool:
    return bool(DATABASE_URL)


@contextmanager
def connection():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured.")
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        ensure_schema(conn)
        yield conn


def ensure_schema(conn):
    conn.execute(
        """
        create table if not exists app_users (
          id text primary key,
          email text,
          name text,
          created_at timestamptz not null default now()
        );

        create table if not exists conversations (
          id uuid primary key,
          user_id text not null references app_users(id) on delete cascade,
          title text not null default 'New Conversation',
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create table if not exists messages (
          id bigserial primary key,
          conversation_id uuid not null references conversations(id) on delete cascade,
          user_id text not null references app_users(id) on delete cascade,
          role text not null,
          content text,
          stage1 jsonb,
          stage2 jsonb,
          stage3 jsonb,
          metadata jsonb,
          created_at timestamptz not null default now()
        );

        create table if not exists model_configs (
          user_id text primary key references app_users(id) on delete cascade,
          council_models jsonb not null,
          chairman_model text not null,
          title_model text not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists api_keys (
          user_id text primary key references app_users(id) on delete cascade,
          encrypted_openrouter_api_key text not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists run_logs (
          id uuid primary key,
          user_id text not null references app_users(id) on delete cascade,
          conversation_id uuid references conversations(id) on delete cascade,
          level text not null,
          event text not null,
          stage text,
          model text,
          message text,
          metadata jsonb,
          created_at timestamptz not null default now()
        );

        create index if not exists conversations_user_updated_idx
          on conversations(user_id, updated_at desc);
        create index if not exists messages_conversation_idx
          on messages(conversation_id, created_at asc);
        create index if not exists run_logs_user_created_idx
          on run_logs(user_id, created_at desc);
        """
    )
    conn.commit()


def ensure_user(conn, user_id: str):
    conn.execute(
        "insert into app_users (id) values (%s) on conflict (id) do nothing",
        (user_id,),
    )


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def json_value(value: Any):
    return json.dumps(value) if value is not None else None


def create_conversation(conversation_id: str, user_id: str):
    with connection() as conn:
        ensure_user(conn, user_id)
        row = conn.execute(
            """
            insert into conversations (id, user_id)
            values (%s, %s)
            returning id::text, created_at, title
            """,
            (conversation_id, user_id),
        ).fetchone()
        conn.commit()
    return {
        "id": row["id"],
        "created_at": iso(row["created_at"]),
        "title": row["title"],
        "messages": [],
    }


def list_conversations(user_id: str):
    with connection() as conn:
        ensure_user(conn, user_id)
        rows = conn.execute(
            """
            select c.id::text, c.created_at, c.title, count(m.id)::int as message_count
            from conversations c
            left join messages m on m.conversation_id = c.id
            where c.user_id = %s
            group by c.id
            order by c.updated_at desc, c.created_at desc
            """,
            (user_id,),
        ).fetchall()
        conn.commit()
    return [
        {
            "id": row["id"],
            "created_at": iso(row["created_at"]),
            "title": row["title"],
            "message_count": row["message_count"],
        }
        for row in rows
    ]


def get_conversation(conversation_id: str, user_id: str):
    with connection() as conn:
        ensure_user(conn, user_id)
        conv = conn.execute(
            """
            select id::text, created_at, title
            from conversations
            where id = %s and user_id = %s
            """,
            (conversation_id, user_id),
        ).fetchone()
        if not conv:
            return None
        rows = conn.execute(
            """
            select role, content, stage1, stage2, stage3, metadata
            from messages
            where conversation_id = %s and user_id = %s
            order by created_at asc, id asc
            """,
            (conversation_id, user_id),
        ).fetchall()
        conn.commit()
    messages = []
    for row in rows:
        if row["role"] == "user":
            messages.append({"role": "user", "content": row["content"]})
        else:
            item = {
                "role": "assistant",
                "stage1": row["stage1"],
                "stage2": row["stage2"],
                "stage3": row["stage3"],
            }
            if row["metadata"]:
                item["metadata"] = row["metadata"]
            messages.append(item)
    return {
        "id": conv["id"],
        "created_at": iso(conv["created_at"]),
        "title": conv["title"],
        "messages": messages,
    }


def add_user_message(conversation_id: str, user_id: str, content: str):
    with connection() as conn:
        ensure_user(conn, user_id)
        conn.execute(
            """
            insert into messages (conversation_id, user_id, role, content)
            values (%s, %s, 'user', %s)
            """,
            (conversation_id, user_id, content),
        )
        conn.execute(
            "update conversations set updated_at = now() where id = %s and user_id = %s",
            (conversation_id, user_id),
        )
        conn.commit()


def add_assistant_message(conversation_id: str, user_id: str, stage1, stage2, stage3, metadata=None):
    with connection() as conn:
        ensure_user(conn, user_id)
        conn.execute(
            """
            insert into messages (conversation_id, user_id, role, stage1, stage2, stage3, metadata)
            values (%s, %s, 'assistant', %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb)
            """,
            (
                conversation_id,
                user_id,
                json_value(stage1),
                json_value(stage2),
                json_value(stage3),
                json_value(metadata),
            ),
        )
        conn.execute(
            "update conversations set updated_at = now() where id = %s and user_id = %s",
            (conversation_id, user_id),
        )
        conn.commit()


def update_conversation_title(conversation_id: str, user_id: str, title: str):
    with connection() as conn:
        ensure_user(conn, user_id)
        conn.execute(
            "update conversations set title = %s, updated_at = now() where id = %s and user_id = %s",
            (title, conversation_id, user_id),
        )
        conn.commit()


def delete_conversation(conversation_id: str, user_id: str) -> bool:
    with connection() as conn:
        result = conn.execute(
            "delete from conversations where id = %s and user_id = %s",
            (conversation_id, user_id),
        )
        conn.commit()
    return result.rowcount > 0


def delete_conversations(conversation_ids: list[str], user_id: str) -> int:
    if not conversation_ids:
        return 0
    with connection() as conn:
        result = conn.execute(
            "delete from conversations where user_id = %s and id = any(%s::uuid[])",
            (user_id, conversation_ids),
        )
        conn.commit()
    return result.rowcount


def get_model_config(user_id: str):
    with connection() as conn:
        ensure_user(conn, user_id)
        row = conn.execute(
            """
            select council_models, chairman_model, title_model
            from model_configs
            where user_id = %s
            """,
            (user_id,),
        ).fetchone()
        conn.commit()
    return row


def save_model_config(user_id: str, council_models, chairman_model, title_model):
    with connection() as conn:
        ensure_user(conn, user_id)
        conn.execute(
            """
            insert into model_configs (user_id, council_models, chairman_model, title_model)
            values (%s, %s::jsonb, %s, %s)
            on conflict (user_id) do update set
              council_models = excluded.council_models,
              chairman_model = excluded.chairman_model,
              title_model = excluded.title_model,
              updated_at = now()
            """,
            (user_id, json_value(council_models), chairman_model, title_model),
        )
        conn.commit()


def log_event(user_id: str, event: str, level="info", conversation_id=None, stage=None, model=None, message=None, metadata=None):
    with connection() as conn:
        ensure_user(conn, user_id)
        conn.execute(
            """
            insert into run_logs (id, user_id, conversation_id, level, event, stage, model, message, metadata)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (str(uuid.uuid4()), user_id, conversation_id, level, event, stage, model, message, json_value(metadata or {})),
        )
        conn.commit()


def list_logs(user_id: str, conversation_id=None, limit=200):
    with connection() as conn:
        ensure_user(conn, user_id)
        if conversation_id:
            rows = conn.execute(
                """
                select id::text, created_at, level, event, stage, model, message, metadata, conversation_id::text
                from run_logs
                where user_id = %s and conversation_id = %s
                order by created_at desc
                limit %s
                """,
                (user_id, conversation_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                select id::text, created_at, level, event, stage, model, message, metadata, conversation_id::text
                from run_logs
                where user_id = %s
                order by created_at desc
                limit %s
                """,
                (user_id, limit),
            ).fetchall()
        conn.commit()
    return [{**row, "created_at": iso(row["created_at"])} for row in rows]
