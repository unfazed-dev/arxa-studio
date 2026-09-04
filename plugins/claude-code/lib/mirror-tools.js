// Claude Code's built-in tools, re-declared as dsh tools so the stock loop can dispatch
// the tool-call blocks the bridge emits. `execute` never runs anything: the child already
// did, inside arxa's sandbox; we just hand the loop the result Claude saw.
// Parameter schemas are deliberately loose (the model never sees these — Claude Code's own
// schema drove the call); they exist so the loop's argument validation accepts any payload.
export const MIRROR_TOOL_NAMES = [
  'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'BashOutput', 'KillShell',
  'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'Skill', 'TodoWrite',
  'AskUserQuestion', 'ToolSearch', 'ExitPlanMode', 'EnterPlanMode',
]

const LOOSE = { type: 'object', additionalProperties: true, properties: {} }
const KNOWN_PARAMS = { // a few named fields so the generic card shows something useful
  Read: { file_path: { type: 'string', description: 'Path Claude read.' } },
  Write: { file_path: { type: 'string', description: 'Path Claude wrote.' } },
  Edit: { file_path: { type: 'string', description: 'Path Claude edited.' } },
  Bash: { command: { type: 'string', description: 'Command Claude ran.' } },
  Glob: { pattern: { type: 'string' } }, Grep: { pattern: { type: 'string' } },
}

export function mirrorToolDefinitions (defineTool, pending) {
  return MIRROR_TOOL_NAMES.map((name) => defineTool({
    name,
    description: `${name} — executed by Claude Code inside arxa's sandbox; this row shows its result.`,
    parameters: KNOWN_PARAMS[name] ?? {},
    output: {
      schema: { ...LOOSE, properties: { text: { type: 'string', required: true, description: 'Tool output as Claude saw it.' } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute (_args, exec) {
      const out = await pending.expect(exec.callId, exec.signal)
      if (out.isError) throw new Error(out.text)
      return { text: out.text }
    },
  }))
}
