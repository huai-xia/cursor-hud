import type { GitStatus, HudConfig, StatusLinePayload } from "../types.js";
import type { PlanUsage } from "../plan-usage.js";
import type { TranscriptData } from "../transcript/types.js";
import {
  barPainter,
  blue,
  colorPainter,
  cyan,
  dim,
  drawBar,
  magenta,
  yellow,
} from "./colors.js";
import { renderAgentsLine, renderTodosLine, renderToolsLine } from "./activity.js";

function projectLabel(cwd: string | undefined, levels: number | "full"): string {
  if (!cwd) return "?";
  if (levels === "full") return cwd;
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return cwd;
  const n = typeof levels === "number" ? Math.max(1, levels) : 1;
  return parts.slice(-n).join("/");
}

function contextPaint(pct: number, cfg: HudConfig) {
  // Context bar only: 蓝 → 青 → 黄 → 品红 (classic ANSI)
  return barPainter(pct, cfg.colors.context, cfg.thresholds, {
    ok: blue,
    mid: cyan,
    high: yellow,
    warn: magenta,
    crit: magenta,
  });
}

function contextPct(payload: StatusLinePayload): number | null {
  const pctRaw = payload.context_window?.used_percentage;
  if (pctRaw == null || Number.isNaN(Number(pctRaw))) return null;
  return Number(pctRaw);
}

function modelBadge(payload: StatusLinePayload, cfg: HudConfig): string {
  const name = payload.model?.display_name || payload.model?.id || "?";
  const param = payload.model?.param_summary?.trim();
  const max = payload.model?.max_mode ? " max" : "";
  const extra = param ? ` ${param}` : "";
  const paint = colorPainter(cfg.colors.model, cyan);
  return paint(`[${name}${extra}${max}]`);
}

function gitSegment(git: GitStatus | null, cfg: HudConfig): string {
  if (!cfg.showGit || !git) return "";
  const dirty = cfg.showDirty && git.dirty ? "*" : "";
  let ab = "";
  if (git.ahead > 0) ab += `↑${git.ahead}`;
  if (git.behind > 0) ab += `↓${git.behind}`;
  const paint = colorPainter(cfg.colors.git, blue);
  return ` ${paint("git:(")}${paint(git.branch + dirty)}${ab ? paint(ab) : ""}${paint(")")}`;
}

function worktreeSegment(payload: StatusLinePayload): string {
  const name = payload.worktree?.name;
  if (!name) return "";
  return ` ${dim(`wt:${name}`)}`;
}

function pctSegment(
  label: string,
  pct: number | null,
  width: number,
  cfg: HudConfig,
  which: "planAuto" | "planApi",
): string | null {
  if (pct == null || Number.isNaN(pct)) return null;
  const defaults =
    which === "planAuto"
      ? { ok: yellow, warn: yellow, crit: yellow }
      : { ok: magenta, warn: magenta, crit: magenta };
  const colors = which === "planAuto" ? cfg.colors.planAuto : cfg.colors.planApi;
  const paint = barPainter(pct, colors, cfg.thresholds, defaults);
  const bar = paint(drawBar(pct, width));
  return `${dim(label)} ${bar} ${paint(`${Math.floor(pct)}%`)}`;
}

function contextLine(payload: StatusLinePayload, cfg: HudConfig): string | null {
  if (!cfg.showContextBar) return null;
  const pct = contextPct(payload);
  if (pct == null) {
    return `${dim("Context")} ${dim("░".repeat(cfg.contextBarWidth))} ${dim("--%")}`;
  }
  const paint = contextPaint(pct, cfg);
  // No gradient for Context — classic ANSI threshold colors only.
  const bar = paint(drawBar(pct, cfg.contextBarWidth));
  const label = paint(`${Math.floor(pct)}%`);

  const size = payload.context_window?.context_window_size;
  const tokens =
    size && payload.context_window?.total_input_tokens != null
      ? dim(
          ` ${Math.round(Number(payload.context_window.total_input_tokens) / 1000)}k/${Math.round(Number(size) / 1000)}k`,
        )
      : "";

  return `${dim("Context")} ${bar} ${label}${tokens}`;
}

function planLine(plan: PlanUsage | null, cfg: HudConfig): string | null {
  if (!cfg.showPlanUsage || !plan) return null;
  const width = Math.max(6, Math.min(cfg.contextBarWidth, 10));
  const parts: string[] = [];
  const auto = pctSegment("auto", plan.autoPercentUsed, width, cfg, "planAuto");
  const api = pctSegment("api", plan.apiPercentUsed, width, cfg, "planApi");
  if (auto) parts.push(auto);
  if (api) parts.push(api);
  if (parts.length === 0) return null;
  return `${dim("Plan")} ${parts.join(` ${dim("·")} `)}`;
}

export function render(
  payload: StatusLinePayload,
  git: GitStatus | null,
  cfg: HudConfig,
  plan: PlanUsage | null = null,
  transcript: TranscriptData | null = null,
): string {
  const cwd = payload.workspace?.current_dir || payload.cwd;
  const project = projectLabel(cwd, cfg.pathLevels);
  // Path is fixed yellow (no longer tracks Context bar color).
  const pathPaint = colorPainter(cfg.colors.path, yellow);

  const line1Parts: string[] = [];
  if (cfg.showModel) line1Parts.push(modelBadge(payload, cfg));
  line1Parts.push(
    `${dim("│")} ${pathPaint(project)}${gitSegment(git, cfg)}${worktreeSegment(payload)}`,
  );

  const lines = [line1Parts.join(" ")];

  const ctx = contextLine(payload, cfg);
  const planSeg = planLine(plan, cfg);
  const compact = cfg.lineLayout === "compact";

  // Always keep metrics on their own row. Putting bars on line 1 wraps badly
  // in narrow Cursor footers and garbles the model/path/branch segment.
  if (ctx && planSeg) {
    lines.push(`${ctx} ${dim("│")} ${planSeg}`);
  } else if (ctx) {
    lines.push(ctx);
  } else if (planSeg) {
    lines.push(planSeg);
  }

  if (transcript) {
    const pathRoots = [
      cwd,
      payload.workspace?.project_dir,
    ].filter((x): x is string => typeof x === "string" && x.length > 0);

    const tools = cfg.showTools
      ? renderToolsLine(transcript, {
          toolNameMaxLength: cfg.toolNameMaxLength,
          toolsMaxVisible: cfg.toolsMaxVisible,
          showCompletedTools: cfg.showCompletedTools,
          pathRoots,
        })
      : null;
    const width =
      typeof payload.render_width_chars === "number"
        ? payload.render_width_chars
        : undefined;
    const agents = cfg.showAgents
      ? renderAgentsLine(transcript, { width })
      : null;
    const todos = cfg.showTodos ? renderTodosLine(transcript) : null;

    if (compact) {
      // Tools + todos can share one row; each agent always gets its own line.
      const activityParts: string[] = [];
      if (tools) activityParts.push(tools);
      if (todos) activityParts.push(todos);
      if (activityParts.length) lines.push(activityParts.join(` ${dim("│")} `));
      if (agents) {
        for (const row of agents.split("\n")) {
          if (row) lines.push(row);
        }
      }
    } else {
      if (tools) lines.push(tools);
      if (agents) {
        for (const row of agents.split("\n")) {
          if (row) lines.push(row);
        }
      }
      if (todos) lines.push(todos);
    }
  }

  if (payload.autorun === true) {
    lines[0] += ` ${cyan("auto")}`;
  }

  return lines.join("\n");
}

/** Fallback when stdin is missing (manual CLI invoke). */
export function renderEmpty(): string {
  return `${dim("cursor-hud")} ${dim("— waiting for Cursor statusLine stdin")}`;
}
