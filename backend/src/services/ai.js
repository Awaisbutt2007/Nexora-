import OpenAI from 'openai'
import { config, SYSTEM_PROMPT } from '../config.js'

function createClient() {
  if (!config.openaiApiKey) return null
  return new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
  })
}

function buildMessages(history, userMemories = []) {
  const memoryBlock = userMemories.length
    ? `\n\nKnown user context:\n${userMemories.map((m) => `- ${m.key}: ${m.value}`).join('\n')}`
    : ''

  return [
    { role: 'system', content: SYSTEM_PROMPT + memoryBlock },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ]
}

/** Mock ChatGPT-style SSE stream when no API key is set */
async function* mockStream(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const prompt = lastUser?.content?.trim() || 'Hello'
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

export async function* streamChatCompletion({ history, memories, model }) {
  const messages = buildMessages(history, memories)
  const client = createClient()
  const usedModel = model || config.openaiModel

  if (!client) {
    for await (const chunk of mockStream(messages)) {
      yield { ...chunk, model: 'nexora-mock' }
    }
    return
  }

  const stream = await client.chat.completions.create({
    model: usedModel,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  })

  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content
    if (delta) {
      yield { content: delta, model: usedModel, usage: null }
    }
    if (part.usage) {
      yield { content: '', model: usedModel, usage: part.usage, finish: true }
    }
  }
}

export async function completeChat({ history, memories, model }) {
  const messages = buildMessages(history, memories)
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
