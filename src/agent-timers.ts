import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentEntry } from "./transcript/types.js";

interface AgentTimer {
  startedAt: number;
  endedAt?: number;
}

interface TimerFile {
  /** session_id → agentId → timer */
  sessions: Record<string, Record<string, AgentTimer>>;
}

const DEFAULT_PATH = join(homedir(), ".cursor", "cursor-hud", "agent-timers.json");

function load(path: string): TimerFile {
  try {
    if (!existsSync(path)) return { sessions: {} };
    const raw = JSON.parse(readFileSync(path, "utf8")) as TimerFile;
    return raw?.sessions ? raw : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

function save(path: string, data: TimerFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data), "utf8");
  } catch {
    /* best-effort */
  }
}

/**
 * Stamp startedAt / endedAt onto agents using a small on-disk cache.
 * Transcripts have no timestamps, so duration is wall-clock from first sighting.
 */
export function attachAgentTimers(
  agents: AgentEntry[],
  sessionId: string | undefined,
  options?: { path?: string; now?: number },
): void {
  if (agents.length === 0) return;
  const path = options?.path ?? DEFAULT_PATH;
  const now = options?.now ?? Date.now();
  const sid = sessionId?.trim() || "default";
  const store = load(path);
  const bucket = store.sessions[sid] || (store.sessions[sid] = {});
  const seen = new Set<string>();

  for (const agent of agents) {
    seen.add(agent.id);
    let t = bucket[agent.id];
    if (!t) {
      t = { startedAt: now };
      bucket[agent.id] = t;
    }
    if (agent.status === "running") {
      // Re-opened / still going — clear stale end mark.
      if (t.endedAt != null) delete t.endedAt;
    } else if (t.endedAt == null) {
      t.endedAt = now;
    }
    agent.startedAtMs = t.startedAt;
    agent.endedAtMs = t.endedAt;
  }

  // Drop timers for agents no longer present in this transcript parse.
  for (const id of Object.keys(bucket)) {
    if (!seen.has(id)) delete bucket[id];
  }

  // Bound session map growth.
  const sessionIds = Object.keys(store.sessions);
  if (sessionIds.length > 40) {
    for (const old of sessionIds.slice(0, sessionIds.length - 40)) {
      delete store.sessions[old];
    }
  }

  save(path, store);
}

export function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${String(rm).padStart(2, "0")}m`;
}

export function agentElapsedMs(agent: AgentEntry, now = Date.now()): number | null {
  if (agent.startedAtMs == null) return null;
  const end = agent.status === "running" ? now : (agent.endedAtMs ?? now);
  return Math.max(0, end - agent.startedAtMs);
}
