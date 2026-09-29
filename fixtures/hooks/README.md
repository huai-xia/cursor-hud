# Hook capture fixtures (P3.0) — 实机 CLI 样本 2026-09-29

Collected with `agent -p` + `npm run setup:hooks-probe` on Cursor CLI `2026.09.28-64d2043`.

## Files

| File | Source |
|:---|:---|
| `preToolUse-Task-fg.json` | Task, `run_in_background: false` |
| `preToolUse-Task-bg.json` | Task, `run_in_background: true` |
| `sessionStart.json` | CLI session start |
| `beforeShellExecution.json` | Shell gate (hooks pipeline works) |
| `postToolUse-Shell.json` | Shell completion (postToolUse works for non-Task) |
| `stop.json` | Parent turn stop |

Synthetic smoke-test files under `~/.cursor/cursor-hud/hooks-capture/` named `*-2026-09-29T13-28-*` are **not** real Cursor events.

## Findings (CLI)

1. **`subagentStart` / `subagentStop` did not fire** for real Task (fg or bg), despite Task completing successfully.
2. **`preToolUse` fires for `tool_name: "Task"`** and includes `tool_input.run_in_background`, `tool_use_id`, `session_id`.
3. **`postToolUse` does not fire for Task** (observed for Shell / Read / Grep only).
4. Desktop Agent Chat Task in this IDE window also produced **no** hook captures (user hooks may not attach the same way, or need reload).
5. Background subagent tool traffic can appear under a **different** `conversation_id` (subagent id) without a matching `sessionStart`/`stop` in our captures.

## P3 implication → **option A shipped (2026-09-29)**

- **running**: `preToolUse` where `tool_name === "Task"` → `agent-hooks.json` → HUD merge
- **completed**: transcript heuristic only (hooks never force completed)
- Install: `npm run setup:hooks`
