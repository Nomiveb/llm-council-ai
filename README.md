# LLM Council

Private multi-model review app built around OpenRouter. A user asks once, several models answer in parallel, the same models peer-review anonymized answers, and a final model writes the synthesis.

## Current Defaults

New users start with these OpenRouter model ids:

```python
COUNCIL_MODELS = [
    "openai/gpt-5.5",
    "google/gemini-3.1-pro-preview",
    "moonshotai/kimi-k2.6",
    "x-ai/grok-4.3",
]

CHAIRMAN_MODEL = "anthropic/claude-sonnet-4.6"
TITLE_MODEL = "openai/gpt-5.4-nano"
```

Users can change models in the app UI. The values are saved per user when `DATABASE_URL` is configured.

## Production Setup

Recommended flow:

1. Push this folder to a private GitHub repository.
2. Import that private repo into Vercel.
3. Add the required Vercel environment variables.
4. Connect a fresh Neon Postgres database to the Vercel project.

Required Vercel env vars:

```text
AUTH_SECRET
APP_SECRET
INTERNAL_API_SECRET
API_KEY_ENCRYPTION_SECRET
AUTH_URL=https://llm-council-ai.vercel.app
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
DATABASE_URL
```

Google OAuth callback URL:

```text
https://llm-council-ai.vercel.app/api/auth/callback/google
```

`DATABASE_URL` comes from Neon. Without it, production will not persist chat history, model settings, API keys, or logs.

## Local Development

Install frontend dependencies:

```bash
cd frontend
npm install
```

Install backend dependencies:

```bash
python -m pip install -r backend/requirements.txt
```

Run the Next.js frontend:

```bash
cd frontend
npm run dev
```

Run the backend:

```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload
```

Local app URL:

```text
http://localhost:3000
```

## Storage

- Production: Neon Postgres via `DATABASE_URL`.
- Local fallback: JSON files under `data/conversations/` when `DATABASE_URL` is not set.
- User OpenRouter API keys are encrypted before being stored in Postgres.

## Stack

- Frontend: Next.js, React
- Auth: Auth.js with Google OAuth
- Backend: FastAPI
- Database: Neon Postgres
- LLM provider: OpenRouter
