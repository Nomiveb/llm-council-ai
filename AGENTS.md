# AGENTS.md - Technical Notes for LLM Council

This file contains technical details, architectural decisions, and important implementation notes for future development sessions.

## Project Overview

LLM Council is a 3-stage deliberation system where multiple LLMs collaboratively answer user questions. The key innovation is anonymized peer review in Stage 2, preventing models from playing favorites.

## Architecture

### Backend Structure (`backend/`)

**`config.py`**
- Contains `COUNCIL_MODELS` (list of OpenRouter model identifiers)
- Contains `CHAIRMAN_MODEL` (model that synthesizes final answer)
- Contains `TITLE_MODEL` (model that generates conversation titles)
- Uses per-user encrypted OpenRouter API keys when `DATABASE_URL` is configured, with `OPENROUTER_API_KEY` as an optional fallback
- Backend runs on **port 8001** (NOT 8000 - user had another app on 8000)

**`openrouter.py`**
- `query_model()`: Single async model query
- `query_models_parallel()`: Parallel queries using `asyncio.gather()`
- Returns dict with 'content' and optional 'reasoning_details'
- Graceful degradation: returns None on failure, continues with successful responses

**`council.py`** - The Core Logic
- `stage1_collect_responses()`: Parallel queries to all council models
- `stage2_collect_rankings()`:
  - Anonymizes responses as "Response A, B, C, etc."
  - Creates `label_to_model` mapping for de-anonymization
  - Prompts models to evaluate and rank (with strict format requirements)
  - Returns tuple: (rankings_list, label_to_model_dict)
  - Each ranking includes both raw text and `parsed_ranking` list
- `stage3_synthesize_final()`: Chairman synthesizes from all responses + rankings
- `parse_ranking_from_text()`: Extracts "FINAL RANKING:" section, handles both numbered lists and plain format
- `calculate_aggregate_rankings()`: Computes average rank position across all peer evaluations

**`storage.py`**
- Neon Postgres storage when `DATABASE_URL` is configured, JSON fallback in `data/conversations/`
- Each conversation: `{id, created_at, messages[]}`
- Assistant messages contain: `{role, stage1, stage2, stage3}`
- Metadata such as `label_to_model`, `aggregate_rankings`, and `model_config` is persisted for assistant messages in Postgres

**`main.py`**
- FastAPI app with CORS enabled for local development
- POST `/api/conversations/{id}/message` returns metadata in addition to stages
- Metadata includes: label_to_model mapping and aggregate_rankings
- Production requests should go through the Next.js app `/api/*` proxy/rewrite, which forwards `x-user-id` and `x-internal-api-secret` to the FastAPI service

### Frontend Structure

**`frontend/app/`**
- Next.js App Router pages and API route handlers
- Auth.js routes live at `frontend/app/api/auth/[...nextauth]/route.js`
- Production API traffic is routed through `frontend/proxy.js`

**`App.jsx`**
- Main orchestration: manages conversations list and current conversation
- Handles message sending and metadata storage
- Metadata is stored in UI state during streaming and persisted in Postgres when `DATABASE_URL` is configured

**`components/ChatInterface.jsx`**
- Multiline textarea (3 rows, resizable)
- Enter to send, Shift+Enter for new line
- User messages wrapped in markdown-content class for padding

**`components/CouncilResponse.jsx`**
- Renders current stage, individual responses, peer review, and final answer
- Expands anonymized peer-review labels back to model names for user readability
- Shows aggregate rankings when present

**Styling (`*.css`)**
- Light and dark theme support via CSS variables
- Global markdown styling in `index.css` with `.markdown-content` class

## Key Design Decisions

### Stage 2 Prompt Format
The Stage 2 prompt is very specific to ensure parseable output:
```
1. Evaluate each response individually first
2. Provide "FINAL RANKING:" header
3. Numbered list format: "1. Response C", "2. Response A", etc.
4. No additional text after ranking section
```

This strict format allows reliable parsing while still getting thoughtful evaluations.

### De-anonymization Strategy
- Models receive: "Response A", "Response B", etc.
- Backend creates mapping: `{"Response A": "openai/gpt-5.5", ...}`
- Frontend displays model names in **bold** for readability
- Users see explanation that original evaluation used anonymous labels
- This prevents bias while maintaining transparency

### Error Handling Philosophy
- Continue with successful responses if some models fail (graceful degradation)
- Never fail the entire request due to single model failure
- Log errors but don't expose to user unless all models fail

### UI/UX Transparency
- All raw outputs are inspectable via tabs
- Parsed rankings shown below raw text for validation
- Users can verify system's interpretation of model outputs
- This builds trust and allows debugging of edge cases

## Important Implementation Details

### Imports on Vercel
Vercel's Python service imports the FastAPI entrypoint as `main.py`, so backend modules use absolute imports after `backend/main.py` inserts its directory into `sys.path`. Do not switch these back to package-relative imports without testing Vercel.

### Port Configuration
- Backend: 8001 (changed from 8000 to avoid conflict)
- Frontend: 3000 (Next.js default)
- Update both `backend/main.py` and `frontend/src/api.js` if changing

### Markdown Rendering
All ReactMarkdown components must be wrapped in `<div className="markdown-content">` for proper spacing. This class is defined globally in `index.css`.

### Model Configuration
Defaults live in `backend/config.py`, but production users should change models in the site UI. Current defaults are:
- Council: `openai/gpt-5.5`, `google/gemini-3.1-pro-preview`, `moonshotai/kimi-k2.6`, `x-ai/grok-4.3`
- Final answer: `anthropic/claude-sonnet-4.6`
- Title: `openai/gpt-5.4-nano`

## Common Gotchas

1. **Module Import Errors**: Production Vercel Python imports differ from local package execution; test both local compile and Vercel deploy logs
2. **CORS Issues**: Frontend must match allowed origins in `main.py` CORS middleware
3. **Ranking Parse Failures**: If models don't follow format, fallback regex extracts any "Response X" patterns in order
4. **Missing Metadata**: Metadata is ephemeral (not persisted), only available in API responses

## Future Enhancement Ideas

- Export conversations to markdown/PDF
- Model performance analytics over time
- Custom ranking criteria (not just accuracy/insight)
- Support for reasoning models (o1, etc.) with special handling

## Testing Notes

Use `test_openrouter.py` to verify API connectivity and test different model identifiers before adding to council. The script tests both streaming and non-streaming modes.

## Data Flow Summary

```
User Query
    ↓
Stage 1: Parallel queries → [individual responses]
    ↓
Stage 2: Anonymize → Parallel ranking queries → [evaluations + parsed rankings]
    ↓
Aggregate Rankings Calculation → [sorted by avg position]
    ↓
Stage 3: Chairman synthesis with full context
    ↓
Return: {stage1, stage2, stage3, metadata}
    ↓
Frontend: Display with tabs + validation UI
```

The entire flow is async/parallel where possible to minimize latency.
