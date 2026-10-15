import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function ThreeHero() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true })
    } catch {
      canvas.parentElement?.classList.add('scene-unavailable')
      return undefined
    }

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40)
    camera.position.set(0, 0, 8)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.setClearColor(0x050611, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2

    scene.add(new THREE.AmbientLight('#b8b7ff', 1.7))
    const addLight = (color, intensity, position) => {
      const light = new THREE.PointLight(color, intensity, 11)
      light.position.set(...position)
      scene.add(light)
    }
    addLight('#9662ff', 48, [-3, 2, 4])
    addLight('#48d9ff', 34, [3, 1, 3])
    addLight('#e84de5', 24, [0, -3, 2])
    const keyLight = new THREE.DirectionalLight('#fff1ff', 2.5)
    keyLight.position.set(1, 4, 5)
    scene.add(keyLight)

    const makeMaterial = (color, options = {}) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.48, roughness: 0.24, clearcoat: 0.8, ...options })
    const createMesh = (geometry, material, parent, position, scale) => {
      const mesh = new THREE.Mesh(geometry, material)
      if (position) mesh.position.set(...position)
      if (scale) mesh.scale.set(...scale)
      parent.add(mesh)
      return mesh
    }

    const bot = new THREE.Group()
    scene.add(bot)
    const body = createMesh(new THREE.SphereGeometry(1, 48, 36), makeMaterial('#34217d', { emissive: '#5229cf', emissiveIntensity: 0.75 }), bot, [0, -1.14, 0], [0.72, 0.57, 0.53])
    body.castShadow = true
    createMesh(new THREE.TorusGeometry(0.22, 0.045, 12, 48), makeMaterial('#72eaff', { emissive: '#39cfff', emissiveIntensity: 2.4 }), bot, [0, -1.22, 0.49])
    for (const side of [-1, 1]) createMesh(new THREE.SphereGeometry(0.32, 32, 24), makeMaterial('#5945bf', { emissive: '#4729a0', emissiveIntensity: 0.35 }), bot, [side * 0.49, -0.86, 0], [1, 0.94, 1])

    const head = new THREE.Group()
    head.position.set(0, 0.28, 0)
    bot.add(head)
    createMesh(new THREE.SphereGeometry(1, 64, 48), makeMaterial('#7160df', { emissive: '#381880', emissiveIntensity: 0.6, roughness: 0.2 }), head, null, [1.17, 1.02, 0.86])
    createMesh(new THREE.SphereGeometry(1, 64, 40), makeMaterial('#071020', { metalness: 0.35, roughness: 0.13, clearcoat: 1, emissive: '#18306d', emissiveIntensity: 0.45 }), head, [0, -0.035, 0.62], [1.01, 0.79, 0.31])
    createMesh(new THREE.CylinderGeometry(0.035, 0.045, 0.22, 16), makeMaterial('#9b71ff', { emissive: '#843fff', emissiveIntensity: 1.4 }), head, [0, 1, 0])
    createMesh(new THREE.SphereGeometry(0.09, 24, 20), makeMaterial('#90ecff', { emissive: '#40cfff', emissiveIntensity: 2.5 }), head, [0, 1.14, 0])

    const eyeMaterial = makeMaterial('#f3fdff', { emissive: '#73dfff', emissiveIntensity: 2.8, roughness: 0.16 })
    const eyes = [-1, 1].map((side) => createMesh(new THREE.SphereGeometry(1, 32, 24), eyeMaterial, head, [side * 0.43, 0.02, 0.884], [0.115, 0.17, 0.055]))
    createMesh(new THREE.TorusGeometry(0.15, 0.018, 8, 24, Math.PI), makeMaterial('#68dcff', { emissive: '#38bfff', emissiveIntensity: 1.8 }), head, [0, -0.34, 0.91]).rotation.z = Math.PI
    createMesh(new THREE.TorusGeometry(1.18, 0.065, 12, 64, Math.PI), makeMaterial('#b681ff', { emissive: '#7542e9', emissiveIntensity: 0.9 }), head, [0, 0.12, -0.02])

    for (const [side, color] of [[-1, '#ba65ff'], [1, '#68dfff']]) {
      const ear = new THREE.Group()
      ear.position.set(side * 1.18, 0.05, 0)
      ear.rotation.z = Math.PI / 2
      head.add(ear)
      createMesh(new THREE.CylinderGeometry(0.28, 0.28, 0.19, 40), makeMaterial(color, { emissive: color, emissiveIntensity: 0.8 }), ear)
      createMesh(new THREE.TorusGeometry(0.27, 0.055, 12, 40), makeMaterial(color, { emissive: color, emissiveIntensity: 1.1 }), ear, [0, 0, 0.12])
    }

    const orbit = new THREE.Group()
    orbit.rotation.set(0.88, 0.18, -0.25)
    scene.add(orbit)
    createMesh(new THREE.TorusGeometry(2.08, 0.026, 8, 128), new THREE.MeshStandardMaterial({ color: '#9a6cff', emissive: '#7846ff', emissiveIntensity: 1.6, metalness: 0.4 }), orbit).scale.set(1, 0.48, 1)
    createMesh(new THREE.SphereGeometry(0.075, 20, 16), new THREE.MeshBasicMaterial({ color: '#8deeff' }), orbit, [2.08, 0, 0])
    const orbitTwo = new THREE.Group()
    orbitTwo.rotation.set(1.3, -0.3, 0.48)
    scene.add(orbitTwo)
    createMesh(new THREE.TorusGeometry(2.32, 0.014, 6, 128), new THREE.MeshStandardMaterial({ color: '#43d8ff', emissive: '#3a9eff', emissiveIntensity: 1.6, transparent: true, opacity: 0.82 }), orbitTwo).scale.set(1, 0.48, 1)

    const crystalColors = ['#5be2ff', '#ca67ff', '#6385ff', '#ed6bdd']
    const crystalStarts = [[-2.02, 1.03, -0.15], [2.02, 0.38, 0.12], [-1.8, -0.93, 0.2], [1.87, -0.15, -0.2]]
    const crystals = crystalColors.map((color, index) => {
      const group = new THREE.Group()
      group.position.set(...crystalStarts[index])
      scene.add(group)
      const crystal = createMesh(new THREE.OctahedronGeometry(0.23, 0), makeMaterial(color, { emissive: color, emissiveIntensity: 0.85, roughness: 0.16 }), group)
      crystal.rotation.set(0.3, 0.2, 0.1)
      createMesh(new THREE.SphereGeometry(0.34, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false }), group)
      return group
    })

    const particlePositions = new Float32Array(480)
    for (let index = 0; index < particlePositions.length; index += 3) {
      particlePositions[index] = (Math.random() - 0.5) * 10
      particlePositions[index + 1] = (Math.random() - 0.5) * 6
      particlePositions[index + 2] = (Math.random() - 0.5) * 4 - 1
    }
    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
    const particleMaterial = new THREE.PointsMaterial({ color: '#bac7ff', size: 0.024, transparent: true, opacity: 0.72, sizeAttenuation: true, depthWrite: false })
    const particles = new THREE.Points(particleGeometry, particleMaterial)
    scene.add(particles)

    const pointer = new THREE.Vector2()
    const onPointerMove = (event) => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      pointer.x = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1.4, 1.4)
      pointer.y = THREE.MathUtils.clamp(-((event.clientY - rect.top) / rect.height) * 2 + 1, -1.4, 1.4)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      if (!width || !height) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.position.z = camera.aspect < 0.9 ? 9.2 : 8
      camera.updateProjectionMatrix()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas.parentElement)
    window.addEventListener('resize', resize)
    resize()

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animationFrame = 0
    let previousTime = performance.now()
    const animate = (now) => {
      animationFrame = window.requestAnimationFrame(animate)
      const delta = Math.min((now - previousTime) / 1000, 0.05)
      previousTime = now
      if (!reduceMotion.matches) {
        const time = now / 1000
        bot.position.y = Math.sin(time * 1.05) * 0.1
        bot.rotation.y = THREE.MathUtils.lerp(bot.rotation.y, pointer.x * 0.42, delta * 3.4)
        bot.rotation.x = THREE.MathUtils.lerp(bot.rotation.x, -pointer.y * 0.22, delta * 3.4)
        head.rotation.y = Math.sin(time * 0.7) * 0.05 + pointer.x * 0.22
        head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, -pointer.y * 0.14, delta * 3.4)
        const blink = time % 4.8 > 4.69 && time % 4.8 < 4.82 ? 0.12 : 1
        eyes.forEach((eye) => { eye.scale.y = 0.17 * blink })
        orbit.rotation.z += delta * 0.17
        orbitTwo.rotation.z -= delta * 0.11
        crystals.forEach((crystal, index) => {
          crystal.rotation.x += delta * (0.28 + index * 0.04)
          crystal.rotation.y += delta * (0.35 + index * 0.06)
          crystal.position.y = crystalStarts[index][1] + Math.sin(time * 1.2 + index * 1.7) * 0.12
        })
        particles.rotation.y += delta * 0.012
      }
      renderer.render(scene, camera)
    }
    animate(previousTime)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose()
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        }
      })
      renderer.dispose()
    }
  }, [])

  return <div className="artwork" role="img" aria-label="A friendly three-dimensional AI assistant floating in a glowing orbit">
    <div className="art-glow" />
    <canvas ref={canvasRef} className="hero-canvas" />
    <span className="scene-caption">NEXORA · AI COMPANION</span>
  </div>
}
