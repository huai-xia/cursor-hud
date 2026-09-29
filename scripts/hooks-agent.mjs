#!/usr/bin/env node
/**
 * cursor-hud production hooks (P3 option A).
 * - preToolUse(Task) → mark running in ~/.cursor/cursor-hud/agent-hooks.json
 * - postToolUse(Task) / subagentStop → mark completed if they ever fire (merge ignores force-complete)
 * Fail-open always.
 *
 * Usage: node hooks-agent.mjs <eventName>
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const EVENT = (process.argv[2] || "unknown").trim() || "unknown";
const HUD_DIR = join(homedir(), ".cursor", "cursor-hud");
const STORE = process.env.CURSOR_HUD_AGENT_HOOKS?.trim() || join(HUD_DIR, "agent-hooks.json");
const CAPTURE_DIR = join(HUD_DIR, "hooks-capture");
const DISABLED = process.env.CURSOR_HUD_HOOKS?.trim() === "0";
const WANT_CAPTURE = Boolean(process.env.CURSOR_HUD_HOOKS_CAPTURE?.trim());

const MAX_SESSIONS = 40;
const MAX_PER_SESSION = 30;

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", () => resolve(""));
    setTimeout(() => resolve(chunks.join("")), 1200);
  });
}

function respond(event) {
  if (event === "subagentStart" || event === "preToolUse" || event === "beforeShellExecution") {
    process.stdout.write(JSON.stringify({ permission: "allow" }));
    return;
  }
  process.stdout.write("{}");
}

function loadStore() {
  try {
    if (!existsSync(STORE)) return { sessions: {} };
    const raw = JSON.parse(readFileSync(STORE, "utf8"));
    return raw?.sessions ? raw : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

function saveStore(data) {
  mkdirSync(dirname(STORE), { recursive: true });
  const sids = Object.keys(data.sessions);
  if (sids.length > MAX_SESSIONS) {
    for (const old of sids.slice(0, sids.length - MAX_SESSIONS)) delete data.sessions[old];
  }
  writeFileSync(STORE, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
}

function truncate(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function upsert(sessionId, toolUseId, patch) {
  if (!sessionId || !toolUseId) return;
  const store = loadStore();
  const bucket = store.sessions[sessionId] || (store.sessions[sessionId] = {});
  const prev = bucket[toolUseId] || {
    status: "running",
    type: "agent",
    background: false,
    startedAt: Date.now(),
    toolUseId,
  };
  bucket[toolUseId] = { ...prev, ...patch, toolUseId };
  const ids = Object.keys(bucket);
  if (ids.length > MAX_PER_SESSION) {
    const sorted = ids
      .map((id) => ({ id, t: bucket[id].startedAt || 0 }))
      .sort((a, b) => a.t - b.t);
    for (const old of sorted.slice(0, ids.length - MAX_PER_SESSION)) delete bucket[old.id];
  }
  saveStore(store);
}

function maybeCapture(event, payload) {
  if (!WANT_CAPTURE || !payload) return;
  try {
    mkdirSync(CAPTURE_DIR, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safe = event.replace(/[^a-zA-Z0-9_-]/g, "_");
    const body = { ...payload };
    if (body.user_email) body.user_email = "[redacted]";
    writeFileSync(join(CAPTURE_DIR, `${safe}-${stamp}.json`), JSON.stringify(body, null, 2), {
      mode: 0o600,
    });
    appendFileSync(
      join(CAPTURE_DIR, "index.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        event: safe,
        tool_name: payload.tool_name ?? null,
        session_id: payload.session_id ?? payload.conversation_id ?? null,
      }) + "\n",
    );
  } catch {
    /* ignore */
  }
}

function handlePreToolUse(payload, now) {
  if (String(payload.tool_name || "") !== "Task") return;
  const input = payload.tool_input || {};
  const sessionId = payload.session_id || payload.conversation_id;
  const toolUseId = payload.tool_use_id || `task-${now}`;
  upsert(sessionId, toolUseId, {
    status: "running",
    type: typeof input.subagent_type === "string" ? input.subagent_type : "agent",
    description: truncate(input.description, 40),
    background: input.run_in_background === true || input.runInBackground === true,
    model: typeof input.model === "string" ? input.model : undefined,
    startedAt: now,
    endedAt: undefined,
  });
}

function handlePostToolUse(payload, now) {
  if (String(payload.tool_name || "") !== "Task") return;
  const sessionId = payload.session_id || payload.conversation_id;
  const toolUseId = payload.tool_use_id;
  if (!sessionId || !toolUseId) return;
  const store = loadStore();
  const bucket = store.sessions[sessionId];
  if (!bucket?.[toolUseId]) return;
  bucket[toolUseId].status = "completed";
  bucket[toolUseId].endedAt = now;
  saveStore(store);
}

function handleSubagentStart(payload, now) {
  const sessionId =
    payload.parent_conversation_id || payload.session_id || payload.conversation_id;
  const toolUseId = payload.subagent_id || payload.tool_call_id || `sub-${now}`;
  upsert(sessionId, toolUseId, {
    status: "running",
    type: typeof payload.subagent_type === "string" ? payload.subagent_type : "agent",
    description: truncate(payload.task || payload.description, 40),
    background: payload.is_parallel_worker === true,
    model: typeof payload.subagent_model === "string" ? payload.subagent_model : undefined,
    startedAt: now,
  });
}

function handleSubagentStop(payload, now) {
  const sessionId =
    payload.parent_conversation_id || payload.session_id || payload.conversation_id;
  if (!sessionId) return;
  const store = loadStore();
  const bucket = store.sessions[sessionId] || (store.sessions[sessionId] = {});
  // Prefer explicit id; else match by description among running.
  const id = payload.subagent_id || payload.tool_call_id;
  if (id && bucket[id]) {
    bucket[id].status = "completed";
    bucket[id].endedAt = now;
    saveStore(store);
    return;
  }
  const want = truncate(payload.task || payload.description, 40).toLowerCase();
  for (const [k, rec] of Object.entries(bucket)) {
    if (rec.status !== "running") continue;
    if (want && String(rec.description || "").toLowerCase() === want) {
      bucket[k].status = "completed";
      bucket[k].endedAt = now;
      saveStore(store);
      return;
    }
  }
}

async function main() {
  const raw = await readStdin();
  let payload = null;
  try {
    payload = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  const event =
    (payload && typeof payload.hook_event_name === "string" && payload.hook_event_name) ||
    EVENT;
  const now = Date.now();

  if (!DISABLED && payload) {
    try {
      maybeCapture(event, payload);
      if (event === "preToolUse") handlePreToolUse(payload, now);
      else if (event === "postToolUse") handlePostToolUse(payload, now);
      else if (event === "subagentStart") handleSubagentStart(payload, now);
      else if (event === "subagentStop") handleSubagentStop(payload, now);
    } catch {
      /* fail-open */
    }
  }

  respond(event);
}

main().catch(() => {
  try {
    respond(EVENT);
  } catch {
    process.stdout.write("{}");
  }
  process.exit(0);
});
