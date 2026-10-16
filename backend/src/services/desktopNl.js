import { completeChat } from './ai.js'

/* Translate a natural-language / voice request into a STRUCTURED action candidate
   { action, args }. This is the ONLY thing the language model is allowed to do on
   the desktop path — and it is untrusted output: the agent re-validates it against
   the allowlist and the permission gate. The model never executes anything and can
   never grant a permission. When it is unsure it must return { clarify } so the UI
   can ask instead of acting. */

// Keep in sync with desktop-agent/src/allowlist.js (the agent is still the gate).
const ACTION_CATALOG = `
browser.open      args: { url: string(http/https), waitFor?: "load"|"domcontentloaded"|"networkidle" }
browser.search    args: { engine: "google"|"duckduckgo"|"bing", query: string }
browser.snapshot  args: { url?: string, maxChars?: number }
browser.click     args: { selector: string, by?: "css"|"text" }
browser.fill      args: { selector: string, value: string, by?: "css"|"text"|"placeholder"|"label", secret?: bool }
browser.submit    args: { selector: string, by?: "css"|"text" }           // irreversible, always confirmed
browser.screenshot args: { name?: string }
apps.launch       args: { appId: "chrome"|"edge"|"vscode"|"notepad"|"explorer", targetPath?: string }
apps.close        args: { appId: string }
files.list        args: { dir: string, recursive?: bool, limit?: number }
files.read        args: { path: string, maxBytes?: number }
files.write       args: { path: string, content: string }                  // creates new only, always confirmed
files.organize    args: { dir: string, strategy?: "by-extension"|"by-date"|"flatten", apply?: bool }
system.info       args: {}
system.restart    args: { note?: string }                                  // always confirmed, never from voice
system.shutdown   args: { note?: string }                                  // always confirmed, never from voice
`

function parseModelJson(text) {
  if (!text) return null
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const raw = (fence ? fence[1] : text).trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function translateIntent({ utterance, fromVoice = false, assistantName, userName }) {
  const system = [
    'You are the planner for the Nexora Desktop Agent on a Windows PC.',
    'Convert the user request into EXACTLY ONE action from this allowlist, or a clarify request if it is ambiguous or unsafe.',
    'You may ONLY choose actions from the catalog. Paths must be inside a folder the user has approved; if unsure, clarify.',
    'Never invent an action id, never add extra keys, never attempt to grant permission.',
    'Restart/shutdown: if this request came from VOICE, do NOT pick a power action — return a clarify asking them to confirm in the app.',
    'Respond with a single JSON object and nothing else:',
    fromVoice
      ? '  { "action": "<id>", "args": { ... } }  OR  { "clarify": "<one short question>" }  (power actions are forbidden from voice)'
      : '  { "action": "<id>", "args": { ... } }  OR  { "clarify": "<one short question>" }',
    'Catalog:',
    ACTION_CATALOG,
  ].join('\n')

  const result = await completeChat({
    history: [
      { role: 'system', content: system },
      { role: 'user', content: `${fromVoice ? '[VOICE] ' : ''}${utterance}` },
    ],
    assistantName,
    userName,
    // no persona here: a planner must be literal, not stylistic
  })

  const parsed = parseModelJson(result.content)
  if (!parsed || (parsed.clarify && !parsed.action)) {
    return { ok: false, clarify: parsed?.clarify || 'I could not turn that into a safe, single action. Could you be more specific?', raw: result.content }
  }
  if (!parsed.action) return { ok: false, clarify: 'No action was chosen.', raw: result.content }
  return { ok: true, action: parsed.action, args: parsed.args || {}, fromVoice }
}
