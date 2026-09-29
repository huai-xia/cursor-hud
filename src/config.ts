import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BarColorConfig, HudConfig, HudColorsConfig, ThresholdConfig } from "./types.js";

export const DEFAULT_CONFIG: HudConfig = {
  pathLevels: 1,
  lineLayout: "compact",
  showModel: true,
  showGit: true,
  showDirty: true,
  showContextBar: true,
  contextBarWidth: 10,
  showPlanUsage: true,
  planUsageTtlMs: 60_000,
  planUsageTimeoutMs: 1200,
  showTools: true,
  showCompletedTools: false,
  showAgents: true,
  showTodos: true,
  /** Merge preToolUse(Task) side-channel into agent running state (P3 A). */
  hooksAgentsEnabled: true,
  toolNameMaxLength: 0,
  toolsMaxVisible: 4,
  captureEnabled: true,
  captureMinIntervalMs: 60_000,
  captureDir: join(homedir(), ".cursor", "cursor-hud", "capture"),
  colors: {
    // Fixed segments (classic ANSI)
    model: "cyan",
    path: "yellow",
    git: "blue",
    // Context bar: 蓝 → 青 → 黄 → 品红
    context: {
      ok: "blue",
      mid: "cyan",
      high: "yellow",
      warn: "magenta",
      crit: "magenta",
    },
    // Plan auto: yellow
    planAuto: { ok: "yellow", warn: "yellow", crit: "yellow" },
    // Plan api: magenta
    planApi: { ok: "magenta", warn: "magenta", crit: "magenta" },
  },
  thresholds: {
    mid: 25,
    high: 50,
    warn: 75,
    crit: 75,
  },
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function mergeBarColors(
  base: BarColorConfig | undefined,
  over: unknown,
): BarColorConfig | undefined {
  const o = asRecord(over);
  if (!o && !base) return undefined;
  const out: BarColorConfig = { ...(base || {}) };
  for (const key of ["fixed", "ok", "mid", "high", "warn", "crit"] as const) {
    if (typeof o?.[key] === "string") out[key] = o[key] as string;
  }
  if (Array.isArray(o?.gradient)) {
    const stops = o.gradient.filter((x): x is string => typeof x === "string" && x.trim() !== "");
    if (stops.length >= 2) out.gradient = stops;
  }
  return out;
}

function mergeColors(base: HudColorsConfig, over: unknown): HudColorsConfig {
  const o = asRecord(over) || {};
  const pickFixed = (key: "model" | "path" | "git") =>
    typeof o[key] === "string" && (o[key] as string).trim()
      ? (o[key] as string).trim()
      : base[key];
  return {
    model: pickFixed("model"),
    path: pickFixed("path"),
    git: pickFixed("git"),
    context: mergeBarColors(base.context, o.context),
    planAuto: mergeBarColors(base.planAuto, o.planAuto),
    planApi: mergeBarColors(base.planApi, o.planApi),
  };
}

function mergeThresholds(base: ThresholdConfig, over: unknown): ThresholdConfig {
  const o = asRecord(over) || {};
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return {
    mid: clamp(typeof o.mid === "number" ? o.mid : base.mid),
    high: clamp(typeof o.high === "number" ? o.high : base.high),
    warn: clamp(typeof o.warn === "number" ? o.warn : base.warn),
    crit: clamp(typeof o.crit === "number" ? o.crit : base.crit),
  };
}

function pickBool(over: unknown, key: string, fallback: boolean): boolean {
  const o = asRecord(over);
  return typeof o?.[key] === "boolean" ? (o[key] as boolean) : fallback;
}

function pickNumber(over: unknown, key: string, fallback: number): number {
  const o = asRecord(over);
  return typeof o?.[key] === "number" && Number.isFinite(o[key] as number)
    ? (o[key] as number)
    : fallback;
}

export function configPath(): string {
  return (
    process.env.CURSOR_HUD_CONFIG?.trim() ||
    join(homedir(), ".cursor", "cursor-hud", "config.json")
  );
}

/** Deep-ish merge of user config over defaults. Unknown keys ignored. */
export function mergeConfig(over: unknown): HudConfig {
  const o = asRecord(over) || {};
  const base = DEFAULT_CONFIG;

  let pathLevels: HudConfig["pathLevels"] = base.pathLevels;
  if (o.pathLevels === "full") pathLevels = "full";
  else if (typeof o.pathLevels === "number" && o.pathLevels >= 1) {
    pathLevels = Math.floor(o.pathLevels);
  }

  return {
    pathLevels,
    lineLayout:
      o.lineLayout === "expanded" || o.lineLayout === "compact"
        ? o.lineLayout
        : base.lineLayout,
    showModel: pickBool(o, "showModel", base.showModel),
    showGit: pickBool(o, "showGit", base.showGit),
    showDirty: pickBool(o, "showDirty", base.showDirty),
    showContextBar: pickBool(o, "showContextBar", base.showContextBar),
    contextBarWidth: Math.max(4, pickNumber(o, "contextBarWidth", base.contextBarWidth)),
    showPlanUsage: pickBool(o, "showPlanUsage", base.showPlanUsage),
    planUsageTtlMs: pickNumber(o, "planUsageTtlMs", base.planUsageTtlMs),
    planUsageTimeoutMs: pickNumber(o, "planUsageTimeoutMs", base.planUsageTimeoutMs),
    showTools: pickBool(o, "showTools", base.showTools),
    showCompletedTools: pickBool(o, "showCompletedTools", base.showCompletedTools),
    showAgents: pickBool(o, "showAgents", base.showAgents),
    showTodos: pickBool(o, "showTodos", base.showTodos),
    hooksAgentsEnabled: pickBool(o, "hooksAgentsEnabled", base.hooksAgentsEnabled),
    toolNameMaxLength: pickNumber(o, "toolNameMaxLength", base.toolNameMaxLength),
    toolsMaxVisible: pickNumber(o, "toolsMaxVisible", base.toolsMaxVisible),
    captureEnabled: pickBool(o, "captureEnabled", base.captureEnabled),
    captureMinIntervalMs: pickNumber(o, "captureMinIntervalMs", base.captureMinIntervalMs),
    captureDir: typeof o.captureDir === "string" ? o.captureDir : base.captureDir,
    colors: mergeColors(base.colors, o.colors),
    thresholds: mergeThresholds(base.thresholds, o.thresholds),
  };
}

export function loadConfig(): HudConfig {
  const path = configPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG, colors: { ...DEFAULT_CONFIG.colors } };

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return mergeConfig(raw);
  } catch {
    return { ...DEFAULT_CONFIG, colors: { ...DEFAULT_CONFIG.colors } };
  }
}
