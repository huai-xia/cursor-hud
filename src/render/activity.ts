import type { TranscriptData, AgentEntry } from "../transcript/types.js";
import { agentElapsedMs, formatElapsed } from "../agent-timers.js";
import { cyan, dim, green, yellow } from "./colors.js";
import { formatToolTarget } from "./paths.js";

function shorten(name: string, maxLen: number): string {
  if (maxLen <= 0 || name.length <= maxLen) return name;
  return `${name.slice(0, Math.max(0, maxLen - 1))}…`;
}

/** Visible width ignoring ANSI SGR sequences. */
export function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padRightAlign(left: string, right: string, width: number | undefined): string {
  if (!right) return left;
  if (width == null || width <= 0) return `${left}  ${right}`;
  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap <= 1) return `${left} ${right}`;
  return `${left}${" ".repeat(gap)}${right}`;
}

export function renderToolsLine(
  transcript: TranscriptData,
  options?: {
    toolNameMaxLength?: number;
    toolsMaxVisible?: number;
    showCompletedTools?: boolean;
    /** Workspace roots for relativizing paths (cwd, project_dir). */
    pathRoots?: string[];
    /** Max visible length of the target after relativizing. */
    targetMaxLength?: number;
  },
): string | null {
  const tools = transcript.tools;
  if (tools.length === 0) return null;

  const maxLen = options?.toolNameMaxLength ?? 0;
  const maxVisible = options?.toolsMaxVisible ?? 4;
  const showCompleted = options?.showCompletedTools !== false;
  const roots = options?.pathRoots ?? [];
  const targetMax = options?.targetMaxLength ?? 40;
  const parts: string[] = [];

  const running = tools.filter((t) => t.status === "running");
  for (const tool of running.slice(-2)) {
    const name = shorten(tool.name, maxLen);
    const targetRaw = formatToolTarget(tool.target, roots, targetMax);
    const target = targetRaw ? dim(`: ${targetRaw}`) : "";
    parts.push(`${yellow("◐")} ${cyan(name)}${target}`);
  }

  if (showCompleted) {
    const completed = tools.filter((t) => t.status === "completed" || t.status === "error");
    const counts = new Map<string, number>();
    for (const tool of completed) {
      counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const visible = maxVisible === 0 ? sorted : sorted.slice(0, maxVisible);
    for (const [name, count] of visible) {
      parts.push(`${green("✓")} ${shorten(name, maxLen)} ${dim(`×${count}`)}`);
    }
    const hidden = maxVisible === 0 ? 0 : sorted.length - visible.length;
    if (hidden > 0) parts.push(dim(`+${hidden} more`));
  }

  return parts.length ? parts.join(" | ") : null;
}

const RECENT_DONE_MS = 3 * 60_000;

function agentsToShow(agents: AgentEntry[], now: number): AgentEntry[] {
  const running = agents.filter((a) => a.status === "running");
  const recentDone = agents.filter(
    (a) =>
      a.status === "completed" &&
      a.endedAtMs != null &&
      now - a.endedAtMs <= RECENT_DONE_MS,
  );
  // Preserve transcript order; prefer running + recently finished.
  const want = new Set([...running, ...recentDone].map((a) => a.id));
  // If nothing running and nothing recent, fall back to last completed agent.
  if (want.size === 0) {
    const lastDone = [...agents].reverse().find((a) => a.status === "completed");
    return lastDone ? [lastDone] : [];
  }
  return agents.filter((a) => want.has(a.id));
}

function agentLeftLabel(agent: AgentEntry, index: number, numbered: boolean): string {
  const mark = agent.status === "running" ? yellow("◐") : green("✓");
  const num = numbered ? `${dim(`#${index}`)} ` : "";
  const bg = agent.background ? dim(" bg") : "";
  const model = agent.model && agent.model !== "inherit" ? dim(` [${agent.model}]`) : "";
  const desc = agent.description ? dim(`: ${agent.description}`) : "";
  return `${mark} ${num}${cyan(agent.type)}${model}${bg}${desc}`;
}

export function renderAgentsLine(
  transcript: TranscriptData,
  options?: {
    width?: number;
    now?: number;
  },
): string | null {
  const agents = transcript.agents;
  if (agents.length === 0) return null;

  const now = options?.now ?? Date.now();
  const toShow = agentsToShow(agents, now);
  if (toShow.length === 0) return null;

  const numbered = toShow.length >= 2;
  const width = options?.width;

  return toShow
    .map((agent, i) => {
      const left = agentLeftLabel(agent, i + 1, numbered);
      const elapsed = agentElapsedMs(agent, now);
      const right =
        elapsed == null ? "" : dim(formatElapsed(elapsed));
      return padRightAlign(left, right, width);
    })
    .join("\n");
}

export function renderTodosLine(transcript: TranscriptData): string | null {
  const todos = transcript.todos;
  if (todos.length === 0) return null;

  const done = todos.filter((t) => t.status === "completed").length;
  const active =
    todos.find((t) => t.status === "in_progress") ||
    todos.find((t) => t.status === "pending");
  // Hide when everything is done — saves a footer row when idle.
  if (!active && done === todos.length) return null;
  const label = active ? truncateTodo(active.content) : "todos";
  return `${dim("▸")} ${label} ${dim(`(${done}/${todos.length})`)}`;
}

function truncateTodo(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= 42 ? t : `${t.slice(0, 41)}…`;
}
