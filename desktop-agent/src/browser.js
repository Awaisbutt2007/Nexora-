import fs from 'node:fs'
import path from 'node:path'

/* Browser automation via Playwright. Two non-negotiable rules:
   1. A DEDICATED automation profile (AGENT_BROWSER_PROFILE) is used, never the
      user's real browser profile — so no personal cookies, saved passwords,
      history or session tokens are ever read, exported or reused.
   2. Navigation is confined to http(s) and, when AGENT_ALLOWED_HOSTS is set, to
      those hosts.

   Playwright is an OPTIONAL dependency: the module lazily imports it so the agent
   (and its tests) run with the browser binary absent; browser actions then fail
   with a clear "install it" message instead of crashing the process. */

let ctxPromise = null

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    const e = new Error('Playwright is not installed. Run `npm run browsers:install` inside desktop-agent/ to enable browser automation.')
    e.code = 'PLAYWRIGHT_MISSING'
    throw e
  }
}

/* One persistent context for the session → the automation "persona" (its own
   profile dir) survives between actions, exactly like a real logged-out browser
   the user can watch. */
async function getContext({ profileDir, headless, allowedHosts }) {
  if (ctxPromise) return ctxPromise
  const pw = await loadPlaywright()
  fs.mkdirSync(profileDir, { recursive: true })
  ctxPromise = pw.chromium.launchPersistentContext(profileDir, {
    headless,
    args: ['--no-default-browser-check', '--no-first-run'],
  }).then(async (ctx) => {
    ctx.__allowedHosts = allowedHosts || []
    return ctx
  }).catch((err) => { ctxPromise = null; throw err })
  return ctxPromise
}

function assertHostAllowed(url, allowedHosts) {
  const u = new URL(url)
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are allowed.')
  if (allowedHosts && allowedHosts.length && !allowedHosts.includes(u.hostname.toLowerCase())) {
    throw new Error(`Host "${u.hostname}" is not in the approved browser host list.`)
  }
  return u
}

async function openPage(ctx, url, { waitFor = 'load', signal } = {}) {
  assertHostAllowed(url, ctx.__allowedHosts)
  if (signal?.aborted) throw signal.reason || new Error('cancelled')
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  await page.goto(url, { waitUntil: waitFor })
  if (signal?.aborted) { await page.close(); throw signal.reason || new Error('cancelled') }
  return page
}

async function activePage(ctx) {
  const pages = ctx.pages()
  return pages[pages.length - 1] || null
}

/* ---- public action handlers (each gets (args, signal)) ---- */

export async function open(args, opts) {
  const ctx = await getContextFor(opts)
  const page = await openPage(ctx, args.url, { waitFor: args.waitFor, signal: opts.signal })
  // leave the page open for follow-up snapshot/click actions
  return { url: page.url(), title: await page.title(), status: 'opened' }
}

export async function search(args, opts) {
  const ctx = await getContextFor(opts)
  const engineBase = { google: 'https://www.google.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=', bing: 'https://www.bing.com/search?q=' }[args.engine]
  const engineUrl = `${engineBase}${encodeURIComponent(args.query)}`
  const page = await openPage(ctx, engineUrl, { signal: opts.signal })
  return { engine: args.engine, query: args.query, url: page.url(), title: await page.title() }
}

export async function snapshot(args, opts) {
  const ctx = await getContextFor(opts)
  let page
  if (args.url) page = await openPage(ctx, args.url, { signal: opts.signal })
  else page = await activePage(ctx)
  if (!page) throw new Error('No page is open. Call browser.open or browser.search first.')
  const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '')
  return { url: page.url(), title: await page.title(), text: bodyText.slice(0, args.maxChars), truncated: bodyText.length > args.maxChars }
}

export async function click(args, opts) {
  const ctx = await getContextFor(opts)
  const page = await activePage(ctx)
  if (!page) throw new Error('No page is open.')
  const locator = args.by === 'text' ? page.getByText(args.selector).first() : page.locator(args.selector).first()
  await locator.waitFor({ state: 'visible', timeout: 15000 })
  await locator.click()
  return { clicked: args.selector, by: args.by, url: page.url() }
}

export async function fill(args, opts) {
  const ctx = await getContextFor(opts)
  const page = await activePage(ctx)
  if (!page) throw new Error('No page is open.')
  let locator
  if (args.by === 'label') locator = page.getByLabel(args.selector).first()
  else if (args.by === 'placeholder') locator = page.getByPlaceholder(args.selector).first()
  else if (args.by === 'text') locator = page.getByText(args.selector).first()
  else locator = page.locator(args.selector).first()
  await locator.waitFor({ state: 'visible', timeout: 15000 })
  await locator.fill(args.value)
  // NOTE: value is never returned (it may be private) — confirm that invariant.
  return { filled: args.selector, by: args.by }
}

export async function submit(args, opts) {
  const ctx = await getContextFor(opts)
  const page = await activePage(ctx)
  if (!page) throw new Error('No page is open.')
  const locator = args.by === 'text' ? page.getByText(args.selector).first() : page.locator(args.selector).first()
  await locator.waitFor({ state: 'visible', timeout: 15000 })
  await locator.click()
  return { submitted: true, url: page.url(), note: 'Form submitted — this action was irreversible and was explicitly confirmed.' }
}

export async function screenshot(args, opts) {
  const ctx = await getContextFor(opts)
  const page = await activePage(ctx)
  if (!page) throw new Error('No page is open.')
  fs.mkdirSync(opts.screenshotDir, { recursive: true })
  const name = (args.name || `shot-${Date.now()}`).replace(/[^\w-]/g, '')
  const file = path.join(opts.screenshotDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return { saved: file, url: page.url() }
}

/* ---- lifecycle ---- */

async function getContextFor(opts) {
  return getContext({ profileDir: opts.profileDir, headless: opts.headless, allowedHosts: opts.allowedHosts })
}

export function isAvailable() {
  return ctxPromise !== null
}

export async function close() {
  if (ctxPromise) {
    const ctx = await ctxPromise.catch(() => null)
    try { await ctx?.close() } catch { /* ignore */ }
    ctxPromise = null
  }
}
