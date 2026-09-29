/**
 * Cursor CLI StatusLinePayload (aligned with Claude Code statusline stdin).
 * See: ~/.cursor/skills-cursor/statusline/SKILL.md
 */
export interface StatusLinePayload {
  session_id?: string;
  session_name?: string;
  transcript_path?: string;
  render_width_chars?: number;
  cwd?: string;
  autorun?: boolean;
  model?: {
    id?: string;
    display_name?: string;
    param_summary?: string;
    max_mode?: boolean;
  };
  workspace?: {
    current_dir?: string;
    project_dir?: string;
    added_dirs?: string[];
  };
  version?: string;
  output_style?: { name?: string };
  context_window?: {
    total_input_tokens?: number | null;
    total_output_tokens?: number | null;
    context_window_size?: number | null;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_tokens?: number;
      cache_write_tokens?: number;
    } | null;
  };
  vim?: { mode?: string };
  worktree?: { name?: string; path?: string };
  // Unknown / future Cursor fields — keep passthrough for capture analysis
  [key: string]: unknown;
}

export interface GitStatus {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export interface BarColorConfig {
  /** Always use this color (ignores thresholds / gradient). */
  fixed?: string;
  /** Lowest band */
  ok?: string;
  /** After thresholds.mid */
  mid?: string;
  /** After thresholds.high */
  high?: string;
  /** After thresholds.warn */
  warn?: string;
  /** After thresholds.crit */
  crit?: string;
  /** Optional truecolor gradient (off by default). */
  gradient?: string[];
}

export interface HudColorsConfig {
  /** Fixed ANSI/hex for the model badge. */
  model?: string;
  /** Fixed ANSI/hex for the project path segment. */
  path?: string;
  /** Fixed ANSI/hex for git branch. */
  git?: string;
  context?: BarColorConfig;
  planAuto?: BarColorConfig;
  planApi?: BarColorConfig;
}

export interface ThresholdConfig {
  mid: number;
  high: number;
  warn: number;
  crit: number;
}

export interface HudConfig {
  pathLevels: number | "full";
  /** expanded = separate activity rows; compact = fold activity into one extra row.
   *  Both layouts keep: line1 = model/path/git, line2 = context + plan bars. */
  lineLayout: "expanded" | "compact";
  showModel: boolean;
  showGit: boolean;
  showDirty: boolean;
  showContextBar: boolean;
  contextBarWidth: number;
  showPlanUsage: boolean;
  planUsageTtlMs: number;
  planUsageTimeoutMs: number;
  showTools: boolean;
  /** When false, hide the tools line if nothing is currently running. */
  showCompletedTools: boolean;
  showAgents: boolean;
  showTodos: boolean;
  /** When true, merge ~/.cursor/cursor-hud/agent-hooks.json running marks into agents. */
  hooksAgentsEnabled: boolean;
  toolNameMaxLength: number;
  toolsMaxVisible: number;
  captureEnabled: boolean;
  /** Only write a new capture file at most this often (ms). Meta/latest still update. */
  captureMinIntervalMs: number;
  captureDir: string;
  /** Progress-bar colors (context / plan auto / plan api). */
  colors: HudColorsConfig;
  /** Shared warn/crit thresholds for percentage bars (0–100). */
  thresholds: ThresholdConfig;
}
