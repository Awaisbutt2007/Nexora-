import { useCallback, useEffect, useRef, useState } from 'react'
import { logVoiceTurn, requestVoiceToken } from './api/nexora.js'
import './VoiceCall.css'

/* Aira — live speech-to-speech over the OpenAI Realtime API (WebRTC).

   The browser mints a short-lived client secret from our backend, opens a peer
   connection straight to the provider, and streams mic audio both ways. Turn
   detection, interruption cancelling and conversation truncation happen
   server-side (docs: WebRTC sessions manage the output buffer themselves).
   The waveform is drawn from REAL analyser data — flat line means silence. */

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

const STATUS_TEXT = {
  'requesting-mic': ['Waking the microphone…', 'Allow mic access in the browser prompt to talk with Aira.'],
  connecting: ['Connecting…', 'Aira is picking up.'],
  live: ['', ''],
  ended: ['Call ended', 'Your conversation was saved to history.'],
  error: ['Connection problem', ''],
}

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function VoiceCall({ authToken, user, prefs = {}, onClose }) {
  const [phase, setPhase] = useState('requesting-mic')
  const [micState, setMicState] = useState('idle')
  const [errorText, setErrorText] = useState('')
  const [userLive, setUserLive] = useState('')
  const [airaLive, setAiraLive] = useState('')
  const [turns, setTurns] = useState([])
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [muted, setMuted] = useState(false)

  const pcRef = useRef(null)
  const dcRef = useRef(null)
  const micRef = useRef(null)
  const ctxRef = useRef(null)
  const inAnalyserRef = useRef(null)
  const outAnalyserRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const timerRef = useRef(0)
  const convRef = useRef(null)
  const liveRef = useRef({ user: '', aira: '', responding: false, history: [] })
  const sendRef = useRef(null)
  const phaseRef = useRef('requesting-mic')
  useEffect(() => { phaseRef.current = phase }, [phase])

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    clearInterval(timerRef.current)
    try { dcRef.current?.close() } catch { /* already closed */ }
    try { pcRef.current?.close() } catch { /* already closed */ }
    micRef.current?.getTracks().forEach((t) => t.stop())
    ctxRef.current?.close().catch(() => {})
    dcRef.current = null
    pcRef.current = null
    micRef.current = null
    ctxRef.current = null
    inAnalyserRef.current = null
    outAnalyserRef.current = null
  }, [])

  useEffect(() => () => teardown(), [teardown])

  /* Auto-start when the overlay opens. The flag + cancel pair makes StrictMode's
     dev double-mount safe: only the surviving mount actually connects. */
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return undefined
    startedRef.current = true
    let cancelled = false
    const id = setTimeout(() => { if (!cancelled) connectRef.current?.() }, 0)
    return () => { cancelled = true; clearTimeout(id); startedRef.current = false; teardown() }
  }, [teardown])

  /* ---- waveform: mirrors real audio, decays to flat when silent ---- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx2d = canvas.getContext('2d')
    const bars = new Float32Array(56)
    const scratch = new Uint8Array(128)
    let raf = 0
    const draw = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * devicePixelRatio) { canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio }
      ctx2d.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      ctx2d.clearRect(0, 0, w, h)
      const read = (analyser) => {
        if (!analyser) return
        analyser.getByteTimeDomainData(scratch)
        let peak = 0
        for (let i = 0; i < scratch.length; i += 2) peak = Math.max(peak, Math.abs(scratch[i] - 128) / 128)
        return peak
      }
      const outPeak = read(outAnalyserRef.current) || 0
      const inPeak = (micState !== 'muted' && read(inAnalyserRef.current)) || 0
      const speaking = micState === 'speaking'
      const bw = w / bars.length
      for (let i = 0; i < bars.length; i += 1) {
        /* travelling ripple scaled by the REAL peak — animation never lies */
        const wave = 0.35 + 0.65 * Math.abs(Math.sin((i / bars.length) * Math.PI * 3 + performance.now() / 320))
        const target = i % 2 === 0 ? inPeak * wave : outPeak * wave
        bars[i] += (target - bars[i]) * 0.24
        const bh = Math.max(2, bars[i] * h * 0.92)
        const grad = ctx2d.createLinearGradient(0, h / 2 - bh / 2, 0, h / 2 + bh / 2)
        grad.addColorStop(0, i % 2 ? `rgba(189,108,255,${speaking ? 0.95 : 0.28})` : `rgba(95,208,255,${speaking ? 0.28 : 0.85})`)
        grad.addColorStop(1, i % 2 ? 'rgba(95,208,255,0.5)' : 'rgba(189,108,255,0.5)')
        ctx2d.fillStyle = grad
        ctx2d.beginPath()
        ctx2d.roundRect(i * bw + bw * 0.18, h / 2 - bh / 2, bw * 0.64, bh, bw * 0.32)
        ctx2d.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [micState])

  const pushTurn = useCallback((userText, airaText, interrupted) => {
    if (!userText && !airaText) return
    setTurns((prev) => [...prev.slice(-5), { id: `vt_${prev.length}_${userText.length}`, user: userText, aira: `${airaText}${interrupted ? ' —' : ''}` }])
    if (userText && airaText) {
      logVoiceTurn(authToken, { conversationId: convRef.current, userText, assistantText: airaText })
        .then((r) => { if (r.conversationId) convRef.current = r.conversationId })
        .catch(() => { /* captions stay even if persistence hiccups */ })
    }
  }, [authToken])

  const handleEvent = useCallback((event) => {
    switch (event.type) {
      case 'session.created':
        /* Replay recent turns so context survives across calls (docs:
           conversation.item.create with input_text). */
        for (const item of (liveRef.current.history || [])) {
          sendRef.current?.({ type: 'conversation.item.create', item: { type: 'message', role: item.role === 'assistant' ? 'assistant' : 'user', content: [{ type: item.role === 'assistant' ? 'output_text' : 'input_text', text: item.text }] } })
        }
        setMicState('listening')
        break
      case 'input_audio_buffer.speech_started':
        /* WebRTC: the server auto-cancels + truncates; clear the buffer for
           instant silence and show the interruption truthfully. */
        if (liveRef.current.responding) {
          sendRef.current?.({ type: 'output_audio_buffer.clear' })
          pushTurn(liveRef.current.user, liveRef.current.aira, true)
          liveRef.current = { ...liveRef.current, user: '', aira: '', responding: true }
          setUserLive('')
          setAiraLive('')
          setMicState('interrupted')
          setTimeout(() => setMicState('listening'), 650)
        } else {
          setMicState('listening')
        }
        break
      case 'conversation.item.input_audio_transcription.delta':
        liveRef.current.user += event.delta || ''
        setUserLive(liveRef.current.user)
        break
      case 'conversation.item.input_audio_transcription.completed':
        liveRef.current.user = event.transcript || liveRef.current.user
        setUserLive(liveRef.current.user)
        break
      case 'response.created':
        liveRef.current.responding = true
        setMicState('thinking')
        break
      case 'response.output_audio_transcript.delta':
        liveRef.current.aira += event.delta || ''
        setAiraLive(liveRef.current.aira)
        setMicState('speaking')
        break
      case 'response.output_audio_transcript.done':
        liveRef.current.aira = event.transcript || liveRef.current.aira
        setAiraLive(liveRef.current.aira)
        break
      case 'response.done':
        liveRef.current.responding = false
        pushTurn(liveRef.current.user, liveRef.current.aira, false)
        liveRef.current = { ...liveRef.current, user: '', aira: '' }
        setUserLive('')
        setAiraLive('')
        setMicState('listening')
        break
      case 'error':
        setErrorText(event.error?.message || 'Realtime session error')
        break
      default:
        break
    }
  }, [pushTurn])

  const handleEventRef = useRef(handleEvent)
  handleEventRef.current = handleEvent

  const connectRef = useRef(null)

  async function connect() {
    setPhase('requesting-mic')
    setErrorText('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      micRef.current = stream
      const audioCtx = new AudioContext()
      ctxRef.current = audioCtx
      await audioCtx.resume()
      inAnalyserRef.current = audioCtx.createAnalyser()
      inAnalyserRef.current.fftSize = 256
      audioCtx.createMediaStreamSource(stream).connect(inAnalyserRef.current)

      setPhase('connecting')
      const session = await requestVoiceToken(authToken, {
        voice: prefs.voice,
        language: prefs.language,
        assistantName: prefs.assistantName,
        persona: prefs.persona || undefined,
        conversationId: convRef.current,
      })
      convRef.current = session.conversationId || convRef.current

      const pc = new RTCPeerConnection()
      pcRef.current = pc
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream))
      const remote = new Audio()
      remote.autoplay = true
      pc.addEventListener('track', (e) => {
        remote.srcObject = e.streams[0]
        outAnalyserRef.current = ctxRef.current.createAnalyser()
        outAnalyserRef.current.fftSize = 256
        ctxRef.current.createMediaStreamSource(e.streams[0]).connect(outAnalyserRef.current)
      })

      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc
      sendRef.current = (payload) => { if (dc.readyState === 'open') dc.send(JSON.stringify(payload)) }
      liveRef.current.history = session.history || []
      dc.addEventListener('message', (e) => {
        let event
        try { event = JSON.parse(e.data) } catch { return }
        handleEventRef.current(event)
      })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      if (pc.iceGatheringState !== 'complete') {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('ICE gathering timed out — check your network and retry.')), 10_000)
          const onState = () => {
            if (pc.iceGatheringState === 'complete') { clearTimeout(timeout); pc.removeEventListener('icegatheringstatechange', onState); resolve() }
          }
          pc.addEventListener('icegatheringstatechange', onState)
        })
      }

      /* Direct WebRTC handshake with the provider using the ephemeral secret —
         the permanent API key never reaches the browser. */
      const sdpRes = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.clientSecret}`, 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp,
      })
      if (!sdpRes.ok) {
        const body = await sdpRes.text().catch(() => '')
        throw new Error(body || `Provider refused the call (${sdpRes.status})`)
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() })

      setPhase('live')
      setSecondsLeft(session.maxSeconds || 1800)
      timerRef.current = setInterval(() => setSecondsLeft((left) => Math.max(0, left - 1)), 1000)

      pc.addEventListener('connectionstatechange', () => {
        if ((pc.connectionState === 'failed' || pc.connectionState === 'disconnected') && phaseRef.current === 'live') {
          setPhase('error')
          setErrorText('The audio connection dropped. Reconnect to continue the conversation.')
        }
      })
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setErrorText('Microphone permission was blocked. Allow it in the browser (padlock icon) and retry.')
      } else if (err.name === 'NotFoundError') {
        setErrorText('No microphone found. Plug one in or pick an input device, then retry.')
      } else if (err instanceof TypeError) {
        /* fetch() rejected at the network layer — the API is down / restarting or
           unreachable. A bare "Failed to fetch" tells the user nothing useful. */
        setErrorText('Could not reach the Nexora voice server. Make sure the API is running (npm run dev:api), then retry.')
      } else {
        setErrorText(err.message || 'Could not start the voice session.')
      }
      setPhase('error')
      teardown()
    }
  }
  connectRef.current = connect

  function endCall(reason) {
    clearInterval(timerRef.current)
    if (reason === 'time') setErrorText('Time limit reached — the conversation was saved.')
    if (liveRef.current.user || liveRef.current.aira) {
      pushTurn(liveRef.current.user, liveRef.current.aira, false)
      liveRef.current.user = ''
      liveRef.current.aira = ''
    }
    teardown()
    setPhase('ended')
    if (reason === 'user') setTimeout(onClose, 1200)
  }

  /* Hard stop when the server-side cap is reached */
  useEffect(() => {
    if (phase === 'live' && secondsLeft === 0) endCall('time')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, secondsLeft])

  function toggleMute() {
    const track = micRef.current?.getAudioTracks()[0]
    if (!track) return
    const next = !muted
    track.enabled = !next
    setMuted(next)
    setMicState(next ? 'muted' : 'listening')
  }

  const headline = phase === 'live'
    ? { listening: 'Listening…', thinking: 'Thinking…', speaking: 'Aira is speaking', interrupted: 'You interrupted — got it', muted: 'Muted — Aira can’t hear you' }[micState] || 'Ready'
    : STATUS_TEXT[phase]?.[0] || ''

  return (
    <div className="voice-call-overlay" role="dialog" aria-modal="true" aria-label="Voice call with Aira">
      <div className="voice-call-card">
        <button type="button" className="voice-call-close" aria-label="Close voice call" onClick={() => { endCall('user'); onClose() }}>×</button>
        <span className={`voice-orb ${phase === 'live' ? micState : phase}`} aria-hidden="true">✦</span>
        <h3 className="voice-headline">{headline}</h3>
        <p className="voice-sub">{phase === 'error' ? errorText : STATUS_TEXT[phase]?.[1] || ''}</p>

        <canvas ref={canvasRef} className="voice-wave" aria-hidden="true" />

        <div className="voice-caption" aria-live="polite">
          {turns.slice(-2).map((t) => (
            <div key={t.id} className="voice-turn">
              <p><b>You</b> {t.user}</p>
              {t.aira && <p><b>Aira</b> {t.aira}</p>}
            </div>
          ))}
          {userLive && <p><b>You</b> {userLive}</p>}
          {airaLive && <p><b>Aira</b> {airaLive}<span className="chat-cursor">▍</span></p>}
        </div>

        {phase === 'live' && <p className="voice-timer">{fmt(secondsLeft)} left · this call is live, not a demo</p>}

        <div className="voice-actions">
          {phase === 'error' && <button type="button" className="voice-btn primary" onClick={connect}>Retry</button>}
          {phase !== 'live' && phase !== 'requesting-mic' && phase !== 'connecting' && <button type="button" className="voice-btn primary" onClick={connect}>Start voice call</button>}
          {phase === 'live' && (
            <>
              <button type="button" className={`voice-btn ${muted ? 'primary' : ''}`} aria-pressed={muted} onClick={toggleMute}>{muted ? 'Unmute mic' : 'Mute mic'}</button>
              <button type="button" className="voice-btn end" onClick={() => { endCall('user'); onClose() }}>End call</button>
            </>
          )}
          {(phase === 'requesting-mic' || phase === 'connecting') && <button type="button" className="voice-btn end" onClick={() => { teardown(); onClose() }}>Cancel</button>}
          {phase === 'ended' && <button type="button" className="voice-btn" onClick={onClose}>Done</button>}
        </div>
        <p className="voice-privacy">Audio streams live and is never stored — only transcripts save to your history.</p>
        {user?.isDemo && phase === 'live' && <p className="voice-demo">Demo account: usage spends Starter credits.</p>}
      </div>
    </div>
  )
}
