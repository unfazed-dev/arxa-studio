// Engine switch INTO Claude mid-session: Claude has no transcript yet, dsh has all of it.
// Flat text, not replayed messages — the child starts a fresh session and only needs to know
// what already happened.
const MAX = 40_000
const HEADER = 'Conversation so far in this arxa session (another model handled it):\n'
const TRIM = '…(earlier turns trimmed)\n'

export function renderHandoff (messages) {
  if (messages.length === 0) return ''
  const lines = []
  const callLine = new Map() // tool call id -> the line index still waiting for its result
  for (const m of messages) {
    for (const b of m.content ?? []) {
      if (b.type === 'text') lines.push(`${m.role === 'assistant' ? 'Assistant' : 'User'}: ${b.text}`)
      else if (b.type === 'tool-call') { callLine.set(b.id, lines.length); lines.push(`[tool ${b.name}(${b.arguments})`) }
      else if (b.type === 'tool-result') {
        const out = (b.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
        const i = callLine.get(b.toolCallId) // paired by id: parallel calls resolve out of order
        if (i === undefined) lines.push(`[tool result → ${out}]`)
        else { lines[i] += ` → ${out}]`; callLine.delete(b.toolCallId) }
      }
    }
  }
  for (const i of callLine.values()) lines[i] += ']' // a call whose result never came back
  let body = lines.join('\n')
  // Oldest first: the tail is what the next model needs to keep going. The cap is on the
  // RENDERED string — header and marker included — so the caller's budget is the real one.
  // ponytail: the cut is by characters, not line boundaries; the marker says so, and a
  // line-aligned cut would drop everything when the tail happens to be one huge line.
  if (HEADER.length + body.length > MAX) body = TRIM + body.slice(-(MAX - HEADER.length - TRIM.length))
  return HEADER + body
}
