/* Starts the frontend and the backend together with one command, so the app can never
   be open while its API is forgotten — the #1 cause of a mysterious "Failed to fetch".
   Usage: npm run dev:all     (Ctrl+C closes both) */
import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const backendDir = fileURLToPath(new URL('../backend', import.meta.url))
const rootDir = fileURLToPath(new URL('..', import.meta.url))

const targets = [
  ['api', process.execPath, ['--watch', 'src/index.js'], backendDir],
  ['web', process.execPath, ['./node_modules/vite/bin/vite.js'], rootDir],
]

const children = targets.map(([name, cmd, args, cwd]) => {
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
  const pipe = (stream, out) => {
    stream.setEncoding('utf8')
    let rest = ''
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/)
      rest = lines.pop() ?? ''
      for (const line of lines) out.write(`[${name}] ${line}\n`)
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  return child
})

const shutdown = () => {
  for (const child of children) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
for (const child of children) {
  child.on('exit', (code) => {
    if (children.some((c) => c.exitCode === null && c.signalCode === null)) return
    process.exit(code ?? 0)
  })
}
