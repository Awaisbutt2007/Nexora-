import OpenAI from 'openai'
import { config, systemPromptFor } from '../config.js'

function createClient() {
  if (!config.openaiApiKey) return null
  return new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
  })
}

function buildMessages(history, userMemories = [], ctx = {}) {
  const memoryBlock = userMemories.length
    ? `\n\nKnown user context:\n${userMemories.map((m) => `- ${m.key}: ${m.value}`).join('\n')}`
    : ''

  return [
    { role: 'system', content: systemPromptFor(ctx) + memoryBlock },
    /* A turn with attached images becomes OpenAI-style multimodal content — a
       text part plus one image_url part per picture (base64 data URLs, because
       the provider cannot reach our localhost /uploads). */
    ...history.map((m) => (m.images?.length
      ? {
          role: m.role,
          content: [
            { type: 'text', text: m.content || `The user attached ${m.images.length} image${m.images.length > 1 ? 's' : ''}. Look at ${m.images.length > 1 ? 'them' : 'it'} and reply.` },
            ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        }
      : { role: m.role, content: m.content })),
  ]
}

/** Mock ChatGPT-style SSE stream when no API key is set */
async function* mockStream(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  /* Multimodal turns carry an array of parts — read the text part, not the object. */
  const raw = typeof lastUser?.content === 'string' ? lastUser.content : lastUser?.content?.[0]?.text
  const prompt = raw?.trim() || 'Hello'
  const reply =
    `I'm Nexora — your personal AI assistant.\n\n` +
    `You asked: “${prompt.slice(0, 280)}${prompt.length > 280 ? '…' : ''}”\n\n` +
    `This is mock mode (no OPENAI_API_KEY). Add a key in backend/.env to get real model replies. ` +
    `Until then I can still power the full ChatGPT-style streaming UI, conversations, memory, and tools.`

  for (const word of reply.split(/(\s+)/)) {
    if (!word) continue
    yield { content: word }
    await new Promise((r) => setTimeout(r, 12 + Math.random() * 28))
  }
}

export async function* streamChatCompletion({ history, memories, model, assistantName, userName, persona, language, signal }) {
  const messages = buildMessages(history, memories, { assistantName, userName, persona, language })
  const client = createClient()
  const usedModel = model || config.openaiModel

  if (!client) {
    for await (const chunk of mockStream(messages)) {
      if (signal?.aborted) break
      yield { ...chunk, model: 'nexora-mock' }
    }
    return
  }

  const stream = await client.chat.completions.create({
    model: usedModel,
    messages,
    max_tokens: 900,
    /* When the user pinned a specific language, cool the sampling down so the
       model sticks to the (mandatory) language rule instead of drifting back to
       English/Roman the way it can at the default temperature. */
    ...(language && language !== 'auto' ? { temperature: 0.35 } : {}),
    stream: true,
    stream_options: { include_usage: true },
  }, { signal })

  for await (const part of stream) {
    if (signal?.aborted) break
    const delta = part.choices?.[0]?.delta?.content
    if (delta) {
      yield { content: delta, model: usedModel, usage: null }
    }
    if (part.usage) {
      yield { content: '', model: usedModel, usage: part.usage, finish: true }
    }
  }
}

export async function completeChat({ history, memories, model, assistantName, userName, persona, language }) {
  const messages = buildMessages(history, memories, { assistantName, userName, persona, language })
  const client = createClient()
  const usedModel = model || config.openaiModel

  if (!client) {
    let text = ''
    for await (const chunk of mockStream(messages)) text += chunk.content
    return {
      content: text,
      model: 'nexora-mock',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  }

  const completion = await client.chat.completions.create({
    model: usedModel,
    messages,
    max_tokens: 900,
    ...(language && language !== 'auto' ? { temperature: 0.35 } : {}),
  })

  return {
    content: completion.choices[0]?.message?.content || '',
    model: usedModel,
    usage: completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

export function estimateCredits(usage) {
  if (!usage) return 1
  const total = usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
  return Math.max(1, Math.ceil(total / 100))
}
