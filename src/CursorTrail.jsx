import React, { useEffect, useRef } from 'react'
import './CursorTrail.css'

export default function CursorTrail() {
  const canvasRef = useRef(null)

  useEffect(() => {
    // Only run on devices with a fine pointer (mouse)
    if (window.matchMedia('(pointer: coarse)').matches) {
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId
    let width = (canvas.width = window.innerWidth)
    let height = (canvas.height = window.innerHeight)

    const handleResize = () => {
      width = canvas.width = window.innerWidth
      height = canvas.height = window.innerHeight
    }
    window.addEventListener('resize', handleResize)

    let mouse = { x: -100, y: -100 }
    let lastSpawn = { x: -100, y: -100 }

    // Particles array
    const particles = []
    const colors = [
      'rgba(85, 216, 255, ',    // Cyan
      'rgba(168, 102, 255, ',   // Violet
      'rgba(189, 66, 239, ',    // Magenta
      'rgba(255, 104, 215, ',   // Pink
      'rgba(114, 226, 255, '    // Bright Blue
    ]

    class Particle {
      constructor(x, y, isBurst = false) {
        this.x = x
        this.y = y
        const angle = Math.random() * Math.PI * 2
        const speed = isBurst ? Math.random() * 2.6 + 1.0 : Math.random() * 0.8 + 0.2
        this.vx = Math.cos(angle) * speed
        this.vy = Math.sin(angle) * speed - (isBurst ? 0.4 : 0.15)
        this.baseColor = colors[Math.floor(Math.random() * colors.length)]
        this.size = isBurst ? Math.random() * 5 + 3 : Math.random() * 4.2 + 2.2
        this.alpha = isBurst ? 0.95 : 0.8
        this.decay = isBurst ? Math.random() * 0.03 + 0.02 : Math.random() * 0.022 + 0.016
        this.rotation = Math.random() * Math.PI * 2
        this.rotSpeed = (Math.random() - 0.5) * 0.12
      }

      update() {
        this.x += this.vx
        this.y += this.vy
        this.vx *= 0.96
        this.vy *= 0.96
        this.size *= 0.96
        this.alpha -= this.decay
        this.rotation += this.rotSpeed
      }

      draw(c) {
        if (this.alpha <= 0 || this.size <= 0.2) return
        c.save()
        c.translate(this.x, this.y)
        c.rotate(this.rotation)

        // Draw glowing particle star/circle
        const grad = c.createRadialGradient(0, 0, 0, 0, 0, this.size * 2)
        grad.addColorStop(0, `${this.baseColor}${this.alpha})`)
        grad.addColorStop(0.45, `${this.baseColor}${this.alpha * 0.55})`)
        grad.addColorStop(1, `${this.baseColor}0)`)

        c.fillStyle = grad
        c.beginPath()
        c.arc(0, 0, this.size * 1.8, 0, Math.PI * 2)
        c.fill()

        // Core bright center
        c.fillStyle = `rgba(255, 255, 255, ${this.alpha * 0.95})`
        c.beginPath()
        c.arc(0, 0, Math.max(0.5, this.size * 0.38), 0, Math.PI * 2)
        c.fill()

        c.restore()
      }
    }

    const spawnParticles = (x, y, count = 2, isBurst = false) => {
      for (let i = 0; i < count; i++) {
        if (particles.length < 130) {
          particles.push(new Particle(x, y, isBurst))
        }
      }
    }

    const handleMouseMove = (e) => {
      mouse.x = e.clientX
      mouse.y = e.clientY

      const dx = mouse.x - lastSpawn.x
      const dy = mouse.y - lastSpawn.y
      const dist = Math.hypot(dx, dy)

      if (dist > 7) {
        spawnParticles(mouse.x, mouse.y, Math.min(3, Math.floor(dist / 10) + 1), false)
        lastSpawn.x = mouse.x
        lastSpawn.y = mouse.y
      }
    }

    const handleMouseDown = (e) => {
      spawnParticles(e.clientX, e.clientY, 8, true)
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    window.addEventListener('mousedown', handleMouseDown)

    // Animation Loop
    const render = () => {
      ctx.clearRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'lighter'

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.update()
        p.draw(ctx)
        if (p.alpha <= 0 || p.size <= 0.2) {
          particles.splice(i, 1)
        }
      }

      animationFrameId = requestAnimationFrame(render)
    }

    animationFrameId = requestAnimationFrame(render)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mousedown', handleMouseDown)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <div className="custom-cursor-container" aria-hidden="true">
      {/* Canvas for glowing trail particles only */}
      <canvas ref={canvasRef} className="custom-cursor-canvas" />
    </div>
  )
}
