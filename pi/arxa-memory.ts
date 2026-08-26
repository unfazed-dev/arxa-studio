/**
 * arxa-memory.ts — Pi extension: inject project memory once per session.
 *
 * The engine owns memory; this is its Pi hand (G.17): shells
 * `arxa memory recall --project <cwd>` and injects the result as a
 * persistent message on the FIRST before_agent_start of the session
 * (the event fires on every prompt — the flag keeps one injection).
 *
 * Verified API (pi-coding-agent docs/extensions.md §before_agent_start):
 * returning { message: { customType, content, display } } injects a
 * persistent message stored in the session and sent to the LLM.
 *
 * Install: copy or symlink next to arxa-gate.ts in
 * ~/.pi/agent/extensions/ or <project>/.pi/extensions/.
 */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export default function (pi: any) {
  let injected = false;

  pi.on("before_agent_start", async () => {
    if (injected) return undefined;
    injected = true;

    const arxa = process.env.ARXA_BIN
      ?? join(homedir(), ".local", "bin", "arxa");
    const r = spawnSync(arxa, ["memory", "recall", "--project", process.cwd()], {
      encoding: "utf8", timeout: 10_000,
    });
    // Missing binary / error / empty store: inject nothing. Memory is an
    // enhancement, never a session gate.
    if (r.error || r.status !== 0) return undefined;
    const out = (r.stdout ?? "").trim();
    if (!out || out.startsWith("no matching facts") || out.startsWith("no topic")) {
      return undefined;
    }

    return {
      message: {
        customType: "arxa-memory",
        content: "Project memory (arxa memory recall — `arxa memory why "
          + "<topic> <i>` for provenance):\n" + out.slice(0, 4096),
        display: false,
      },
    };
  });
}
