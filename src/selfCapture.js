/**
 * selfCapture — the assistant's own eyes on the app.
 *
 * When the user asks to see Aira's face, her settings or what is on her screen, the
 * honest answer is a photograph of the live app, not a picture drawn by an image
 * model. This module produces exactly that, from inside the page:
 *
 *  - captureNode()   → any live element (the current page panel, the whole workspace)
 *  - captureSelfFace() → her real animated particle face, mounted off-screen for the
 *                        shot so it works even mid-thread where no face is on screen
 *
 * modern-screenshot clones the DOM into an SVG <foreignObject>, which the browser then
 * renders with its own CSS engine — so gradients, glass blur and webfonts come out
 * exactly as the user sees them (html2canvas reimplements CSS and gets this wrong).
 * Everything is downscaled to a JPEG small enough for the 1.5 MB upload gate.
 */

import { createElement, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { domToJpeg } from 'modern-screenshot'

/* Same lazy chunk the workspace already loads — importing it statically would pull
   three.js into the main bundle for a feature that runs a few times a session. */
const NanoParticles = lazy(() => import('./NanoParticles.jsx'))

const APP_BG = '#080b1a'
const FACE_STAGE = 420
const MAX_EDGE = 1280

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* A data URL straight out of the capture can be several MB at full width; the upload
   endpoint refuses anything over 1.5 MB, so re-encode through a canvas. */
async function shrink(dataUrl, maxWidth = MAX_EDGE, quality = 0.82) {
  const img = await new Promise((resolve, reject) => {
    const node = new Image()
    node.onload = () => resolve(node)
    node.onerror = () => reject(new Error('The screenshot could not be read back'))
    node.src = dataUrl
  })
  const scale = Math.min(1, maxWidth / (img.width || maxWidth))
  if (scale >= 1 && dataUrl.length < 1_600_000) return dataUrl
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = APP_BG
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

/** PNG/JPEG data URL of a live element — defaults to the whole workspace. */
export async function captureNode(el, { background = APP_BG, maxWidth = MAX_EDGE } = {}) {
  const target = el || document.getElementById('workspace') || document.body
  const dataUrl = await domToJpeg(target, { backgroundColor: background, quality: 0.86, scale: 1, width: target.offsetWidth, height: target.offsetHeight })
  return shrink(dataUrl, maxWidth)
}

/** Data URL of whatever page is currently mounted (Chat, Memory, Settings, …). */
export function captureCurrentPage() {
  return captureNode(document.querySelector('.workspace-page-panel') || document.getElementById('workspace'))
}

/* The particle canvas is transparent, so the shot is composited over the same deep
   gradient the chat hero uses — otherwise the JPEG would carry a flat black box. */
function compositeFace(canvas) {
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  const ctx = out.getContext('2d')
  const grad = ctx.createLinearGradient(0, 0, 0, out.height)
  grad.addColorStop(0, '#101736')
  grad.addColorStop(1, APP_BG)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(canvas, 0, 0)
  return out.toDataURL('image/jpeg', 0.88)
}

/**
 * Her real face, rendered off-screen and photographed. Needs a few seconds: the
 * portrait assembles from scattered particles, and a shot of frame one is a cloud,
 * not a face — so we wait for the canvas AND for the model to resolve.
 */
export async function captureSelfFace({ shape = 'female', frames = 150 } = {}) {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${FACE_STAGE}px;height:${FACE_STAGE}px;overflow:hidden;background:${APP_BG}`
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    root.render(createElement(Suspense, { fallback: null }, createElement(NanoParticles, { count: 16000, shape, state: 'idle' })))
    let canvas = null
    for (let i = 0; i < 240 && !canvas; i += 1) {
      await settle(50)
      canvas = host.querySelector('canvas')
    }
    if (!canvas || !canvas.width) throw new Error('My face renderer did not start in time')
    for (let i = 0; i < frames; i += 1) await nextFrame()
    return await shrink(compositeFace(canvas), 900, 0.9)
  } finally {
    root.unmount()
    host.remove()
  }
}
