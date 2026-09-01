#!/usr/bin/env node
// Controlled A/B benchmark against Z.ai — isolates provider-side latency from harness effects.
// Matrix: {glm-5.3-flash, glm-5.3} x {max, high, low} effort x {no tools, tools+tool_stream on/off} x {coding, general endpoint probe}.
// Metrics mirror the dsh UI exactly (dsh-client-ui-conversation/lib/client.js):
//   TTFT   = request dispatch -> first token-delta event (reasoning_content, content, or tool_calls all count)
//   tok/s  = usage.completion_tokens (thinking included) / (done - firstToken)
// Usage: ZAI_API_KEY=... node scripts/zai-ab-bench.mjs [--reps N] [--out /tmp/zai-ab-bench-results.json]

import { writeFileSync } from "node:fs";

const CODING = "https://api.z.ai/api/coding/paas/v4";
const GENERAL = "https://api.z.ai/api/paas/v4";

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const REPS = Number(argVal("--reps", "2"));
const OUT = argVal("--out", "/tmp/zai-ab-bench-results.json");
const KEY = process.env.ZAI_API_KEY;
if (!KEY) { console.error("ZAI_API_KEY env required"); process.exit(1); }

const PLAIN_PROMPT = "Explain in roughly 250 words, plain prose, no headings, why HTTP/2 multiplexing improves latency for API clients compared to HTTP/1.1.";
const TOOL_PROMPT = "What is the weather in Paris right now? Use the get_weather tool.";
const TOOLS = [{
  type: "function",
  function: {
    name: "get_weather",
    description: "Get current weather for a city",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] }
  }
}];

const isTokenDelta = (d) =>
  d && ((d.reasoning_content !== undefined && d.reasoning_content !== null) ||
        (d.content !== undefined && d.content !== null) ||
        (d.tool_calls !== undefined && d.tool_calls !== null));

async function oneRun({ model, effort, tools, tool_stream, endpoint, label }) {
  const body = {
    model,
    messages: [{ role: "user", content: tools ? TOOL_PROMPT : PLAIN_PROMPT }],
    max_tokens: 4096,
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: "enabled", clear_thinking: false },
    reasoning_effort: effort,
  };
  if (tools) { body.tools = TOOLS; body.tool_choice = "auto"; body.tool_stream = tool_stream; }

  const t0 = Date.now();
  let tFirst = null, tDone = null, usage = null, servedModel = null, firstDeltaKind = null, chunks = 0, err = null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout 180s")), 180000);
  try {
    const res = await fetch(endpoint + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { label, error: "HTTP " + res.status + " " + txt.slice(0, 160), ttft_s: null, tok_s: null };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") { tDone = tDone ?? Date.now(); continue; }
          let ev; try { ev = JSON.parse(payload); } catch { continue; }
          chunks++;
          if (ev.model) servedModel = ev.model;
          if (ev.usage) usage = ev.usage;
          const d = ev.choices && ev.choices[0] && ev.choices[0].delta;
          if (tFirst === null && isTokenDelta(d)) {
            tFirst = Date.now();
            firstDeltaKind = d.reasoning_content != null ? "reasoning" : (d.content != null ? "content" : "toolcall");
          }
        }
      }
    }
    tDone = tDone ?? Date.now();
  } catch (e) {
    err = String(e && e.message || e).slice(0, 160);
  } finally { clearTimeout(timer); }

  const ttft_s = tFirst !== null ? (tFirst - t0) / 1000 : null;
  const decode_s = tFirst !== null && tDone !== null ? (tDone - tFirst) / 1000 : null;
  const outTok = usage ? usage.completion_tokens : null;
  const tok_s = outTok !== null && decode_s ? +(outTok / decode_s).toFixed(1) : null;
  return {
    label, model: servedModel || model, effort, tools: !!tools, tool_stream: tools ? tool_stream : null,
    endpoint: endpoint.includes("coding") ? "coding" : "general",
    ttft_s: ttft_s !== null ? +ttft_s.toFixed(2) : null,
    decode_s: decode_s !== null ? +decode_s.toFixed(2) : null,
    total_s: +((tDone - t0) / 1000).toFixed(2),
    completion_tokens: outTok,
    reasoning_tokens: usage && usage.completion_tokens_details ? usage.completion_tokens_details.reasoning_tokens ?? null : null,
    prompt_tokens: usage ? usage.prompt_tokens ?? null : null,
    cached_tokens: usage && usage.prompt_tokens_details ? usage.prompt_tokens_details.cached_tokens ?? null : null,
    first_delta_kind: firstDeltaKind, sse_chunks: chunks, error: err,
  };
}

// Build interleaved run list so load variance spreads across combos.
const combos = [];
for (const model of ["glm-5.3-flash", "glm-5.3"])
  for (const effort of ["max", "high", "low"])
    combos.push({ model, effort, tools: false, tool_stream: null, endpoint: CODING, label: model + " @ " + effort + " plain" });
for (const model of ["glm-5.3-flash", "glm-5.3"])
  for (const ts of [true, false])
    combos.push({ model, effort: "max", tools: true, tool_stream: ts, endpoint: CODING, label: model + " @ max tools ts=" + ts });
// Endpoint probe: flash @ max on the general endpoint (may fail if key is coding-plan-only).
combos.push({ model: "glm-5.3-flash", effort: "max", tools: false, tool_stream: null, endpoint: GENERAL, label: "glm-5.3-flash @ max GENERAL-endpoint probe" });

const runs = [];
for (let rep = 1; rep <= REPS; rep++) for (const c of combos) runs.push({ ...c, rep });

console.log("zai-ab-bench: " + runs.length + " runs (" + REPS + " reps x " + combos.length + " combos), max_tokens 4096, sequential");
const results = [];
for (const r of runs) {
  process.stdout.write("run " + (results.length + 1) + "/" + runs.length + "  " + r.label + " [rep " + r.rep + "] ... ");
  const out = await oneRun(r);
  results.push(out);
  console.log(out.error ? "ERROR " + out.error : "TTFT " + out.ttft_s + "s  " + out.tok_s + " tok/s  decode " + out.decode_s + "s  out " + out.completion_tokens + " (think " + (out.reasoning_tokens ?? "?") + ")  first=" + out.first_delta_kind + (out.cached_tokens != null ? "  cached " + out.cached_tokens : ""));
  await new Promise(res => setTimeout(res, 400));
}

// Summary: group by label, median TTFT + median tok/s.
const median = (a) => { const v = a.filter(x => x !== null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const groups = new Map();
for (const r of results) { if (!groups.has(r.label)) groups.set(r.label, []); groups.get(r.label).push(r); }
console.log("\n=== SUMMARY (medians) ===");
console.log("combo".padEnd(46) + "TTFT_s".padStart(7) + "tok/s".padStart(8) + "decode_s".padStart(9) + "out_tok".padStart(8) + "think".padStart(7) + "errs".padStart(5));
const summary = [];
for (const [label, rs] of groups) {
  const errs = rs.filter(r => r.error).length;
  const ok = rs.filter(r => !r.error);
  const row = {
    label,
    n: rs.length, errors: errs,
    ttft_s_med: median(ok.map(r => r.ttft_s)),
    tok_s_med: median(ok.map(r => r.tok_s)),
    decode_s_med: median(ok.map(r => r.decode_s)),
    completion_tokens_med: median(ok.map(r => r.completion_tokens)),
    reasoning_tokens_med: median(ok.map(r => r.reasoning_tokens)),
  };
  summary.push(row);
  console.log(label.padEnd(46) + String(row.ttft_s_med).padStart(7) + String(row.tok_s_med).padStart(8) + String(row.decode_s_med).padStart(9) + String(row.completion_tokens_med).padStart(8) + String(row.reasoning_tokens_med).padStart(7) + String(errs).padStart(5));
}
writeFileSync(OUT, JSON.stringify({ started: new Date().toISOString(), reps: REPS, results, summary }, null, 2));
console.log("\nfull results -> " + OUT);
