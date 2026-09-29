#!/usr/bin/env node
import { readStdin } from "./stdin.js";
import { getGitStatus } from "./git.js";
import { loadConfig } from "./config.js";
import { render, renderEmpty } from "./render/index.js";
import { maybeCapture } from "./capture.js";
import { getPlanUsage } from "./plan-usage.js";
import { loadTranscript } from "./transcript/index.js";
import { attachAgentTimers } from "./agent-timers.js";
import { mergeAgentsWithHooks } from "./agent-hooks.js";

export async function main(): Promise<void> {
  if (process.env.CURSOR_HUD_DISABLE?.trim()) {
    process.exit(0);
  }

  const cfg = loadConfig();
  const payload = await readStdin();

  if (!payload) {
    process.stdout.write(renderEmpty());
    return;
  }

  await maybeCapture(
    payload,
    cfg.captureDir,
    cfg.captureEnabled && !process.env.CURSOR_HUD_NO_CAPTURE?.trim(),
    cfg.captureMinIntervalMs,
  );

  const cwd = payload.workspace?.current_dir || payload.cwd;
  const wantTranscript = cfg.showTools || cfg.showAgents || cfg.showTodos;

  const [git, plan, transcript] = await Promise.all([
    getGitStatus(cwd),
    cfg.showPlanUsage
      ? getPlanUsage({
          ttlMs: cfg.planUsageTtlMs,
          timeoutMs: cfg.planUsageTimeoutMs,
        })
      : Promise.resolve(null),
    wantTranscript ? loadTranscript(payload.transcript_path) : Promise.resolve(null),
  ]);

  if (transcript && cfg.showAgents) {
    const hooksOn =
      cfg.hooksAgentsEnabled && process.env.CURSOR_HUD_HOOKS?.trim() !== "0";
    if (hooksOn) {
      mergeAgentsWithHooks(transcript, payload.session_id);
    }
    if (transcript.agents.length > 0) {
      attachAgentTimers(transcript.agents, payload.session_id);
    }
  }

  process.stdout.write(render(payload, git, cfg, plan, transcript));
  // No trailing newline: Cursor splits stdout on \n and an empty last
  // segment becomes a blank footer row that wastes vertical space.
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("index.js") ||
    process.argv[1].endsWith("cursor-hud") ||
    process.argv[1].includes("cursor-hud"));

if (isDirect) {
  main().catch(() => {
    process.exit(0);
  });
}
