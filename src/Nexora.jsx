import { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import './Nexora.css'
import './typography.css'
import SignIn from './SignIn.jsx'
import CursorTrail from './CursorTrail.jsx'
import AnimeEffects from './AnimeEffects.jsx'
import {
  clearSession,
  deleteConversation,
  deleteMemory,
  getConversation,
  listConversations,
  listMemories,
  loadSession,
  me,
  saveMemory,
  saveSession,
  streamChat,
  upgradePlan,
} from './api/nexora.js'

const ThreeHero = lazy(() => import('./ThreeHero.jsx'))
const Onboarding = lazy(() => import('./Onboarding.jsx'))
const VoiceCall = lazy(() => import('./VoiceCall.jsx'))

/* Flag kept while a new (Google or sign-up) user still has to finish the "what should I call you" step */
const ONBOARDING_KEY = 'nexora_onboarding_pending'

/* Voice-call prefs live locally (provider voice + language); the persona name
   comes from the onboarding wizard so Aira answers to the name the user gave. */
const VOICE_PREFS_KEY = 'nexora_voice_prefs'
const ONBOARDING_PROGRESS_KEY = 'nexora_onboarding_progress'

/* OpenAI Realtime built-in voices (docs-verified list) */
const VOICE_OPTIONS = [
  ['marin', 'Marin', 'warm · natural female — recommended for Aira'],
  ['shimmer', 'Shimmer', 'soft · expressive female'],
  ['ballad', 'Ballad', 'light · melodic female'],
  ['coral', 'Coral', 'breathy · friendly'],
  ['sage', 'Sage', 'grounded · steady'],
  ['verse', 'Verse', 'crisp · composed'],
  ['alloy', 'Alloy', 'neutral · balanced'],
  ['echo', 'Echo', 'easy-going · warm'],
  ['ash', 'Ash', 'friendly · even'],
  ['cedar', 'Cedar', 'firm · male-leaning'],
]
const VOICE_LANGUAGES = [['auto', 'Auto — mix freely (English + Urdu + Roman Urdu)'], ['en', 'English first'], ['ur', 'Urdu first']]

function loadVoicePrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) || '{}')
    let aiName = 'Aira'
    let persona = ''
    try {
      const ob = JSON.parse(localStorage.getItem(ONBOARDING_PROGRESS_KEY) || '{}')
      if (ob.aiName) aiName = ob.aiName
      if (ob.characterName) {
        persona = ob.characterDesc ? `${ob.characterName} — ${ob.characterDesc}` : ob.characterName
      }
    } catch { /* no wizard data */ }
    return {
      voice: VOICE_OPTIONS.some(([id]) => id === saved.voice) ? saved.voice : 'marin',
      language: VOICE_LANGUAGES.some(([id]) => id === saved.language) ? saved.language : 'auto',
      assistantName: aiName,
      /* Persona the user picked at onboarding; sent to /token so Aira can weave
         it into her system instructions. Style only — honesty rules still apply. */
      persona,
    }
  } catch {
    return { voice: 'marin', language: 'auto', assistantName: 'Aira', persona: '' }
  }
}

/* Landing nav in the order the LINKS appear. This is deliberately not the order
   of the sections in the DOM (Showcase sits before Features, About before Plans),
   so the scroll-spy compares element offsets instead of trusting this list. */
const NAV_SECTIONS = [['#home', 'Home'], ['#features', 'Features'], ['#showcase', 'Showcase'], ['#plans', 'Pricing'], ['#faq', 'FAQ'], ['#about', 'About']]

/* a deep link only counts when it actually names one of the nav sections, so an
   unrelated #hash can't start the page with no underline at all */
function initialNavHash() {
  return NAV_SECTIONS.some(([hash]) => hash === window.location.hash) ? window.location.hash : '#home'
}

const navItems = [['Home', '⌂'], ['Chat', '◌'], ['History', '⧗'], ['Tools', '▦'], ['Memory', '◈'], ['Settings', '⚙']]
const tools = [
  ['▧', 'Image Generator', 'Create striking images from a simple prompt.', 'violet'],
  ['⌘', 'Code Assistant', 'Write, debug, and explain code with context.', 'blue'],
  ['▣', 'PDF Reader', 'Ask questions and find details in any PDF.', 'pink'],
  ['▶', 'YouTube Notes', 'Turn long videos into clear takeaways.', 'cyan'],
  ['◉', 'Meeting Notes', 'Capture decisions and next steps automatically.', 'violet'],
  ['✦', 'Social Studio', 'Shape one idea into content for every channel.', 'green'],
]

const featureList = [
  ['◌', 'Conversational AI', 'A chat that remembers context and truly gets you.'],
  ['✦', 'Creative Studio', 'Generate images, writing, code and polished content on demand.'],
  ['◈', 'Unified Memory', 'Your files, chats and ideas live together, always ready.'],
  ['▤', 'Smart Planning', 'Organize weeks, projects and todos without leaving the flow.'],
]

const testimonials = [
  { initials: 'TA', name: 'Tom Andersson', platform: 'Twitter', quote: 'Setup took less than an hour and we were booking demos the same day. Incredible product and blazing fast.' },
  { initials: 'SC', name: 'Sarah Chen', platform: 'ProductHunt', quote: 'We booked our first meeting from a neural synthesis workflow in under an hour of signing up.' },
  { initials: 'MW', name: 'Marcus Webb', platform: 'LinkedIn', quote: 'The multi-modal autonomous pipeline doubled our output in 30 days. It feels like an AI OS from the future.' },
  { initials: 'LK', name: 'Lena Kim', platform: 'Twitter', quote: 'Finally an AI workspace built for outbound & design teams. The unified canvas alone saves us 2 hours a day.' },
  { initials: 'AR', name: 'Ahmed R.', platform: 'Community', quote: 'Nexora ne meri productivity ko agay le gaya. Memory feature se har cheez ek jaga hai, aur chat context bilkul seamless hai.' },
  { initials: 'SM', name: 'Saad M.', platform: 'Community', quote: 'Bohat hi clean interface. Code assistant aur visual tools sath milne se workflow bohat simplify ho gaya.' },
]

const faqs = [
  { q: 'Hum Nexora kyu purchase karein?', a: 'Nexora ek personal AI assistant hai jismein chat, image creation, code help, file reading, planning aur memory — sab ek hi jagah milta hai. Aap ek workspace se apne poore ideas ko manage kar sakte hain. Yeh ek ordinary AI assistant se behtar hai — aap isse apni baatein share kar sakte hain, yeh aapke liye khud kaam karega, aap isko kisi bhi insaan ki voice de sakte hain, aur yeh aapke kai projects mein bhi bohat madadgar hoga.' },
  { q: 'Kya Nexora free use kar sakte hain?', a: 'Nexora ka Starter plan sirf ₨6,000/month hai — jismein helpful AI conversations, everyday creative tools, aur 5,000 monthly credits shamil hain. Unlimited aur premium features ke liye Pro ya Yearly Pro plan le sakte hain.' },
  { q: 'Pro aur Yearly Pro main kya extra milta hai?', a: 'Pro (₨10,000/month) aur Yearly Pro (₨80,000/year) dono main aapko premium AI models, faster image aur file tools, aur bilkul unlimited credits ka access milta hai. Yearly Pro mein 12 mahine sirf 8 ke daam mein milte hain — sabse zyada value wala plan hai.' },
  { q: 'Kya meri files aur data secure hain?', a: 'Haan, aapke data aur chats aapki hi personal space main rehte hain. Nexora aapke ideas aur files ko private rakhta hai — aapka data kisi aur ke saath share nahi hota.' },
  { q: 'Mobile ya sirf desktop par chalega?', a: 'Nexora ka interface responsive design ka hai — aap desktop, tablet aur mobile dono par aaram se use kar sakte hain. Workspace aur landing page dono har screen size par optimized hain.' },
]

function Brand({ compact = false }) {
  return <a className={`brand${compact ? ' brand-compact' : ''}`} href="#home" aria-label="Nexora home"><svg className="brand-mark" viewBox="0 0 36 36" aria-hidden="true"><path d="M7 27V9l22 18V9" fill="none" stroke="url(#brand-gradient)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" /><defs><linearGradient id="brand-gradient" x1="7" x2="29" y1="9" y2="27" gradientUnits="userSpaceOnUse"><stop stopColor="#72e2ff" /><stop offset=".52" stopColor="#a866ff" /><stop offset="1" stopColor="#ff68d7" /></linearGradient></defs></svg><span>Nexora</span></a>
}

function AssistantArtwork() {
  return <Suspense fallback={<div className="artwork scene-loading" role="img" aria-label="Loading Nexora’s 3D AI companion" />}><ThreeHero /></Suspense>
}

const CURRENT_YEAR = new Date().getFullYear()

function Landing({ onLogin, onNavigate, isLoggedIn, userProfile, onUpgrade }) {
  const [openFaq, setOpenFaq] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const navRef = useRef(null)
  const spyLockRef = useRef(0)
  const [activeHash, setActiveHash] = useState(initialNavHash)
  const [layoutTick, setLayoutTick] = useState(0)
  const [underline, setUnderline] = useState({ left: 0, top: 0, width: 0, visible: false })

  /* clicking a link moves the bar at once — the href still does the smooth scroll */
  function followLink(hash) {
    setMenuOpen(false)
    setActiveHash(hash)
  }

  /* the hash changes before the page starts gliding, and that is the one moment
     the spy must stand down — otherwise it drags the bar backwards through every
     section the viewport passes on the way to the one that was clicked */
  useEffect(() => {
    const onHashChange = () => {
      spyLockRef.current = Date.now() + 900
      setActiveHash(initialNavHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  /* scroll-spy: the section whose top has last passed the probe line (just under
     the fixed header) owns the nav — deepest offset wins, so DOM order is fine */
  useEffect(() => {
    /* on a deep link the browser jumps to the section after layout, so the spy is
       locked out briefly — otherwise it stamps the bar back onto Home */
    if (window.location.hash) spyLockRef.current = Date.now() + 1200
    const onScroll = () => {
      if (Date.now() < spyLockRef.current) return
      const probe = window.scrollY + 160
      let current = null
      let bestTop = -1
      for (const [hash] of NAV_SECTIONS) {
        const el = document.getElementById(hash.slice(1))
        if (!el) continue
        if (el.offsetTop <= probe && el.offsetTop > bestTop) { bestTop = el.offsetTop; current = hash }
      }
      setActiveHash(current || '#home')
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /* re-take the bar's snapshot whenever the header geometry can move: a window
     resize, or a ResizeObserver. The nav box is not enough: the link group is
     centred inside a flex:1 column whose height comes from the header, so a late
     web-font swap re-measures every label WITHOUT resizing the nav — watching the
     labels too is what stops the parked bar sitting ~9px off on first paint */
  useEffect(() => {
    const nav = navRef.current
    const retake = () => setLayoutTick((tick) => tick + 1)
    window.addEventListener('resize', retake)
    const observer = typeof ResizeObserver === 'undefined' || !nav ? null : new ResizeObserver(retake)
    observer?.observe(nav)
    if (observer) nav.querySelectorAll('a').forEach((link) => observer.observe(link))
    document.fonts?.ready?.then(retake).catch(() => {})
    return () => {
      window.removeEventListener('resize', retake)
      observer?.disconnect()
    }
  }, [])

  /* park the shared bar under the active link. Fractional rects are read relative
     to the nav (not offsetLeft/offsetTop, which round, and not viewport coords,
     which the header's own padding transition would move), so the bar lines up to
     the pixel and stays put while the header collapses on scroll. */
  useLayoutEffect(() => {
    const nav = navRef.current
    const link = nav?.querySelector(`a[href="${activeHash}"]`)
    if (!link || !link.offsetWidth) { setUnderline((prev) => ({ ...prev, visible: false })); return }
    const navRect = nav.getBoundingClientRect()
    const linkRect = link.getBoundingClientRect()
    /* the per-link ::after this replaces sat on the link's own bottom edge, and the
       link lifts with translateY(-1px) on a .2s transition: reading the visual rect
       here would catch the newly-active link mid-lift, one pixel too low, for the
       rest of the page's life. The LAYOUT box ignores transforms, so it is stable —
       minus the 1px the link is about to rise by. */
    setUnderline({
      left: linkRect.left - navRect.left + 4,
      top: link.offsetTop + link.offsetHeight - 1,
      width: Math.max(0, linkRect.width - 8),
      visible: true,
    })
  }, [activeHash, layoutTick])

  return <main className="landing" id="home">
    <AnimeEffects />
    <div className="ambient-dots" aria-hidden="true">
      <i /><i /><i /><i /><i /><i /><i /><i />
    </div>

    <header className={`floating-header ${scrolled ? 'scrolled' : ''}`}>
      <div className="floating-header-inner wrap">
        <Brand />
        <nav className="main-nav" aria-label="Main navigation" ref={navRef}>
          {NAV_SECTIONS.map(([hash, label]) => <a key={hash} href={hash} className={activeHash === hash ? 'active' : ''} aria-current={activeHash === hash ? 'page' : undefined} onClick={() => followLink(hash)}>{label}</a>)}
          {/* ONE bar that slides between links — a per-link ::after can only blink
              on/off, which is why the line looked stuck under Home */}
          <span className="nav-underline" aria-hidden="true" style={{ left: underline.left, top: underline.top, width: underline.width, opacity: underline.visible ? 1 : 0 }} />
        </nav>
        <div className="header-actions">
          {isLoggedIn && !userProfile?.isDemo ? (
            <button className="header-account" type="button" onClick={() => onNavigate('Home')} title={userProfile?.email ? `Connected: ${userProfile.email}` : 'Open workspace'}>
              <span className="profile-avatar">{userProfile?.avatar ? <img src={userProfile.avatar} alt="" className="avatar-img" referrerPolicy="no-referrer" /> : (userProfile?.name || 'U').charAt(0).toUpperCase()}</span>
              <span>{userProfile?.name ? `${userProfile.name.split(' ')[0]}'s Space` : 'Open workspace'}</span>
            </button>
          ) : (
            <button className="login-link" type="button" onClick={onLogin}>Sign in</button>
          )}
          <button className="button button-primary header-cta" type="button" onClick={() => onNavigate('Home', null, 'Nexora Workspace')}>Get Started <span>↗</span></button>
          <button className={`hamburger ${menuOpen ? 'open' : ''}`} type="button" aria-label="Menu" onClick={() => setMenuOpen(v => !v)}><span /><span /><span /></button>
        </div>
      </div>
      {menuOpen && <div className="mobile-menu-panel wrap"><a href="#features" onClick={() => setMenuOpen(false)}>Features</a><a href="#showcase" onClick={() => setMenuOpen(false)}>Showcase</a><a href="#plans" onClick={() => setMenuOpen(false)}>Pricing</a><a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a><a href="#about" onClick={() => setMenuOpen(false)}>About</a></div>}
    </header>

    <section className="hero wrap">
      <div className="hero-copy">
        <div className="assistant-pill"><span>✦</span> Your personal AI assistant</div>
        <h1>Nexora<br />More than just<br />an <span>AI assistant.</span></h1>
        <p className="hero-description">Chat, create, plan, and get things done, all in one place. Nexora remembers, thinks, and works with you.</p>
        <div className="hero-actions">
          <button className="button button-primary button-large" type="button" onClick={() => onNavigate('Home', null, 'Nexora Workspace')}>Get started free <span>→</span></button>
          <a className="button button-ghost button-large" href="#features"><span className="play-icon">▶</span> See what Nexora can do</a>
        </div>
        <p className="hero-note">Works on every browser · Free to start. A paid plan unlocks more magic.</p>
        <div className="social-proof">
          <div className="avatar-stack"><span>J</span><span>M</span><span>A</span><span>S</span><span>K</span></div>
          <p><strong>Join 120K+ curious minds</strong><br /><span>Making space for better ideas</span></p>
        </div>
      </div>
      <div className="hero-art-shell">
        <AssistantArtwork />
      </div>
      <div className="hero-bottom-glow" />
    </section>

    <section className="trust-row wrap" aria-label="Nexora highlights">
      <span>One space for everything</span><i /><span>Built for your flow</span><i /><span>Your ideas stay yours</span><i /><span>All systems operational</span>
    </section>

    <section className="section showcase-section" id="showcase">
      <div className="wrap">
        <div className="section-heading centered-heading">
          <p className="eyebrow">NEXORA COMMAND CENTER</p>
          <h2>Your whole workspace,<br /><span>looks this good.</span></h2>
          <p>Keep scrolling — the Nexora workspace re-skins your entire day. Three full zones, real interface. Pick yours inside the app.</p>
        </div>
        <div className="showcase-mockup">
          <div className="mockup-window">
            <div className="mockup-titlebar"><span /><span /><span /><em>Nexora — Workspace</em></div>
            <div className="mockup-body">
              <aside className="mockup-sidebar">
                <div className="mockup-avatar N">N</div>
                <div className="mockup-side-link active"><b>⌂</b><span>Home</span></div>
                <div className="mockup-side-link"><b>◌</b><span>Chat</span></div>
                <div className="mockup-side-link"><b>▦</b><span>Tools</span></div>
                <div className="mockup-side-link"><b>◈</b><span>Memory</span></div>
                <div className="mockup-side-link"><b>⚙</b><span>Settings</span></div>
              </aside>
              <section className="mockup-content">
                <div className="mockup-topbar">
                  <div className="mockup-search"><span>⌕</span><em>Search anything…</em><kbd>⌘ K</kbd></div>
                  <div className="mockup-chip">🔔</div>
                  <div className="mockup-profile"><b>A</b><em>Awai Butt</em></div>
                </div>
                <div className="mockup-heading"><p className="eyebrow">YOUR NEXORA SPACE</p><h3>Good morning, Awai! ☀️</h3><small>Here’s what’s happening with your AI assistant today.</small></div>
                <div className="mockup-quick"><div><b>◌</b><i>Chat</i><small>Talk with Nexora</small></div><div><b>▧</b><i>Create</i><small>Make something new</small></div><div><b>▤</b><i>Plan</i><small>Organize your week</small></div><div><b>⌕</b><i>Search</i><small>Browse the web</small></div></div>
                <div className="mockup-prompt"><span>✦</span><em>Ask Nexora anything…</em><button>→</button></div>
                <div className="mockup-panel">
                  <div className="mockup-orbit">
                    <div className="mockup-core" />
                    <div className="mockup-ring r1" /><div className="mockup-ring r2" /><div className="mockup-ring r3" />
                  </div>
                  <div className="mockup-panel-side">
                    <h4>Quick actions</h4>
                    <div className="mockup-action-row"><b>▧</b><span>Create an image</span><i>›</i></div>
                    <div className="mockup-action-row"><b>✎</b><span>Write anything</span><i>›</i></div>
                    <div className="mockup-action-row"><b>▤</b><span>Summarize a file</span><i>›</i></div>
                    <div className="mockup-action-row"><b>⌘</b><span>Ask about code</span><i>›</i></div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section className="section features-section" id="features">
      <div className="wrap">
        <div className="section-heading">
          <p className="eyebrow">MORE FLOW, LESS FRICTION</p>
          <h2>One assistant.<br /><span>A hundred possibilities.</span></h2>
          <p>From the first rough thought to the finished thing, Nexora helps you move with momentum.</p>
        </div>
        <div className="feature-grid">
          {[
            { k: 'chat', icon: '✦', tint: '', kicker: 'THINK TOGETHER', title: 'A chat that gets you', desc: 'Ask the big question, untangle a tricky thought, or just get started. Your assistant keeps the context.', cta: true },
            { k: 'create', icon: '▧', tint: 'cyan', kicker: 'MAKE IT REAL', title: 'Create without limits', desc: 'Turn a blank page into images, writing, code, plans, and polished work you can share.', orb: true },
            { k: 'unified', icon: '◈', tint: 'pink', kicker: 'STAY IN YOUR FLOW', title: 'Everything in one place', desc: 'Your favorite tools, files, and conversations live together, ready whenever you are.', pills: true },
          ].map((f) => <article key={f.k} className={`feature-card feature-card-${f.k}`}>
            <div className={`feature-icon ${f.tint ? `icon-${f.tint}` : ''}`}>{f.icon}</div>
            <span className="card-kicker">{f.kicker}</span>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
            {f.cta && <a href="#workspace" onClick={(e) => { e.preventDefault(); onNavigate('Chat', null, 'Conversational AI') }}>Start a conversation <span>↗</span></a>}
            {f.k === 'chat' && <div className="mini-chat"><span className="mini-avatar">N</span><p>What are you thinking about today?<b>✦</b></p></div>}
            {f.orb && <div className="create-orb"><span>✦</span><i /><i /><i /></div>}
            {f.pills && <div className="tool-pills"><span>Chat</span><span>Write</span><span>Plan</span><span>+ more</span></div>}
          </article>)}
        </div>

        <ul className="feature-list">
          {featureList.map(([icon, title, desc], i) => {
            const targetView = title === 'Conversational AI' ? 'Chat' : title === 'Creative Studio' ? 'Tools' : title === 'Unified Memory' ? 'Memory' : 'Tools'
            const targetTool = title === 'Creative Studio' ? 'Image Generator' : null
            return (
              <li
                key={title}
                role="button"
                tabIndex={0}
                style={{ cursor: 'pointer' }}
                onClick={() => onNavigate(targetView, targetTool, title)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onNavigate(targetView, targetTool, title)}
              >
                <span className={`fl-icon fl-${i}`}>{icon}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
                <em>↗</em>
              </li>
            )
          })}
        </ul>
      </div>
    </section>

    <section className="section tools-section" id="about">
      <div className="wrap tools-layout">
        <div className="section-heading tools-heading">
          <p className="eyebrow">A LITTLE MAGIC, A LOT OF USEFUL</p>
          <h2>Your next idea<br />starts <span>right here.</span></h2>
          <p>Pick a tool and jump in. No setup spiral, no tab maze, just a clear path from “what if” to “done.”</p>
          <button className="button button-primary button-large" type="button" onClick={() => onNavigate('Tools', null, 'All Tools')}>Explore all tools <span>→</span></button>
        </div>
        <div className="tool-showcase">
          {tools.slice(0, 4).map(([icon, title, description, tint]) => <button className={`showcase-tool tint-${tint}`} key={title} type="button" onClick={() => onNavigate('Tools', title, title)}><span className="showcase-icon">{icon}</span><span><strong>{title}</strong><small>{description}</small></span><b>↗</b></button>)}
          <div className="showcase-note"><span>✦</span> Your next favorite tool is one click away</div>
        </div>
      </div>
    </section>

    <section className="section testimonials-section">
      <div className="wrap">
        <div className="section-heading centered-heading">
          <p className="eyebrow">LOVED BY CURIOUS MINDS</p>
          <h2>Real people.<br /><span>Real words, real wins.</span></h2>
          <p>Bohat se logon ne apna workflow Nexora ke saath shift kar diya — here’s what they have to say.</p>
        </div>
        <div className="testimonials-grid">
          {testimonials.map((t, i) => <article key={`${t.name}-${i}`} className={`testimonial-card ${i === 1 || i === 4 ? 'alt' : ''}`}>
            <header>
              <div className={`t-avatar t-${(i % 6)}`}>{t.initials}</div>
              <div>
                <h4>{t.name}</h4>
                <small>Verified User · {t.platform || 'Community'}</small>
              </div>
              <span className="t-source">{t.platform || 'Verified'}</span>
            </header>
            <p>“ {t.quote} ”</p>
          </article>)}
        </div>
      </div>
    </section>

    <section className="section plans-section" id="plans">
      <div className="wrap plans-wrap">
        <div className="section-heading">
          <p className="eyebrow">ROOM TO GROW</p>
          <h2>Start curious.<br /><span>Stay for the possibilities.</span></h2>
          <p>Make yourself at home. There’s a Nexora plan for every kind of day.</p>
          <p className="plans-note"><span>✦</span> Bring your own vibe, or unlock Nexora Pro for a lot more magic.</p>
        </div>
        <div className="plan-grid">
          {[
            { feat: false, label: 'MONTHLY BASIC', name: 'Starter', price: '₨6,000', sub: '/ month', desc: 'Har roz ke sawal aur chhote ideas ke liye.', items: ['Helpful AI conversations', 'Everyday creative tools', '5,000 credits per month', 'Your own idea library'], cta: 'Get Starter', tint: 'outline' },
            { feat: true, label: 'MOST LOVED · MONTHLY', name: 'Pro', price: '₨10,000', sub: '/ month', desc: 'Ambitious projects aur unlimited work ke liye.', items: ['Premium AI models', 'Faster image and file tools', 'No credit limit — unlimited', 'Bigger projects, longer memory'], cta: 'Get Pro', tint: 'primary' },
            { feat: false, label: 'YEARLY · BEST VALUE', name: 'Yearly Pro', price: '₨80,000', sub: '/ year', desc: 'Poore saal ka magic, saste mein.', items: ['Premium AI models', 'Faster image and file tools', 'No credit limit — unlimited', 'Bigger projects, longer memory', '12 months for the price of 8'], cta: 'Get Yearly Pro', tint: 'outline' },
          ].map((p) => <article key={p.name} className={`plan-card ${p.feat ? 'plan-featured' : ''}`}>
            {p.feat && <span className="popular-label">MOST LOVED</span>}
            <span className="plan-label">{p.label}</span>
            <h3>{p.name}</h3>
            <p className="plan-price">{p.price} <small>{p.sub}</small></p>
            <p className="plan-description">{p.desc}</p>
            <ul>{p.items.map(it => <li key={it}><span>✦</span> {it}</li>)}</ul>
            <button className={`button button-${p.tint} button-wide`} type="button" onClick={p.feat && onUpgrade ? onUpgrade : () => onNavigate('Home', null, `${p.name} Plan`)}>{p.cta} <span>→</span></button>
          </article>)}
        </div>
      </div>
    </section>

    <section className="section faq-section" id="faq">
      <div className="wrap faq-wrap">
        <div className="section-heading">
          <p className="eyebrow">FREQUENTLY ASKED</p>
          <h2>Quick answers,<br /><span>to common questions.</span></h2>
          <p>Agar aapka sawal yahan nahi mila — hamesha ke liye pooch sakte hain, Nexora khud guide karega.</p>
        </div>
        <ul className="faq-list">
          {faqs.map((f, i) => (
            <li key={f.q} className={`faq-item ${openFaq === i ? 'open' : ''}`}>
              <button type="button" className="faq-q" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenFaq((prev) => (prev === i ? -1 : i)); }}>
                <span>Q{i + 1}.</span>
                <strong>{f.q}</strong>
                <em>{openFaq === i ? '−' : '+'}</em>
              </button>
              <div className="faq-a"><p>{f.a}</p></div>
            </li>
          ))}
        </ul>
      </div>
    </section>

    <section className="closing-cta wrap">
      <div className="cta-spark">✦</div>
      <p className="eyebrow">YOUR NEXT CHAPTER STARTS SMALL</p>
      <h2>Good ideas are better<br />when they <span>have room.</span></h2>
      <p>Bring your curiosity. We’ll bring the tools.</p>
      <div className="closing-actions">
        <button className="button button-primary button-large" type="button" onClick={() => onNavigate('Home', null, 'Nexora Workspace')}>Meet your new assistant <span>→</span></button>
        <a className="button button-outline button-large" href="#faq">Still have questions?</a>
      </div>
    </section>

    <footer className="site-footer-giant">
      <div className="wrap footer-cta-banner">
        <div>
          <h2>Your workspace is waiting.</h2>
          <p>Start free, then pick a plan whenever you like. Cancel whenever you like.</p>
        </div>
        <div className="footer-cta-actions">
          <button className="button button-primary button-large" type="button" onClick={() => onNavigate('Home', null, 'Nexora Workspace')}>Launch Nexora <span>↗</span></button>
          <a className="button button-outline button-large" href="#plans">View Pricing</a>
        </div>
      </div>
      <div className="wrap footer-grid">
        <div className="footer-brand-col">
          <Brand />
          <p className="footer-tag">More room for what's next.</p>
          <p className="footer-about">The unified AI workspace for curious minds. Turn an ordinary session into a flow that listens, moves, and feels alive — the kind you’ve only daydreamed about.</p>
          <div className="footer-socials">
            <a href="#" aria-label="WhatsApp" title="WhatsApp">✆</a>
            <a href="#" aria-label="Email" title="Email">✉</a>
            <a href="#" aria-label="GitHub" title="GitHub">⌨</a>
            <a href="#" aria-label="YouTube" title="YouTube">▶</a>
            <a href="#" aria-label="X" title="X">✕</a>
          </div>
        </div>
        {[
          { title: 'Product', links: [['Overview', '#home'], ['Features', '#features'], ['Showcase', '#showcase'], ['Pricing', '#plans'], ['Releases', '#home'], ['Reviews', '#home']] },
          { title: 'Features', links: [['Chat', '#home'], ['Image Generator', '#home'], ['Code Assistant', '#home'], ['PDF Reader', '#home'], ['YouTube Notes', '#home'], ['Meeting Notes', '#home']] },
          { title: 'Resources', links: [['Use Cases', '#home'], ['Compare', '#home'], ['Guide', '#home'], ['FAQ', '#faq'], ['Urdu / Hindi', '#home'], ['Blog', '#home']] },
          { title: 'Company', links: [['About', '#about'], ['Tools', '#home'], ['Workspace', '#home'], ['Plans', '#plans'], ['Contact', '#home'], ['Support', '#home']] },
          { title: 'Legal', links: [['Terms', '#home'], ['Privacy', '#home'], ['Refund', '#home'], ['Delivery', '#home'], ['Licence', '#home']] },
        ].map(col => <div key={col.title} className="footer-col">
          <h4>{col.title}</h4>
          <ul>{col.links.map(([label, href]) => <li key={label}><a href={href}>{label}</a></li>)}</ul>
        </div>)}
      </div>
      <div className="wrap footer-bottom">
        <span>© {CURRENT_YEAR} Nexora. Made for curious minds.</span>
        <span className="footer-status"><i /> All systems operational</span>
      </div>
    </footer>

  </main>
}

/* Right-side floating chat drawer — pinned state + width survive a reload */
const CHAT_DRAWER_KEY = 'nexora_chat_drawer'
const CHAT_DRAWER_MIN = 300
const CHAT_DRAWER_MAX = 720
const CHAT_DRAWER_DEFAULT = 380
function loadChatDrawer() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_DRAWER_KEY) || '{}')
    const width = Number(raw.width)
    return {
      /* default to pinned so the drawer stays open on load (by default open) */
      pinned: raw.pinned !== false,
      width: Number.isFinite(width) ? Math.min(CHAT_DRAWER_MAX, Math.max(CHAT_DRAWER_MIN, width)) : CHAT_DRAWER_DEFAULT,
    }
  } catch {
    return { pinned: true, width: CHAT_DRAWER_DEFAULT }
  }
}

function Workspace({ activeView, setActiveView, selectedTool, setSelectedTool, isLoggedIn, userProfile, authToken, onLogin, onLogout, onUpgrade, onProfileUpdate }) {
  const [prompt, setPrompt] = useState('')
  const [conversationId, setConversationId] = useState(null)
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [notice, setNotice] = useState(() => selectedTool ? `✦ ${selectedTool} is selected and ready to use!` : '')
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false)
  const chatEndRef = useRef(null)

  /* Right-side chat drawer: open by default, pin to keep it, drag the edge to resize */
  const [chatOpen, setChatOpen] = useState(true)
  const [chatPinned, setChatPinned] = useState(() => loadChatDrawer().pinned)
  const [chatWidth, setChatWidth] = useState(() => loadChatDrawer().width)
  const [chatResizing, setChatResizing] = useState(false)
  const [drawerPrompt, setDrawerPrompt] = useState('')
  const [drawerMessages, setDrawerMessages] = useState([])
  const [drawerStreaming, setDrawerStreaming] = useState(false)
  const [drawerConversationId, setDrawerConversationId] = useState(null)
  const drawerEndRef = useRef(null)

  /* Live voice calls + local voice preferences */
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voicePrefs, setVoicePrefs] = useState(() => loadVoicePrefs())

  /* Memory manager (review / edit / delete what Aira remembers) */
  const [memories, setMemories] = useState([])
  const [memLoading, setMemLoading] = useState(false)
  const [memBusy, setMemBusy] = useState(false)
  const [memDraft, setMemDraft] = useState({ key: '', value: '', editingId: null })

  /* Saved conversations (text + voice share one history — same `conversations` table) */
  const [conversations, setConversations] = useState([])
  const [convLoading, setConvLoading] = useState(false)

  const userName = userProfile?.name || 'Guest'
  const userEmail = userProfile?.email || 'Sign in to sync'
  const userInitial = userName.charAt(0).toUpperCase()
  const userAvatar = userProfile?.avatar || null
  const isPremium = userProfile?.isPremium === true

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  useEffect(() => {
    drawerEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [drawerMessages, drawerStreaming])

  /* Drag the drawer's left edge to make it wider or narrower (kam/zyada) */
  useEffect(() => {
    if (!chatResizing) return
    const onMove = (event) => {
      const next = Math.min(CHAT_DRAWER_MAX, Math.max(CHAT_DRAWER_MIN, window.innerWidth - event.clientX))
      setChatWidth(next)
    }
    const stop = () => setChatResizing(false)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stop)
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stop)
    }
  }, [chatResizing])

  /* An unpinned drawer hides when you click outside it; a pinned one stays put */
  useEffect(() => {
    if (!chatOpen || chatPinned) return
    const onDown = (event) => {
      if (event.target.closest('.chat-drawer') || event.target.closest('.chat-drawer-tab')) return
      setChatOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [chatOpen, chatPinned])

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_DRAWER_KEY, JSON.stringify({ pinned: chatPinned, width: chatWidth }))
    } catch {
      /* storage unavailable — pin/width simply won't persist */
    }
  }, [chatPinned, chatWidth])

  function startNewChat() {
    setConversationId(null)
    setMessages([])
    setActiveView('Chat')
    setNotice('New chat ready.')
  }

  function persistVoicePrefs(next) {
    setVoicePrefs(next)
    try { localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ voice: next.voice, language: next.language })) } catch { /* private mode */ }
  }

  const refreshMemories = useCallback(() => {
    if (!isLoggedIn || !authToken) return
    setMemLoading(true)
    listMemories(authToken)
      .then((r) => setMemories(r.data || []))
      .catch(() => setNotice('Could not load memories — is the backend running on :8787?'))
      .finally(() => setMemLoading(false))
  }, [isLoggedIn, authToken])

  useEffect(() => {
    if (activeView !== 'Memory' || !isLoggedIn || !authToken) return undefined
    /* defer one tick: the fetch (and its loading state) starts outside the effect body */
    const id = setTimeout(refreshMemories, 0)
    return () => clearTimeout(id)
  }, [activeView, isLoggedIn, authToken, refreshMemories])

  const refreshConversations = useCallback(() => {
    if (!isLoggedIn || !authToken) return
    setConvLoading(true)
    listConversations(authToken)
      .then((r) => setConversations(r.data || []))
      .catch(() => setNotice('Could not load history — is the backend running on :8787?'))
      .finally(() => setConvLoading(false))
  }, [isLoggedIn, authToken])

  useEffect(() => {
    if (activeView !== 'History' || !isLoggedIn || !authToken) return undefined
    const id = setTimeout(refreshConversations, 0)
    return () => clearTimeout(id)
  }, [activeView, isLoggedIn, authToken, refreshConversations])

  /* Open a saved thread in the main chat panel — voice and text share the same shape */
  function openConversation(id) {
    getConversation(authToken, id)
      .then((convo) => {
        setConversationId(convo.id)
        setMessages((convo.messages || []).map((m) => ({ id: m.id, role: m.role, content: m.content })))
        setActiveView('Chat')
        setNotice(`Opened “${convo.title}”.`)
      })
      .catch((err) => setNotice(err.message || 'Could not open that conversation.'))
  }

  function removeConversation(id) {
    deleteConversation(authToken, id)
      .then(() => {
        setConversations((prev) => prev.filter((c) => c.id !== id))
        /* if the deleted thread is the one currently loaded, clear the workspace */
        setConversationId((current) => (current === id ? null : current))
        setMessages((current) => (id === conversationId ? [] : current))
        setNotice('Conversation deleted.')
      })
      .catch((err) => setNotice(err.message || 'Could not delete conversation.'))
  }

  function submitMemory(event) {
    event.preventDefault()
    if (memBusy || !memDraft.key.trim() || !memDraft.value.trim()) return
    setMemBusy(true)
    saveMemory(authToken, { key: memDraft.key.trim(), value: memDraft.value.trim(), source: 'user' })
      .then((saved) => {
        setMemories((prev) => {
          const rest = prev.filter((m) => m.id !== saved.id)
          return [{ ...saved, source: 'user' }, ...rest]
        })
        setMemDraft({ key: '', value: '', editingId: null })
        setNotice(memDraft.editingId ? 'Memory updated.' : 'Aira will remember this.')
      })
      .catch((err) => setNotice(err.message || 'Could not save memory.'))
      .finally(() => setMemBusy(false))
  }

  function removeMemoryEntry(id) {
    deleteMemory(authToken, id)
      .then(() => setMemories((prev) => prev.filter((m) => m.id !== id)))
      .catch((err) => setNotice(err.message || 'Could not delete memory.'))
  }

  async function sendPrompt(event) {
    event.preventDefault()
    const cleanPrompt = prompt.trim()
    if (!cleanPrompt || streaming) return

    if (!isLoggedIn || !authToken) {
      onLogin()
      return
    }

    setActiveView('Chat')
    setPrompt('')
    const tempUserId = `local_user_${Date.now()}`
    const tempAsstId = `local_asst_${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: tempUserId, role: 'user', content: cleanPrompt },
      { id: tempAsstId, role: 'assistant', content: '', streaming: true },
    ])
    setStreaming(true)

    try {
      const result = await streamChat({
        token: authToken,
        message: cleanPrompt,
        conversationId,
        onDelta: (_chunk, fullText) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempAsstId ? { ...m, content: fullText } : m)),
          )
        },
        onMeta: (meta) => {
          if (meta.conversationId) setConversationId(meta.conversationId)
        },
      })

      setConversationId(result.conversationId)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAsstId
            ? { ...m, content: result.fullText, streaming: false }
            : m,
        ),
      )
      setNotice('Nexora replied.')
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAsstId
            ? { ...m, content: err.message || 'Something went wrong.', streaming: false, error: true }
            : m,
        ),
      )
      setNotice(err.message || 'Chat failed — is the backend running on :8787?')
    } finally {
      setStreaming(false)
    }
  }

  /* Same streaming pipeline as sendPrompt, but chat stays inside the drawer */
  async function sendDrawerPrompt(event) {
    event.preventDefault()
    const cleanPrompt = drawerPrompt.trim()
    if (!cleanPrompt || drawerStreaming) return

    if (!isLoggedIn || !authToken) {
      onLogin()
      return
    }

    setDrawerPrompt('')
    const tempUserId = `local_user_${Date.now()}`
    const tempAsstId = `local_asst_${Date.now()}`
    setDrawerMessages((prev) => [
      ...prev,
      { id: tempUserId, role: 'user', content: cleanPrompt },
      { id: tempAsstId, role: 'assistant', content: '', streaming: true },
    ])
    setDrawerStreaming(true)

    try {
      const result = await streamChat({
        token: authToken,
        message: cleanPrompt,
        conversationId: drawerConversationId,
        onDelta: (_chunk, fullText) => {
          setDrawerMessages((prev) =>
            prev.map((m) => (m.id === tempAsstId ? { ...m, content: fullText } : m)),
          )
        },
        onMeta: (meta) => {
          if (meta.conversationId) setDrawerConversationId(meta.conversationId)
        },
      })

      setDrawerConversationId(result.conversationId)
      setDrawerMessages((prev) =>
        prev.map((m) => (m.id === tempAsstId ? { ...m, content: result.fullText, streaming: false } : m)),
      )
    } catch (err) {
      setDrawerMessages((prev) =>
        prev.map((m) =>
          m.id === tempAsstId
            ? { ...m, content: err.message || 'Something went wrong.', streaming: false, error: true }
            : m,
        ),
      )
    } finally {
      setDrawerStreaming(false)
    }
  }

  return <main className="workspace-shell" id="workspace" style={{ '--chat-w': `${chatWidth}px` }}>
    {/* The floating account dock is gone — the account drawer now drops down from
        the topbar profile button, so the workspace owns the full viewport. */}
    <section className="workspace-main">
      <header className="workspace-topbar">
        <Brand compact />
        <div className="workspace-actions">
          <button
            className="header-voice-btn"
            type="button"
            title="Talk to Nexora out loud"
            onClick={() => {
              if (!isLoggedIn || !authToken) {
                onLogin()
                return
              }
              setVoiceOpen(true)
            }}
          >
            <span aria-hidden="true">◉</span> Talk
          </button>
          {!isPremium && (
            <button
              className="header-upgrade-btn"
              type="button"
              onClick={() => {
                if (onUpgrade) onUpgrade()
                setNotice('✦ Demo: Pro plan unlocked locally. No payment provider is connected — nothing was actually charged.')
              }}
            >
              <span>✦</span> Try Pro (demo)
            </button>
          )}
          <div className="account-anchor">
            <button
              className="account-button"
              type="button"
              onClick={() => {
                if (isLoggedIn) {
                  setAccountDrawerOpen(!accountDrawerOpen)
                } else {
                  onLogin()
                }
              }}
              aria-expanded={accountDrawerOpen}
              aria-haspopup="dialog"
            >
              <span className="profile-avatar">{userAvatar ? <img src={userAvatar} alt="" className="avatar-img" referrerPolicy="no-referrer" /> : userInitial}</span>
              <span>{isLoggedIn ? userName : 'Log in'}</span>
              <b className={`chevron-arrow ${accountDrawerOpen ? 'drawer-active' : ''}`}>⌄</b>
            </button>

            {/* Account drawer — same options that lived in the removed dock */}
            {accountDrawerOpen && (
              <div className="account-drawer-popup" role="dialog" aria-label="Account and Workspace Options">
                <div className="drawer-header">
                  <span className="drawer-avatar">{userAvatar ? <img src={userAvatar} alt="" className="avatar-img" referrerPolicy="no-referrer" /> : userInitial}</span>
                  <div className="drawer-user-info">
                    <strong>{isLoggedIn ? userName : 'Guest User'}</strong>
                    <span>{isLoggedIn ? userEmail : 'Sign in to sync your work'}</span>
                  </div>
                  <span className="drawer-badge">{isPremium ? 'Plus Pro' : 'Free'}</span>
                </div>

                <button
                  type="button"
                  className="drawer-connect-btn"
                  onClick={() => {
                    setAccountDrawerOpen(false)
                    onLogin()
                  }}
                >
                  <span>＋</span> Switch / Connect Another Account
                </button>

                <button
                  type="button"
                  className="drawer-connect-btn"
                  style={{ borderStyle: 'solid' }}
                  onClick={() => {
                    setAccountDrawerOpen(false)
                    setActiveView('Memory')
                  }}
                >
                  <span>◈</span> Memory &amp; Files
                </button>

                <button
                  type="button"
                  className="drawer-connect-btn"
                  style={{ borderStyle: 'solid' }}
                  onClick={() => {
                    setAccountDrawerOpen(false)
                    setActiveView('Settings')
                  }}
                >
                  <span>⚙</span> Account Settings
                </button>

                {isLoggedIn && (
                  <button
                    type="button"
                    className="drawer-logout-btn"
                    onClick={() => {
                      setAccountDrawerOpen(false)
                      onLogout()
                    }}
                  >
                    <span>⇥</span> Log Out
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="workspace-content" key={activeView}>
        {activeView === 'Chat' && <section className="workspace-page-panel chat-page">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <span className="chat-orb">✦</span>
              <h2>Hi, I’m Nexora.</h2>
              <p>What can I help you think through today?</p>
              <div>{['Explain a concept', 'Write a first draft', 'Plan my day'].map((item) => (
                <button type="button" key={item} onClick={() => setPrompt(item)}>{item}</button>
              ))}</div>
              <button type="button" className="chat-new-thread" onClick={startNewChat}>Start a new thread</button>
            </div>
          ) : (
            <div className="chat-thread" role="log" aria-live="polite">
              {messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => (
                <div key={m.id} className={`chat-bubble ${m.role}${m.error ? ' chat-error' : ''}`}>
                  <span className="chat-bubble-label">{m.role === 'user' ? 'You' : 'Nexora'}</span>
                  <p>{m.content || (m.streaming ? '…' : '')}{m.streaming ? <span className="chat-cursor">▍</span> : null}</p>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
          <form className="prompt-box" onSubmit={sendPrompt}>
            <label className="sr-only" htmlFor="chat-prompt">Type your message</label>
            <input id="chat-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={streaming ? 'Nexora is typing…' : 'Type your message...'} disabled={streaming} />
            <button type="submit" aria-label="Send message" disabled={streaming || !prompt.trim()}>→</button>
          </form>
        </section>}
        {activeView === 'Tools' && <div className="workspace-page-panel">
          <div className="workspace-tool-grid">{tools.map(([icon, title, description, tint]) => <button className={`workspace-tool tint-${tint} ${selectedTool === title ? 'tool-highlighted' : ''}`} type="button" key={title} onClick={() => { if (setSelectedTool) setSelectedTool(title); setNotice(`${title} is ready to try.`) }}><span className="showcase-icon">{icon}</span><strong>{title}</strong><small>{description}</small><b>Open tool →</b></button>)}</div>
        </div>}
        {activeView === 'History' && <section className="workspace-page-panel history-panel">
          <div className="settings-icon">⧗</div>
          <h2>Every chat, text and voice, in one place.</h2>
          <p>Aira keeps spoken calls in the same thread list as your typed chats. Open one to continue where you left off, or delete it — the transcript goes with it.</p>
          {!isLoggedIn ? <p className="history-empty">Sign in to see your saved conversations.</p> : <>
            {convLoading && <p className="history-empty">Loading…</p>}
            {!convLoading && conversations.length === 0 && <p className="history-empty">Nothing saved yet. Start a chat or a Talk call and it will show up here.</p>}
            <ul className="history-list">{conversations.map((c) => <li key={c.id}>
              <button type="button" className="history-open" onClick={() => openConversation(c.id)}>
                <strong>{c.title}</strong>
                <small>{new Date(c.updatedAt).toLocaleString()} · {c.model || 'chat'}</small>
              </button>
              <button type="button" className="history-del" aria-label={`Delete ${c.title}`} onClick={() => removeConversation(c.id)}>×</button>
            </li>)}</ul>
          </>}
        </section>}
        {(activeView === 'Memory' || activeView === 'Settings') && <section className="workspace-page-panel settings-panel">
          <div className="settings-icon">{activeView === 'Memory' ? '◈' : '⚙'}</div>
          <h2>{activeView === 'Memory' ? 'A little context goes a long way.' : 'Your space, your way.'}</h2>
          <p>{activeView === 'Memory' ? 'Everything Aira is allowed to remember lives here — review, edit or delete any of it.' : 'Choose how Aira sounds and which languages she answers in.'}</p>
          {activeView === 'Settings' && <div className="settings-voice-grid">
            <label className="settings-field"><span>Voice</span>
              <select value={voicePrefs.voice} onChange={(event) => persistVoicePrefs({ ...voicePrefs, voice: event.target.value })}>
                {VOICE_OPTIONS.map(([id, name, hint]) => <option key={id} value={id}>{name} — {hint}</option>)}
              </select>
            </label>
            <label className="settings-field"><span>Language</span>
              <select value={voicePrefs.language} onChange={(event) => persistVoicePrefs({ ...voicePrefs, language: event.target.value })}>
                {VOICE_LANGUAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <p className="settings-note">Voice changes take effect on the next Talk call. Speech runs through the live provider — if the backend has no API key the call is refused, never faked.</p>
          </div>}
          {activeView === 'Memory' && <div className="memory-panel">
            {isLoggedIn ? <>
              <form className="memory-add" onSubmit={submitMemory}>
                <input value={memDraft.key} onChange={(event) => setMemDraft((d) => ({ ...d, key: event.target.value }))} placeholder="Topic (e.g. Preferred language)" maxLength={80} />
                <input value={memDraft.value} onChange={(event) => setMemDraft((d) => ({ ...d, value: event.target.value }))} placeholder="Detail (e.g. Reply in Roman Urdu)" maxLength={2000} />
                <button className="button" type="submit" disabled={memBusy || !memDraft.key.trim() || !memDraft.value.trim()}>{memDraft.editingId ? 'Save' : 'Add'}</button>
                {memDraft.editingId && <button className="button button-ghost" type="button" onClick={() => setMemDraft({ key: '', value: '', editingId: null })}>Cancel</button>}
              </form>
              {memLoading && <p className="memory-status">Loading memories…</p>}
              {!memLoading && memories.length === 0 && <p className="memory-status">No memories yet. Add one above, or tell Aira during a Talk call — she only stores what you approve here.</p>}
              <ul className="memory-list">{memories.map((m) => <li key={m.id}>
                <div className="memory-text"><strong>{m.key}</strong><span>{m.value}</span></div>
                <div className="memory-ops">
                  <button type="button" onClick={() => setMemDraft({ key: m.key, value: m.value, editingId: m.id })}>Edit</button>
                  <button type="button" className="memory-danger" onClick={() => removeMemoryEntry(m.id)}>Delete</button>
                </div>
              </li>)}</ul>
            </> : <p className="memory-status">Sign in to let Aira remember things for you.</p>}
          </div>}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
            {!isLoggedIn && <button className="button button-outline" type="button" onClick={onLogin}>Sign in to personalize</button>}
            {isLoggedIn && <button className="button button-ghost" style={{ borderColor: 'rgba(255, 99, 132, 0.4)', color: '#ff7b92' }} type="button" onClick={onLogout}>Sign Out</button>}
          </div>
        </section>}
        {notice && <div className="toast-message" role="status"><span>✦</span>{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
      </div>
    </section>

    {/* Right-edge tab: click to slide the chat drawer in / out */}
    <button
      type="button"
      className={`chat-drawer-tab ${chatOpen ? 'is-open' : ''}`}
      aria-label={chatOpen ? 'Hide Nexora chat' : 'Open Nexora chat'}
      aria-expanded={chatOpen}
      aria-haspopup="dialog"
      onClick={() => setChatOpen((open) => !open)}
    >
      <span aria-hidden="true">✦</span> Chat
    </button>

    {chatOpen && (
      <aside className="chat-drawer" role="dialog" aria-label="Nexora chat drawer">
        <div
          className="chat-drawer-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize chat drawer"
          title="Drag to resize · double-click to reset"
          onMouseDown={() => setChatResizing(true)}
          onDoubleClick={() => setChatWidth(CHAT_DRAWER_DEFAULT)}
        />
        <header className="chat-drawer-head">
          <span className="chat-drawer-title"><span aria-hidden="true">✦</span> Nexora Chat</span>
          <div className="chat-drawer-tools">
            <button
              type="button"
              className={`chat-drawer-pin ${chatPinned ? 'is-pinned' : ''}`}
              aria-pressed={chatPinned}
              aria-label={chatPinned ? 'Unpin chat drawer' : 'Keep chat drawer open'}
              onClick={() => setChatPinned((pinned) => !pinned)}
            >{chatPinned ? 'Pinned' : 'Pin'}</button>
            <button type="button" className="chat-drawer-close" aria-label="Close chat drawer" onClick={() => { setChatPinned(false); setChatOpen(false) }}>×</button>
          </div>
        </header>
        <div className="chat-drawer-body">
          {drawerMessages.length === 0 ? (
            <div className="chat-drawer-empty">
              <span className="chat-orb">✦</span>
              <h2>Ask without leaving your page.</h2>
              <p>Pin it to keep it open, or drag its left edge to make it wider.</p>
              <div>{['Explain a concept', 'Write a first draft', 'Plan my day'].map((item) => (
                <button type="button" key={item} onClick={() => setDrawerPrompt(item)}>{item}</button>
              ))}</div>
            </div>
          ) : (
            <div className="chat-drawer-thread" role="log" aria-live="polite">
              {drawerMessages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => (
                <div key={m.id} className={`chat-bubble ${m.role}${m.error ? ' chat-error' : ''}`}>
                  <span className="chat-bubble-label">{m.role === 'user' ? 'You' : 'Nexora'}</span>
                  <p>{m.content || (m.streaming ? '…' : '')}{m.streaming ? <span className="chat-cursor">▍</span> : null}</p>
                </div>
              ))}
              <div ref={drawerEndRef} />
            </div>
          )}
        </div>
        <form className="chat-drawer-input" onSubmit={sendDrawerPrompt}>
          <label className="sr-only" htmlFor="drawer-prompt">Type your message</label>
          <input id="drawer-prompt" value={drawerPrompt} onChange={(event) => setDrawerPrompt(event.target.value)} placeholder={drawerStreaming ? 'Nexora is typing…' : 'Ask Nexora anything...'} disabled={drawerStreaming} />
          <button type="submit" aria-label="Send message" disabled={drawerStreaming || !drawerPrompt.trim()}>→</button>
        </form>
      </aside>
    )}

    {mobileMoreOpen && <div className="mobile-more-menu" role="menu">{navItems.slice(4).map(([label, icon]) => <button type="button" role="menuitem" key={label} onClick={() => { setActiveView(label); setMobileMoreOpen(false) }}><span>{icon}</span>{label}</button>)}</div>}
    <nav className="mobile-workspace-nav" aria-label="Mobile workspace navigation">
      {navItems.slice(0, 4).map(([label, icon]) => <button className={activeView === label ? 'selected' : ''} type="button" key={label} onClick={() => { setActiveView(label); setMobileMoreOpen(false) }}><span>{icon}</span><small>{label}</small></button>)}
      <button type="button" aria-expanded={mobileMoreOpen} onClick={() => setMobileMoreOpen((open) => !open)}><span>•••</span><small>More</small></button>
    </nav>

    {/* Live voice call — full-screen dialog over the workspace */}
    {voiceOpen && (
      <Suspense fallback={null}>
        <VoiceCall authToken={authToken} user={userProfile} prefs={voicePrefs} onClose={() => setVoiceOpen(false)} />
      </Suspense>
    )}
  </main>
}

export default function Nexora() {
  const initialSession = loadSession()
  const [showWorkspace, setShowWorkspace] = useState(() =>
    Boolean(initialSession?.isLoggedIn && initialSession?.token && initialSession?.inWorkspace !== false),
  )
  const [showLogin, setShowLogin] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(initialSession?.isLoggedIn && initialSession?.token))
  const [userProfile, setUserProfile] = useState(() => initialSession?.userProfile || null)
  const [authToken, setAuthToken] = useState(() => initialSession?.token || null)
  const [activeView, setActiveView] = useState(() => initialSession?.activeView || 'Home')
  const [selectedTool, setSelectedTool] = useState(null)
  const [pendingNavigation, setPendingNavigation] = useState(null)
  // 'google' | 'signup' | null — while set, the onboarding page stays in front of the workspace
  const [onboardingSource, setOnboardingSource] = useState(() => {
    try {
      const stored = localStorage.getItem(ONBOARDING_KEY)
      return stored ? (stored === '1' ? 'google' : stored) : null
    } catch { return null }
  })

  function persistWorkspace(open, view) {
    const session = loadSession()
    if (!session?.token) return
    saveSession({
      token: session.token,
      user: session.userProfile,
      inWorkspace: open,
      activeView: view ?? activeView,
    })
  }

  useEffect(() => {
    if (!authToken) return
    let cancelled = false
    me(authToken)
      .then((res) => {
        if (cancelled) return
        const session = saveSession({ token: authToken, user: res.user, inWorkspace: true })
        setUserProfile(session.userProfile)
        setIsLoggedIn(true)
        // Keep the onboarding page in front if the name step is still pending
        if (!onboardingSource) setShowWorkspace(true)
      })
      .catch((err) => {
        if (cancelled) return
        if (err?.status === 401) {
          clearSession()
          setAuthToken(null)
          setUserProfile(null)
          setIsLoggedIn(false)
          setShowWorkspace(false)
          return
        }
        const cached = loadSession()
        if (cached?.token) {
          setIsLoggedIn(true)
          setShowWorkspace(cached.inWorkspace !== false)
        }
      })
    return () => { cancelled = true }
  }, [authToken])

  function handleNavigate(targetView = 'Home', targetTool = null, targetLabel = null) {
    if (!isLoggedIn) {
      setPendingNavigation({ view: targetView, tool: targetTool, label: targetLabel || targetView })
      setShowLogin(true)
    } else {
      setActiveView(targetView)
      setSelectedTool(targetTool)
      setShowWorkspace(true)
      persistWorkspace(true, targetView)
    }
  }

  function handleLoginSuccess(profile) {
    const token = profile?.token || loadSession()?.token || null
    const nextView = pendingNavigation?.view || 'Home'
    // New Google connections AND freshly created accounts get the onboarding page
    const onboardSource = profile?.source === 'google' ? 'google' : profile?.source === 'signup' ? 'signup' : null
    const needsOnboard = Boolean(onboardSource)
    if (needsOnboard) {
      /* fresh journey → drop any half-finished progress from an earlier account */
      try {
        localStorage.setItem(ONBOARDING_KEY, onboardSource)
        localStorage.removeItem('nexora_onboarding_progress')
      } catch { /* private mode */ }
      setOnboardingSource(onboardSource)
    }
    setAuthToken(token)
    setIsLoggedIn(true)
    setUserProfile(profile)
    setShowLogin(false)
    setShowWorkspace(!needsOnboard)
    if (pendingNavigation) {
      setActiveView(nextView)
      if (pendingNavigation.tool) {
        setSelectedTool(pendingNavigation.tool)
      }
      setPendingNavigation(null)
    } else {
      setActiveView('Home')
    }
    if (token) {
      saveSession({
        token,
        user: profile,
        inWorkspace: !needsOnboard,
        activeView: nextView,
      })
    }
  }

  function handleOnboardingComplete(updatedUser) {
    try { localStorage.removeItem(ONBOARDING_KEY) } catch { /* private mode */ }
    setOnboardingSource(null)
    if (updatedUser && authToken) {
      const session = saveSession({ token: authToken, user: updatedUser, inWorkspace: true })
      setUserProfile(session.userProfile)
    } else {
      persistWorkspace(true)
    }
    setShowWorkspace(true)
  }

  function handleLogout() {
    clearSession()
    try {
      localStorage.removeItem(ONBOARDING_KEY)
      localStorage.removeItem('nexora_onboarding_progress')
    } catch { /* private mode */ }
    setIsLoggedIn(false)
    setUserProfile(null)
    setAuthToken(null)
    setShowWorkspace(false)
    setOnboardingSource(null)
    setSelectedTool(null)
    setPendingNavigation(null)
  }

  async function handleUpgrade() {
    if (!authToken) {
      setShowLogin(true)
      return
    }
    /* Real checkout is not wired yet — this only flips the plan flag locally.
       If the backend rejects it, surface the error rather than lying to the
       session cache about being Pro. */
    try {
      const res = await upgradePlan(authToken, 'pro')
      const session = saveSession({ token: authToken, user: res.user })
      setUserProfile(session.userProfile)
    } catch (err) {
      console.error('[nexora] upgrade failed', err)
    }
  }

  function handleProfileUpdate(user) {
    if (!authToken || !user) return
    const session = saveSession({ token: authToken, user })
    setUserProfile(session.userProfile)
  }

  return (
    <>
      <CursorTrail />
      {showLogin ? (
        <SignIn
          onBack={() => setShowLogin(false)}
          onLoginSuccess={handleLoginSuccess}
          targetLabel={pendingNavigation?.label}
        />
      ) : onboardingSource ? (
        <Suspense fallback={null}>
          <Onboarding userProfile={userProfile} source={onboardingSource} onComplete={handleOnboardingComplete} />
        </Suspense>
      ) : showWorkspace ? (
        <Workspace
          activeView={activeView}
          setActiveView={setActiveView}
          selectedTool={selectedTool}
          setSelectedTool={setSelectedTool}
          onBack={() => {
            setShowWorkspace(false)
            persistWorkspace(false)
          }}
          isLoggedIn={isLoggedIn}
          userProfile={userProfile}
          authToken={authToken}
          onLogin={() => setShowLogin(true)}
          onLogout={handleLogout}
          onUpgrade={handleUpgrade}
          onProfileUpdate={handleProfileUpdate}
        />
      ) : (
        <Landing
          onLogin={() => {
            setPendingNavigation({ view: 'Home', tool: null, label: 'Workspace' })
            setShowLogin(true)
          }}
          onNavigate={handleNavigate}
          isLoggedIn={isLoggedIn}
          userProfile={userProfile}
          onUpgrade={handleUpgrade}
        />
      )}
    </>
  )
}
