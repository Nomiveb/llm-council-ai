import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import db  # noqa: E402


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import local JSON conversations into the Postgres production store."
    )
    parser.add_argument(
        "--user-id",
        default=os.getenv("IMPORT_USER_ID"),
        help="Auth.js/Google user id that should own the imported conversations.",
    )
    parser.add_argument(
        "--source",
        default=str(ROOT / "data" / "conversations"),
        help="Folder with local conversation JSON files.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing conversations with the same ids for this user.",
    )
    return parser.parse_args()


def normalize_messages(raw_messages):
    messages = []
    for index, message in enumerate(raw_messages or []):
        if not isinstance(message, dict):
            continue
        role = message.get("role") or "assistant"
        content = message.get("content") or ""
        metadata = {
            key: value
            for key, value in message.items()
            if key not in {"id", "conversation_id", "role", "content", "created_at"}
        }
        messages.append(
            {
                "id": message.get("id"),
                "role": role,
                "content": content,
                "metadata": metadata,
                "created_at": message.get("created_at"),
                "position": index,
            }
        )
    return messages


def load_conversation(path):
    with path.open("r", encoding="utf-8") as file:
        conversation = json.load(file)
    conversation.setdefault("id", path.stem)
    conversation.setdefault("title", "Imported conversation")
    conversation.setdefault("messages", [])
    return conversation


def import_conversation(conn, user_id, conversation, overwrite=False):
    conversation_id = conversation["id"]
    exists = conn.execute(
        "select id from conversations where id = %s and user_id = %s",
        (conversation_id, user_id),
    ).fetchone()

    if exists and not overwrite:
        return "skipped"

    if exists and overwrite:
        conn.execute(
            "delete from conversations where id = %s and user_id = %s",
            (conversation_id, user_id),
        )

    conn.execute(
        """
        insert into conversations (id, user_id, title, created_at, updated_at)
        values (%s, %s, %s, coalesce(%s::timestamptz, now()), coalesce(%s::timestamptz, now()))
        """,
        (
            conversation_id,
            user_id,
            conversation.get("title") or "Imported conversation",
            conversation.get("created_at"),
            conversation.get("updated_at") or conversation.get("created_at"),
        ),
    )

    for message in normalize_messages(conversation.get("messages")):
        conn.execute(
            """
            insert into messages (id, conversation_id, user_id, role, content, metadata, created_at)
            values (
                coalesce(%s::uuid, gen_random_uuid()),
                %s,
                %s,
                %s,
                %s,
                %s::jsonb,
                coalesce(%s::timestamptz, now())
            )
            """,
            (
                message["id"],
                conversation_id,
                user_id,
                message["role"],
                message["content"],
                json.dumps(message["metadata"]),
                message["created_at"],
            ),
        )

    return "imported"


def main():
    args = parse_args()
    if not os.getenv("DATABASE_URL"):
        raise SystemExit("DATABASE_URL is required. Pull it from Vercel or set it locally first.")
    if not args.user_id:
        raise SystemExit("User id is required. Pass --user-id or set IMPORT_USER_ID.")

    source = Path(args.source)
    files = sorted(source.glob("*.json"))
    if not files:
        raise SystemExit(f"No conversation JSON files found in {source}")

    counts = {"imported": 0, "skipped": 0}
    with db.get_conn() as conn:
        db.ensure_schema(conn)
        db.ensure_user(conn, args.user_id)
        for path in files:
            status = import_conversation(
                conn,
                args.user_id,
                load_conversation(path),
                overwrite=args.overwrite,
            )
            counts[status] += 1

    print(f"Imported: {counts['imported']}")
    print(f"Skipped existing: {counts['skipped']}")


if __name__ == "__main__":
    main()
