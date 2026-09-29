#!/usr/bin/env node
/**
 * P3.0 probe: capture Cursor hook stdin JSON for subagent lifecycle.
 * Always fail-open — never block tools; never throw to the agent.
 *
 * Usage: node hooks-capture.mjs <eventName>
 *   eventName: subagentStart | subagentStop | postToolUse | …
 */
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EVENT = (process.argv[2] || "unknown").trim() || "unknown";
const HUD_DIR = join(homedir(), ".cursor", "cursor-hud");
const CAPTURE_DIR = join(HUD_DIR, "hooks-capture");
const DISABLED = Boolean(process.env.CURSOR_HUD_HOOKS?.trim() === "0");

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", () => resolve(""));
    // Hooks should be fast; don't hang forever if stdin never closes.
    setTimeout(() => resolve(chunks.join("")), 1500);
  });
}

function respond(event, raw) {
  void raw;
  if (
    event === "subagentStart" ||
    event === "beforeShellExecution" ||
    event === "preToolUse"
  ) {
    process.stdout.write(JSON.stringify({ permission: "allow" }));
    return;
  }
  // sessionStart / subagentStop / postToolUse / others
  process.stdout.write("{}");
}

function redact(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = k.toLowerCase();
    if (
      key.includes("token") ||
      key.includes("password") ||
      key.includes("secret") ||
      key.includes("authorization") ||
      key === "user_email"
    ) {
      out[k] = typeof v === "string" && v ? "[redacted]" : null;
      continue;
    }
    // Keep paths but truncate huge tool outputs / summaries
    if ((key === "summary" || key === "tool_output" || key === "content") && typeof v === "string" && v.length > 800) {
      out[k] = `${v.slice(0, 800)}…[truncated ${v.length}]`;
      continue;
    }
    out[k] = typeof v === "object" ? redact(v) : v;
  }
  return out;
}

function shouldKeepToolHook(payload) {
  const name = String(payload?.tool_name ?? payload?.toolName ?? "");
  // Keep Task only in day-to-day probe (Shell/Read flood the capture dir).
  return !name || /^task$/i.test(name);
}

async function main() {
  const raw = await readStdin();
  let payload = null;
  try {
    payload = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    payload = { _parse_error: true, _raw_preview: raw.slice(0, 400) };
  }

  const event =
    (payload && typeof payload.hook_event_name === "string" && payload.hook_event_name) ||
    EVENT;

  if (!DISABLED && payload) {
    try {
      if (
        (event === "postToolUse" || event === "preToolUse") &&
        !shouldKeepToolHook(payload)
      ) {
        respond(event, raw);
        return;
      }
      mkdirSync(CAPTURE_DIR, { recursive: true, mode: 0o700 });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeEvent = event.replace(/[^a-zA-Z0-9_-]/g, "_");
      const body = redact(payload);
      const file = join(CAPTURE_DIR, `${safeEvent}-${stamp}.json`);
      writeFileSync(file, JSON.stringify(body, null, 2), { mode: 0o600 });
      writeFileSync(join(CAPTURE_DIR, `latest-${safeEvent}.json`), JSON.stringify(body, null, 2), {
        mode: 0o600,
      });
      const meta = {
        at: new Date().toISOString(),
        event: safeEvent,
        file,
        keys: payload && typeof payload === "object" ? Object.keys(payload).sort() : [],
        subagent_id: payload?.subagent_id ?? null,
        subagent_type: payload?.subagent_type ?? null,
        status: payload?.status ?? null,
        tool_name: payload?.tool_name ?? null,
        conversation_id: payload?.conversation_id ?? payload?.session_id ?? null,
      };
      appendFileSync(join(CAPTURE_DIR, "index.jsonl"), JSON.stringify(meta) + "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      if (!existsSync(join(CAPTURE_DIR, "README.txt"))) {
        writeFileSync(
          join(CAPTURE_DIR, "README.txt"),
          "cursor-hud P3.0 hook captures. Copy interesting samples into the repo fixtures/hooks/ (already redacted).\n",
          { mode: 0o600 },
        );
      }
    } catch {
      /* capture is best-effort */
    }
  }

  respond(event, raw);
}

main().catch(() => {
  try {
    respond(EVENT, "");
  } catch {
    process.stdout.write("{}");
  }
  process.exit(0);
});
