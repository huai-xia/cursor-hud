import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAccessToken } from "./auth.js";

const USAGE_URL =
  "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

export interface PlanUsage {
  autoPercentUsed: number | null;
  apiPercentUsed: number | null;
  totalPercentUsed: number | null;
  fetchedAt: number;
  source: "cache" | "network" | "none";
}

interface CachedEnvelope {
  fetchedAt: number;
  planUsage?: {
    autoPercentUsed?: number;
    apiPercentUsed?: number;
    totalPercentUsed?: number;
  };
}

function cachePath(): string {
  return (
    process.env.CURSOR_HUD_USAGE_CACHE?.trim() ||
    join(homedir(), ".cursor", "cursor-hud", "cache", "plan-usage.json")
  );
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parsePlanUsage(raw: unknown, fetchedAt: number, source: PlanUsage["source"]): PlanUsage {
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pu = (root.planUsage && typeof root.planUsage === "object"
    ? root.planUsage
    : root) as Record<string, unknown>;

  return {
    autoPercentUsed: toNum(pu.autoPercentUsed),
    apiPercentUsed: toNum(pu.apiPercentUsed),
    totalPercentUsed: toNum(pu.totalPercentUsed),
    fetchedAt,
    source,
  };
}

function readCache(ttlMs: number): PlanUsage | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const st = statSync(path);
    const age = Date.now() - st.mtimeMs;
    if (age > ttlMs) return null;
    const data = JSON.parse(readFileSync(path, "utf8")) as CachedEnvelope | Record<string, unknown>;
    const fetchedAt =
      typeof (data as CachedEnvelope).fetchedAt === "number"
        ? (data as CachedEnvelope).fetchedAt
        : st.mtimeMs;
    return parsePlanUsage(data, fetchedAt, "cache");
  } catch {
    return null;
  }
}

function writeCache(raw: unknown): void {
  try {
    const path = cachePath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const envelope = {
      fetchedAt: Date.now(),
      ...(typeof raw === "object" && raw ? raw : {}),
    };
    writeFileSync(path, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 });
  } catch {
    /* ignore */
  }
}

async function fetchUsage(timeoutMs: number): Promise<unknown | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(USAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: "{}",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get first-party (auto) / third-party (api) plan usage percentages.
 * Uses a short disk cache so statusLine refreshes stay under timeoutMs.
 */
export async function getPlanUsage(options?: {
  ttlMs?: number;
  timeoutMs?: number;
}): Promise<PlanUsage> {
  const ttlMs = options?.ttlMs ?? 60_000;
  const timeoutMs = options?.timeoutMs ?? 1200;

  const cached = readCache(ttlMs);
  if (cached && (cached.autoPercentUsed != null || cached.apiPercentUsed != null)) {
    return cached;
  }

  const raw = await fetchUsage(timeoutMs);
  if (raw) {
    writeCache(raw);
    return parsePlanUsage(raw, Date.now(), "network");
  }

  // Stale cache fallback (ignore TTL)
  const path = cachePath();
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      const st = statSync(path);
      return parsePlanUsage(data, st.mtimeMs, "cache");
    } catch {
      /* fall through */
    }
  }

  return {
    autoPercentUsed: null,
    apiPercentUsed: null,
    totalPercentUsed: null,
    fetchedAt: 0,
    source: "none",
  };
}
