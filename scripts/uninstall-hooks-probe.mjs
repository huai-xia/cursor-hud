#!/usr/bin/env node
/**
 * Remove cursor-hud P3.0 capture entries from ~/.cursor/hooks.json.
 * Leaves other hooks and the capture files on disk (manual delete if wanted).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CURSOR_DIR = join(homedir(), ".cursor");
const HOOKS_JSON = join(CURSOR_DIR, "hooks.json");
const HUD_DIR = join(CURSOR_DIR, "cursor-hud");
const MARKER = "cursor-hud-capture.sh";

if (!existsSync(HOOKS_JSON)) {
  console.log("No ~/.cursor/hooks.json — nothing to remove.");
  process.exit(0);
}

mkdirSync(HUD_DIR, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
copyFileSync(HOOKS_JSON, join(HUD_DIR, `hooks.json.backup-uninstall-${stamp}.json`));

const config = JSON.parse(readFileSync(HOOKS_JSON, "utf8"));
if (!config.hooks || typeof config.hooks !== "object") {
  console.log("hooks.json has no hooks object.");
  process.exit(0);
}

let removed = 0;
for (const [name, list] of Object.entries(config.hooks)) {
  if (!Array.isArray(list)) continue;
  const next = list.filter((e) => {
    const cmd = String(e?.command ?? "");
    if (cmd.includes(MARKER)) {
      removed += 1;
      return false;
    }
    return true;
  });
  if (next.length === 0) delete config.hooks[name];
  else config.hooks[name] = next;
}

writeFileSync(HOOKS_JSON, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(`Removed ${removed} cursor-hud capture hook entr(y/ies).`);
console.log(`Backup: ${join(HUD_DIR, `hooks.json.backup-uninstall-${stamp}.json`)}`);
