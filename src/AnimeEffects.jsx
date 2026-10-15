import { useEffect } from 'react'
import { animate, stagger } from 'animejs'
import './AnimeEffects.css'

/**
 * Splits text nodes in an element into 3D animatable word tokens,
 * preserving HTML tags (like <span>, <br>, etc.)
 */
function splitInto3DWords(element) {
  if (!element) return []
  if (element.dataset.split) {
    return Array.from(element.querySelectorAll('.anime-3d-word'))
  }
  element.dataset.split = 'true'
  element.classList.add('anime-3d-scene')

  const words = []

  function traverse(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent
      if (!text.trim()) return

      const fragment = document.createDocumentFragment()
      const parts = text.split(/(\s+)/)

      parts.forEach((part) => {
        if (/^\s+$/.test(part)) {
          fragment.appendChild(document.createTextNode(part))
        } else if (part.length > 0) {
          const wrapper = document.createElement('span')
          wrapper.className = 'anime-3d-word-wrapper'

          const inner = document.createElement('span')
          inner.className = 'anime-3d-word'
          inner.textContent = part

          wrapper.appendChild(inner)
          fragment.appendChild(wrapper)
          words.push(inner)
        }
      })

      node.parentNode.replaceChild(fragment, node)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName.toLowerCase() !== 'button' && !node.classList.contains('avatar-stack')) {
        Array.from(node.childNodes).forEach(traverse)
      }
    }
  }

  Array.from(element.childNodes).forEach(traverse)
  return words
}

export default function AnimeEffects() {
  useEffect(() => {
    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      return
    }

    // =========================================================================
    // 1. HERO ENTRANCE ANIMATIONS (Triggers immediately on reload / initial load)
    // =========================================================================
    const heroTitle = document.querySelector('.hero-copy h1')
    const heroDesc = document.querySelector('.hero-copy .hero-description')
    const heroPill = document.querySelector('.hero-copy .assistant-pill')
    const heroTabs = document.querySelector('.hero-copy .segmented-tabs')
    const heroActions = document.querySelector('.hero-copy .hero-actions')
    const heroProof = document.querySelector('.hero-copy .social-proof')
    const heroNote = document.querySelector('.hero-copy .hero-note')
    const heroArt = document.querySelector('.hero-art-shell')
    const trustRow = document.querySelector('.trust-row')

    // Animate Pill Badge
    if (heroPill) {
      animate(heroPill, {
        translateY: [-22, 0],
        opacity: [0, 1],
        scale: [0.92, 1],
        duration: 800,
        delay: 80,
        ease: 'outExpo'
      })
    }

    // Animate Hero 3D Kinetic Title
    if (heroTitle) {
      const titleWords = splitInto3DWords(heroTitle)
      if (titleWords.length > 0) {
        animate(titleWords, {
          rotateX: [-80, 0],
          translateY: [46, 0],
          translateZ: [-40, 0],
          scale: [0.86, 1],
          opacity: [0, 1],
          duration: 1000,
          delay: stagger(55, { start: 160 }),
          ease: 'outExpo'
        })
      }
    }

    // Animate Hero Subtitle / Description
    if (heroDesc) {
      animate(heroDesc, {
        translateY: [30, 0],
        opacity: [0, 1],
        duration: 900,
        delay: 460,
        ease: 'outExpo'
      })
    }

    // Animate Hero Segmented Mode Tabs
    if (heroTabs) {
      animate(heroTabs, {
        translateY: [26, 0],
        opacity: [0, 1],
        duration: 800,
        delay: 600,
        ease: 'outExpo'
      })
    }

    // Animate Hero Action Buttons
    if (heroActions) {
      animate(heroActions, {
        translateY: [26, 0],
        scale: [0.94, 1],
        opacity: [0, 1],
        duration: 850,
        delay: 720,
        ease: 'outExpo'
      })
    }

    // Animate Social Proof & Small Note
    const heroFooters = [heroNote, heroProof].filter(Boolean)
    if (heroFooters.length > 0) {
      animate(heroFooters, {
        translateY: [22, 0],
        opacity: [0, 1],
        duration: 850,
        delay: stagger(90, { start: 820 }),
        ease: 'outExpo'
      })
    }

    // Animate 3D Assistant Artwork Companion
    if (heroArt) {
      animate(heroArt, {
        scale: [0.9, 1],
        translateY: [45, 0],
        opacity: [0, 1],
        duration: 1200,
        delay: 200,
        ease: 'outExpo'
      })
    }

    // Animate Trust Row Highlights
    if (trustRow) {
      animate(trustRow, {
        translateY: [24, 0],
        opacity: [0, 1],
        duration: 900,
        delay: 950,
        ease: 'outExpo'
      })
    }

    // =========================================================================
    // 2. SCROLL REVEAL ANIMATIONS (Triggers dynamically as user scrolls down)
    // =========================================================================
    if (!('IntersectionObserver' in window)) {
      // Fallback for browsers without IntersectionObserver
      document.querySelectorAll('.anime-3d-word, .feature-card, .testimonial-card, .plan-card, .showcase-tool, .showcase-mockup, .faq-item, .feature-list li').forEach((el) => {
        el.style.opacity = '1'
        el.style.transform = 'none'
      })
      return
    }

    // A. Section Headings & Text on Scroll
    const sectionContainers = document.querySelectorAll(
      '.section-heading, .tools-heading, .closing-cta, .footer-cta-banner'
    )

    const sectionHeadingsMap = new Map()

    sectionContainers.forEach((container) => {
      const eyebrow = container.querySelector('.eyebrow')
      const h2 = container.querySelector('h2')
      const desc = container.querySelector('p:not(.eyebrow)')
      const extra = container.querySelector('.tools-heading button, .plans-note, .closing-actions, .cta-spark')

      let words = []
      if (h2) {
        words = splitInto3DWords(h2)
      }

      if (eyebrow) {
        eyebrow.style.opacity = '0'
        eyebrow.style.transform = 'translateY(18px)'
      }
      if (desc) {
        desc.style.opacity = '0'
        desc.style.transform = 'translateY(24px)'
      }
      if (extra) {
        extra.style.opacity = '0'
        extra.style.transform = 'translateY(22px)'
      }

      sectionHeadingsMap.set(container, { eyebrow, h2, words, desc, extra })
    })

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const container = entry.target
            const data = sectionHeadingsMap.get(container)

            if (data) {
              const { eyebrow, words, desc, extra } = data

              // Eyebrow reveal
              if (eyebrow) {
                animate(eyebrow, {
                  translateY: [18, 0],
                  opacity: [0, 1],
                  duration: 650,
                  ease: 'outExpo'
                })
              }

              // H2 kinetic words stagger reveal
              if (words && words.length > 0) {
                animate(words, {
                  rotateX: [-75, 0],
                  translateY: [36, 0],
                  translateZ: [-30, 0],
                  scale: [0.88, 1],
                  opacity: [0, 1],
                  duration: 900,
                  delay: stagger(35, { start: 60 }),
                  ease: 'outExpo'
                })
              }

              // Subtitle paragraph reveal
              if (desc) {
                animate(desc, {
                  translateY: [24, 0],
                  opacity: [0, 1],
                  duration: 800,
                  delay: 180,
                  ease: 'outExpo'
                })
              }

              // Extra elements (CTA button / note / spark)
              if (extra) {
                animate(extra, {
                  translateY: [22, 0],
                  opacity: [0, 1],
                  duration: 800,
                  delay: 280,
                  ease: 'outExpo'
                })
              }
            }

            sectionObserver.unobserve(container)
          }
        })
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    )

    sectionContainers.forEach((container) => sectionObserver.observe(container))

    // B. Card Grids & Interactive Components on Scroll
    const cardSelectors = [
      '.showcase-mockup',
      '.feature-grid .feature-card',
      '.feature-list li',
      '.tool-showcase .showcase-tool',
      '.tool-showcase .showcase-note',
      '.testimonials-grid .testimonial-card',
      '.plan-grid .plan-card',
      '.faq-list .faq-item',
      '.closing-cta .closing-actions'
    ]

    const allCards = document.querySelectorAll(cardSelectors.join(','))

    allCards.forEach((card) => {
      card.style.opacity = '0'
      card.style.transform = 'perspective(1000px) rotateX(-14deg) translateY(42px) scale(0.95)'
      card.style.willChange = 'transform, opacity'
    })

    const cardObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const target = entry.target
            const parent = target.parentElement
            const siblings = parent ? Array.from(parent.children) : [target]
            const idx = siblings.indexOf(target)

            animate(target, {
              rotateX: [-14, 0],
              translateY: [42, 0],
              translateZ: [-20, 0],
              scale: [0.95, 1],
              opacity: [0, 1],
              duration: 850,
              delay: Math.max(0, (idx % 6) * 80),
              ease: 'outExpo'
            })

            cardObserver.unobserve(target)
          }
        })
      },
      { threshold: 0.1, rootMargin: '0px 0px -30px 0px' }
    )

    allCards.forEach((card) => cardObserver.observe(card))

    // =========================================================================
    // 3. Interactive 3D Perspective Tilt on Mouse Move
    // =========================================================================
    const tiltCards = document.querySelectorAll(
      '.feature-card, .testimonial-card, .plan-card, .showcase-tool, .showcase-mockup'
    )

    tiltCards.forEach((card) => {
      if (!card.querySelector('.card-shine-overlay')) {
        const shine = document.createElement('div')
        shine.className = 'card-shine-overlay'
        card.appendChild(shine)
      }
    })

    const handleMouseMove = (e) => {
      const card = e.currentTarget
      const rect = card.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const tiltX = ((y - centerY) / centerY) * -6
      const tiltY = ((x - centerX) / centerX) * 6

      card.style.setProperty('--mouse-x', `${x}px`)
      card.style.setProperty('--mouse-y', `${y}px`)
      card.style.transform = `perspective(1000px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) translateY(-4px) translateZ(10px)`
    }

    const handleMouseLeave = (e) => {
      const card = e.currentTarget
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0) translateZ(0)'
    }

    tiltCards.forEach((card) => {
      card.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease'
      card.addEventListener('mousemove', handleMouseMove)
      card.addEventListener('mouseleave', handleMouseLeave)
    })

    return () => {
      sectionObserver.disconnect()
      cardObserver.disconnect()
      tiltCards.forEach((card) => {
        card.removeEventListener('mousemove', handleMouseMove)
        card.removeEventListener('mouseleave', handleMouseLeave)
      })
    }
  }, [])

  return null
}
