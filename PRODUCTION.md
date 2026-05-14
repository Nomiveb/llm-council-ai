# Production Setup

This project is prepared for Vercel Services + Neon Postgres.

## Required Vercel Environment Variables

- `DATABASE_URL`: Neon pooled Postgres connection string.
- `AUTH_SECRET`: random Auth.js secret.
- `APP_SECRET`: random long secret used to derive encryption keys.
- `API_KEY_ENCRYPTION_SECRET`: optional dedicated encryption secret for user OpenRouter keys.
- `INTERNAL_API_SECRET`: shared secret used by Next.js proxy when calling FastAPI.
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: Google OAuth credentials for Auth.js.
- `AUTH_URL`: production app URL, for example `https://llm-council-ai.vercel.app`.
- `OPENROUTER_API_KEY`: optional global fallback key. Per-user keys can be saved in the UI.
- `INTERNAL_BACKEND_URL`: optional. With Vercel Services, `API_URL` should be auto-generated for the `api` service.

## Vercel

Use the Services framework preset. The root `vercel.json` defines:

- `frontend` at `/`
- FastAPI backend at `/backend`

The browser calls Next.js `/api/*`. Next.js authenticates with Auth.js, then proxies to the FastAPI service.

## Neon

When `DATABASE_URL` is present, the backend automatically creates these tables:

- `app_users`
- `conversations`
- `messages`
- `model_configs`
- `api_keys`
- `run_logs`

Local development without `DATABASE_URL` still falls back to JSON files in `data/`.

## Auth.js Boundary

The public app is now Next.js with Auth.js. Browser requests go to Next `/api/*`.
Next verifies the session, forwards a trusted `x-user-id`, and adds `x-internal-api-secret`
when proxying to FastAPI.

Set `INTERNAL_API_SECRET` in both services so direct calls to `/backend/api/*` are rejected.

Google OAuth redirect URI:

```txt
https://llm-council-ai.vercel.app/api/auth/callback/google
```

Local redirect URI:

```txt
http://localhost:3000/api/auth/callback/google
```

## Logs

Backend run logs are stored in `run_logs` when `DATABASE_URL` is enabled and are available at:

```txt
GET /api/logs
GET /api/logs?conversation_id=<id>
```

Each council run logs:

- run started/completed/failed
- stage started/completed
- selected models
- conversation id
- errors

For Vercel production, also use Runtime Logs and preferably a Log Drain/Sentry/Datadog for external observability.
