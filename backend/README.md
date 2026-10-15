# Nexora Backend

ChatGPT-style API for the Nexora workspace: auth, conversations, **SSE streaming chat**, memory, tools, and plans/credits.

## Quick start

```bash
cd backend
npm install
cp .env.example .env   # already created locally
npm run dev
```

Server: `http://localhost:8787`

- Without `OPENAI_API_KEY` → mock streaming (full UI flow works)
- With key → real OpenAI (or any OpenAI-compatible `OPENAI_BASE_URL`) replies

## ChatGPT-inspired chat

```http
POST /api/chat/completions
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Plan my week",
  "stream": true,
  "conversationId": null
}
```

Streaming response is **SSE** (`text/event-stream`), same idea as OpenAI Chat Completions:

```
data: {"id":"chatcmpl_…","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}

data: [DONE]
```

Header `X-Conversation-Id` is set so the client can keep the thread.

Set `"stream": false` for a single JSON completion.

## Main routes

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| Chat | `POST /api/chat/completions` |
| Threads | `GET/POST /api/conversations`, `GET/PATCH/DELETE /api/conversations/:id` |
| Memory | `GET/POST /api/memory`, `DELETE /api/memory/:id` |
| Tools | `GET /api/tools`, `POST /api/tools/:toolId/run` |
| Plans | `GET /api/user/plans`, `POST /api/user/upgrade` `{ "plan": "pro" }` |

## Example: register → stream chat

```bash
# register
curl -s http://localhost:8787/api/auth/register -H "Content-Type: application/json" -d "{\"name\":\"Awai\",\"email\":\"awai@nexora.ai\",\"password\":\"secret12\"}"

# chat (replace TOKEN)
curl -N http://localhost:8787/api/chat/completions -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"message\":\"Explain Nexora in one line\",\"stream\":true}"
```

## Stack

- Node 22+ (`node:sqlite`)
- Express 5
- JWT + bcrypt
- OpenAI SDK (optional)
- Zod validation
