/**
 * Side-channel agent status from Cursor hooks (P3 / option A).
 * Running comes from preToolUse(Task). Completed stays transcript-heuristic.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentEntry, TranscriptData } from "./transcript/types.js";

export interface HookAgentRecord {
  status: "running" | "completed";
  type: string;
  description?: string;
  background: boolean;
  model?: string;
  startedAt: number;
  endedAt?: number;
  toolUseId: string;
}

export interface AgentHooksFile {
  /** session_id → tool_use_id → record */
  sessions: Record<string, Record<string, HookAgentRecord>>;
}

const DEFAULT_PATH = join(homedir(), ".cursor", "cursor-hud", "agent-hooks.json");
const MAX_SESSIONS = 40;
const MAX_PER_SESSION = 30;
/** Drop running marks older than this (orphan if Task never hits transcript). */
const STALE_RUNNING_MS = 2 * 60 * 60_000;

export function agentHooksPath(): string {
  return process.env.CURSOR_HUD_AGENT_HOOKS?.trim() || DEFAULT_PATH;
}

function load(path: string): AgentHooksFile {
  try {
    if (!existsSync(path)) return { sessions: {} };
    const raw = JSON.parse(readFileSync(path, "utf8")) as AgentHooksFile;
    return raw?.sessions ? raw : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

function save(path: string, data: AgentHooksFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

function normDesc(s: string | undefined): string {
  return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function matchScore(agent: AgentEntry, hook: HookAgentRecord): number {
  let score = 0;
  if (hook.type && agent.type && hook.type === agent.type) score += 2;
  const hd = normDesc(hook.description);
  const ad = normDesc(agent.description);
  if (hd && ad && hd === ad) score += 4;
  else if (hd && ad && (hd.includes(ad) || ad.includes(hd))) score += 2;
  if (hook.background === agent.background) score += 1;
  return score;
}

/**
 * Apply hook side-channel onto transcript agents (option A):
 * - hooks may force / inject **running**
 * - never force **completed** from hooks (transcript wins)
 * - if transcript already completed a match, drop that hook running mark from the
 *   in-memory view (and prune file when `prune` is true)
 */
export function mergeAgentsWithHooks(
  transcript: TranscriptData,
  sessionId: string | undefined,
  options?: { path?: string; now?: number; prune?: boolean },
): void {
  const path = options?.path ?? agentHooksPath();
  const now = options?.now ?? Date.now();
  const sid = sessionId?.trim();
  if (!sid) return;

  const store = load(path);
  const bucket = store.sessions[sid];
  if (!bucket) return;

  let mutated = false;
  const hooks = Object.values(bucket).filter((h) => {
    if (h.status !== "running") return false;
    if (now - h.startedAt > STALE_RUNNING_MS) {
      delete bucket[h.toolUseId];
      mutated = true;
      return false;
    }
    return true;
  });

  const usedAgents = new Set<AgentEntry>();

  for (const hook of hooks) {
    let best: AgentEntry | null = null;
    let bestScore = 0;
    for (const agent of transcript.agents) {
      if (usedAgents.has(agent)) continue;
      const s = matchScore(agent, hook);
      if (s > bestScore) {
        bestScore = s;
        best = agent;
      }
    }

    if (best && bestScore >= 2) {
      usedAgents.add(best);
      if (best.status === "completed" || best.status === "error") {
        // Transcript completed wins — clear hook running.
        delete bucket[hook.toolUseId];
        mutated = true;
        continue;
      }
      best.status = "running";
      if (best.startedAtMs == null) best.startedAtMs = hook.startedAt;
      continue;
    }

    // No transcript row yet — inject so HUD can show early running.
    transcript.agents.push({
      id: hook.toolUseId,
      type: hook.type || "agent",
      description: hook.description,
      model: hook.model,
      status: "running",
      background: hook.background,
      startedAtMs: hook.startedAt,
    });
  }

  // Bound growth
  const ids = Object.keys(bucket);
  if (ids.length > MAX_PER_SESSION) {
    const sorted = ids
      .map((id) => ({ id, t: bucket[id].startedAt }))
      .sort((a, b) => a.t - b.t);
    for (const old of sorted.slice(0, ids.length - MAX_PER_SESSION)) {
      delete bucket[old.id];
      mutated = true;
    }
  }

  const sessionIds = Object.keys(store.sessions);
  if (sessionIds.length > MAX_SESSIONS) {
    for (const old of sessionIds.slice(0, sessionIds.length - MAX_SESSIONS)) {
      delete store.sessions[old];
      mutated = true;
    }
  }

  if (mutated && options?.prune !== false) save(path, store);
}

/** Test helper: write a store file. */
export function writeAgentHooksFile(path: string, data: AgentHooksFile): void {
  save(path, data);
}

export function readAgentHooksFile(path: string): AgentHooksFile {
  return load(path);
}
