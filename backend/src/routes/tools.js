import { Router } from 'express'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { getDb, nowIso } from '../db/index.js'
import { requireAuth, sanitizeUser } from '../middleware/auth.js'
import { deductCredits, ensureCredits } from '../services/credits.js'

const router = Router()
router.use(requireAuth)

export const TOOL_CATALOG = [
  {
    id: 'image_generator',
    name: 'Image Generator',
    description: 'Create striking images from a simple prompt.',
    creditCost: 20,
  },
  {
    id: 'code_assistant',
    name: 'Code Assistant',
    description: 'Write, debug, and explain code with context.',
    creditCost: 5,
  },
  {
    id: 'pdf_reader',
    name: 'PDF Reader',
    description: 'Ask questions and find details in any PDF.',
    creditCost: 8,
  },
  {
    id: 'youtube_notes',
    name: 'YouTube Notes',
    description: 'Turn long videos into clear takeaways.',
    creditCost: 10,
  },
  {
    id: 'meeting_notes',
    name: 'Meeting Notes',
    description: 'Capture decisions and next steps automatically.',
    creditCost: 8,
  },
  {
    id: 'social_studio',
    name: 'Social Studio',
    description: 'Shape one idea into content for every channel.',
    creditCost: 6,
  },
]

router.get('/', (_req, res) => {
  res.json({ object: 'list', data: TOOL_CATALOG })
})

router.get('/runs', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, tool, input_json AS input, output_json AS output, status,
              created_at AS createdAt, completed_at AS completedAt
       FROM tool_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(req.user.id)
    .map((r) => ({
      ...r,
      input: safeJson(r.input),
      output: safeJson(r.output),
    }))

  res.json({ object: 'list', data: rows })
})

router.post('/:toolId/run', (req, res, next) => {
  try {
    const tool = TOOL_CATALOG.find((t) => t.id === req.params.toolId)
    if (!tool) {
      return res.status(404).json({ error: { message: 'Unknown tool', type: 'not_found' } })
    }

    const schema = z.object({
      prompt: z.string().trim().min(1).max(8000).optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    })
    const body = schema.parse(req.body || {})
    const payload = {
      prompt: body.prompt || '',
      ...(body.input || {}),
    }

    ensureCredits(req.user, tool.creditCost)

    const id = `run_${nanoid(16)}`
    const stamp = nowIso()
    const output = mockToolOutput(tool, payload)

    getDb()
      .prepare(
        `INSERT INTO tool_runs (id, user_id, tool, input_json, output_json, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)`,
      )
      .run(id, req.user.id, tool.id, JSON.stringify(payload), JSON.stringify(output), stamp, stamp)

    const updated = deductCredits(req.user.id, tool.creditCost)

    res.status(201).json({
      id,
      tool: tool.id,
      status: 'completed',
      output,
      creditsCharged: tool.creditCost,
      user: sanitizeUser(updated),
      createdAt: stamp,
      completedAt: stamp,
    })
  } catch (err) {
    next(err)
  }
})

function safeJson(value) {
  if (value == null) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function mockToolOutput(tool, payload) {
  const prompt = payload.prompt || JSON.stringify(payload)

  switch (tool.id) {
    case 'image_generator':
      return {
        type: 'image',
        prompt,
        imageUrl: null,
        note: 'Mock mode: connect an image provider (DALL·E / Flux) to return real images.',
        placeholder: `Generated concept for: ${prompt.slice(0, 120)}`,
      }
    case 'code_assistant':
      return {
        type: 'code',
        language: 'javascript',
        explanation: `Here is a starting point for: ${prompt.slice(0, 160)}`,
        code: `// Nexora Code Assistant\n// Request: ${prompt.slice(0, 80)}\n\nfunction solve() {\n  // TODO: implement\n  return true;\n}\n\nconsole.log(solve());\n`,
      }
    case 'pdf_reader':
      return {
        type: 'document',
        summary: `PDF analysis ready for: ${prompt.slice(0, 160)}`,
        highlights: ['Upload a PDF via /api/files to enable real extraction.', 'Ask follow-up questions in Chat.'],
      }
    case 'youtube_notes':
      return {
        type: 'notes',
        title: 'YouTube Notes',
        bullets: [
          `Topic focus: ${prompt.slice(0, 100)}`,
          'Key takeaway 1 — context & problem',
          'Key takeaway 2 — solution steps',
          'Action item — try this in Nexora Chat',
        ],
      }
    case 'meeting_notes':
      return {
        type: 'meeting',
        decisions: ['Capture attendees and agenda next.'],
        actionItems: [{ owner: 'You', task: prompt.slice(0, 120) || 'Follow up', due: null }],
      }
    case 'social_studio':
      return {
        type: 'social',
        variants: {
          twitter: prompt.slice(0, 240),
          linkedin: `Insight:\n\n${prompt}\n\n— via Nexora`,
          instagram: `${prompt.slice(0, 180)}\n\n#Nexora #AI`,
        },
      }
    default:
      return { type: 'generic', result: prompt }
  }
}

export default router
