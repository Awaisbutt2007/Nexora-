import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { config } from '../config.js'
import { getDb, nowIso } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import {
  cosineSimilarity,
  deserializeEmbedding,
  extractEmbedding,
  serializeEmbedding,
} from '../services/voice.js'

const router = Router()
router.use(requireAuth)

/* Browser MediaRecorder sends webm/opus; WAV and MP4 are accepted for other clients. */
const ALLOWED_EXT = new Set(['.webm', '.wav', '.mp4', '.m4a', '.ogg'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

const enrollSchema = z.object({
  label: z.string().trim().max(80).optional(),
})

function saveSample(buffer, originalName) {
  const ext = ALLOWED_EXT.has(path.extname(originalName || '').toLowerCase())
    ? path.extname(originalName).toLowerCase()
    : '.webm'
  const fileName = `voice_${nanoid(16)}${ext}`
  const filePath = path.join(config.uploadsDir, fileName)
  fs.writeFileSync(filePath, buffer)
  return { fileName, filePath }
}

function printRow(row) {
  return {
    id: row.id,
    label: row.label || null,
    samplePath: row.sample_path,
    createdAt: row.created_at,
  }
}

/* List the caller's enrolled voice prints (no embedding bytes). */
router.get('/prints', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, label, sample_path, created_at FROM voice_prints
       WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(req.user.id)
  res.json({ object: 'list', data: rows.map(printRow) })
})

/* Enroll: save the recording under uploads/ and store its embedding as a BLOB. */
router.post('/enroll', upload.single('sample'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer?.length) {
      return res.status(400).json({
        error: { message: 'Multipart field "sample" (audio recording) is required', type: 'invalid_request_error' },
      })
    }
    const body = enrollSchema.parse(req.body || {})

    const { fileName, filePath } = saveSample(req.file.buffer, req.file.originalname)
    let embedding
    try {
      embedding = await extractEmbedding(filePath)
    } catch (err) {
      fs.unlinkSync(filePath)
      throw err
    }

    const id = `vpr_${nanoid(16)}`
    const stamp = nowIso()
    getDb()
      .prepare(
        `INSERT INTO voice_prints (id, user_id, label, embedding, sample_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, req.user.id, body.label || null, serializeEmbedding(embedding), `uploads/${fileName}`, stamp)

    const count = getDb()
      .prepare('SELECT COUNT(*) AS n FROM voice_prints WHERE user_id = ?')
      .get(req.user.id).n

    res.status(201).json({
      id,
      label: body.label || null,
      samplePath: `uploads/${fileName}`,
      dimensions: embedding.length,
      printsEnrolled: count,
      createdAt: stamp,
    })
  } catch (err) {
    next(err)
  }
})

/* Verify: compare a live sample against every stored print, best score wins. */
router.post('/verify', upload.single('sample'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer?.length) {
      return res.status(400).json({
        error: { message: 'Multipart field "sample" (audio recording) is required', type: 'invalid_request_error' },
      })
    }

    const prints = getDb()
      .prepare('SELECT id, embedding FROM voice_prints WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.user.id)
    if (prints.length === 0) {
      return res.status(404).json({
        error: { message: 'No voice print enrolled for this user', type: 'not_found' },
      })
    }

    const { filePath } = saveSample(req.file.buffer, req.file.originalname)
    let probe
    try {
      probe = await extractEmbedding(filePath)
    } catch (err) {
      fs.unlinkSync(filePath)
      throw err
    }
    /* The verify probe is only used for its embedding; keep uploads/ clean. */
    fs.unlinkSync(filePath)

    let bestScore = -1
    let bestId = null
    for (const print of prints) {
      const score = cosineSimilarity(probe, deserializeEmbedding(print.embedding))
      if (score > bestScore) {
        bestScore = score
        bestId = print.id
      }
    }

    const threshold = config.voiceMatchThreshold
    res.json({
      matched: bestScore >= threshold,
      confidence: Math.round(bestScore * 1000) / 1000,
      threshold,
      matchedPrintId: bestScore >= threshold ? bestId : null,
      printsCompared: prints.length,
      dimensions: probe.length,
    })
  } catch (err) {
    next(err)
  }
})

/* Delete one of the caller's voice prints and its stored sample. */
router.delete('/prints/:id', (req, res, next) => {
  try {
    const row = getDb()
      .prepare('SELECT id, sample_path FROM voice_prints WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id)
    if (!row) {
      return res.status(404).json({ error: { message: 'Voice print not found', type: 'not_found' } })
    }

    getDb().prepare('DELETE FROM voice_prints WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
    if (row.sample_path) {
      const sampleFile = path.join(config.rootDir, row.sample_path)
      if (fs.existsSync(sampleFile)) fs.unlinkSync(sampleFile)
    }
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
