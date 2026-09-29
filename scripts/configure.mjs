#!/usr/bin/env node
/**
 * Interactive configure for cursor-hud (P4).
 * Writes ~/.cursor/cursor-hud/config.json — preserves unknown keys & custom colors unless reset.
 *
 * Usage: npm run configure
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HUD_DIR = join(homedir(), ".cursor", "cursor-hud");
const CONFIG_PATH = process.env.CURSOR_HUD_CONFIG?.trim() || join(HUD_DIR, "config.json");

const CLASSIC_COLORS = {
  model: "cyan",
  path: "yellow",
  git: "blue",
  context: {
    ok: "blue",
    mid: "cyan",
    high: "yellow",
    warn: "magenta",
    crit: "magenta",
  },
  planAuto: { ok: "yellow", warn: "yellow", crit: "yellow" },
  planApi: { ok: "magenta", warn: "magenta", crit: "magenta" },
};

const DEFAULTS = {
  pathLevels: 1,
  lineLayout: "compact",
  showModel: true,
  showGit: true,
  showDirty: true,
  showContextBar: true,
  contextBarWidth: 10,
  showPlanUsage: true,
  showTools: true,
  showCompletedTools: false,
  showAgents: true,
  showTodos: true,
  hooksAgentsEnabled: true,
  colors: structuredClone(CLASSIC_COLORS),
  thresholds: { mid: 25, high: 50, warn: 75, crit: 75 },
};

const PRESETS = {
  full: {
    label: "Full — expanded layout, tools + completed tallies + agents + todos + plan",
    patch: {
      lineLayout: "expanded",
      showModel: true,
      showGit: true,
      showDirty: true,
      showContextBar: true,
      showPlanUsage: true,
      showTools: true,
      showCompletedTools: true,
      showAgents: true,
      showTodos: true,
      hooksAgentsEnabled: true,
    },
  },
  essential: {
    label: "Essential — compact (default-ish), hide idle completed tools",
    patch: {
      lineLayout: "compact",
      showModel: true,
      showGit: true,
      showDirty: true,
      showContextBar: true,
      showPlanUsage: true,
      showTools: true,
      showCompletedTools: false,
      showAgents: true,
      showTodos: true,
      hooksAgentsEnabled: true,
    },
  },
  minimal: {
    label: "Minimal — model + path/git + context only",
    patch: {
      lineLayout: "compact",
      showModel: true,
      showGit: true,
      showDirty: true,
      showContextBar: true,
      showPlanUsage: false,
      showTools: false,
      showCompletedTools: false,
      showAgents: false,
      showTodos: false,
      hooksAgentsEnabled: false,
    },
  },
};

const TOGGLES = [
  { key: "showModel", label: "Model badge" },
  { key: "showGit", label: "Git branch" },
  { key: "showDirty", label: "Dirty * marker" },
  { key: "showContextBar", label: "Context bar" },
  { key: "showPlanUsage", label: "Plan usage bars" },
  { key: "showTools", label: "Tools activity" },
  { key: "showCompletedTools", label: "Completed tool tallies when idle" },
  { key: "showAgents", label: "Subagent lines" },
  { key: "showTodos", label: "Todo progress" },
  { key: "hooksAgentsEnabled", label: "Hooks running marks (Task)" },
];

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...structuredClone(DEFAULTS) };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return { ...structuredClone(DEFAULTS), ...raw, colors: raw.colors || structuredClone(CLASSIC_COLORS) };
  } catch {
    console.error(`Warning: could not parse ${CONFIG_PATH}, using defaults.`);
    return { ...structuredClone(DEFAULTS) };
  }
}

function ansi(code, s) {
  return `\x1b[${code}m${s}\x1b[0m`;
}

function preview(cfg) {
  const lines = [];
  const model = cfg.showModel ? ansi(36, "[Auto]") : "";
  const path = ansi(33, "cursor-hud");
  const git = cfg.showGit ? ` ${ansi(34, "main")}${cfg.showDirty ? ansi(33, "*") : ""}` : "";
  lines.push([model, model ? ansi(2, " │ ") : "", path, git].filter(Boolean).join(""));

  const parts = [];
  if (cfg.showContextBar) {
    parts.push(
      `${ansi(2, "Context")} ${ansi(34, "████")}${ansi(2, "░░░░░░")} ${ansi(34, "34%")}`,
    );
  }
  if (cfg.showPlanUsage) {
    parts.push(
      `${ansi(2, "Plan")} ${ansi(2, "auto")} ${ansi(33, "██")}${ansi(2, "░░░░░░░░")} ${ansi(33, "14%")} ${ansi(2, ".")} ${ansi(2, "api")} ${ansi(35, "█")}${ansi(2, "░░░░░░░░░")} ${ansi(35, "11%")}`,
    );
  }
  if (parts.length) lines.push(parts.join(` ${ansi(2, "│")} `));

  if (cfg.lineLayout === "expanded") {
    if (cfg.showTools) lines.push(`${ansi(33, "◐")} ${ansi(36, "Read")}${ansi(2, ": src/foo.ts")}`);
    if (cfg.showAgents) lines.push(`${ansi(33, "◐")} ${ansi(2, "#1")} ${ansi(36, "explore")}${ansi(2, " bg: Search tokens")}`);
    if (cfg.showTodos) lines.push(`${ansi(2, "▸")} Fix layout ${ansi(2, "(1/2)")}`);
  } else {
    const bits = [];
    if (cfg.showTools) bits.push(`${ansi(33, "◐")} ${ansi(36, "Read")}${ansi(2, ": src/foo.ts")}`);
    if (cfg.showTodos) bits.push(`${ansi(2, "▸")} Fix layout ${ansi(2, "(1/2)")}`);
    if (bits.length) lines.push(bits.join(` ${ansi(2, "│")} `));
    if (cfg.showAgents) {
      lines.push(`${ansi(33, "◐")} ${ansi(2, "#1")} ${ansi(36, "explore")}${ansi(2, " bg: Search tokens")}`);
    }
  }

  console.log("\n── Preview ──");
  for (const line of lines) console.log(line);
  console.log(
    `layout=${cfg.lineLayout}  pathLevels=${cfg.pathLevels}  hooks=${cfg.hooksAgentsEnabled ? "on" : "off"}`,
  );
  console.log("─────────────\n");
}

function summarize(cfg) {
  const on = TOGGLES.filter((t) => cfg[t.key]).map((t) => t.key.replace(/^show/, "").replace(/^hooks/, "hooks"));
  return on.join(", ") || "(nothing)";
}

async function ask(rl, question, { defaultValue = "" } = {}) {
  const suffix = defaultValue !== "" ? ` [${defaultValue}]` : "";
  const ans = (await rl.question(`${question}${suffix}: `)).trim();
  return ans === "" ? defaultValue : ans;
}

async function choose(rl, title, options) {
  console.log(`\n${title}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt}`));
  for (;;) {
    const raw = await ask(rl, "Choice", { defaultValue: "1" });
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
    console.log(`Enter a number 1–${options.length}.`);
  }
}

async function toggleMenu(rl, cfg) {
  for (;;) {
    console.log("\nToggles (enter number to flip, Enter/0 to done):");
    TOGGLES.forEach((t, i) => {
      const mark = cfg[t.key] ? ansi(32, "ON ") : ansi(2, "off");
      console.log(`  ${i + 1}) [${mark}] ${t.label}`);
    });
    console.log(`  L) lineLayout: ${cfg.lineLayout} (flip compact/expanded)`);
    console.log(`  P) pathLevels: ${cfg.pathLevels} (1 / 2 / 3 / full)`);
    console.log("  0) done");
    const raw = (await ask(rl, "Toggle", { defaultValue: "0" })).trim().toLowerCase();
    if (raw === "0" || raw === "") return;
    if (raw === "l") {
      cfg.lineLayout = cfg.lineLayout === "compact" ? "expanded" : "compact";
      continue;
    }
    if (raw === "p") {
      const cycle = [1, 2, 3, "full"];
      const idx = cycle.findIndex((v) => v === cfg.pathLevels);
      cfg.pathLevels = cycle[(idx + 1) % cycle.length];
      continue;
    }
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= TOGGLES.length) {
      const key = TOGGLES[n - 1].key;
      cfg[key] = !cfg[key];
    }
  }
}

function saveConfig(cfg, previousRaw) {
  mkdirSync(HUD_DIR, { recursive: true, mode: 0o700 });
  if (existsSync(CONFIG_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(CONFIG_PATH, join(HUD_DIR, `config.backup-${stamp}.json`));
  }

  // Persist a clean public shape; merge back unknown keys from previous file.
  const out = {
    ...(previousRaw && typeof previousRaw === "object" ? previousRaw : {}),
    pathLevels: cfg.pathLevels,
    lineLayout: cfg.lineLayout,
    showModel: cfg.showModel,
    showGit: cfg.showGit,
    showDirty: cfg.showDirty,
    showContextBar: cfg.showContextBar,
    contextBarWidth: cfg.contextBarWidth,
    showPlanUsage: cfg.showPlanUsage,
    showTools: cfg.showTools,
    showCompletedTools: cfg.showCompletedTools,
    showAgents: cfg.showAgents,
    showTodos: cfg.showTodos,
    hooksAgentsEnabled: cfg.hooksAgentsEnabled,
    colors: cfg.colors,
    thresholds: cfg.thresholds,
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
}

function parseArgs(argv) {
  const out = {
    preset: null, // essential | full | minimal | keep
    fineTune: false,
    resetColors: false,
    save: false,
    nonInteractive: false,
  };
  for (const a of argv.slice(2)) {
    if (a === "--yes" || a === "-y") {
      out.save = true;
      out.nonInteractive = true;
    } else if (a.startsWith("--preset=")) {
      out.preset = a.slice("--preset=".length);
      out.nonInteractive = true;
    } else if (a === "--reset-colors") {
      out.resetColors = true;
      out.nonInteractive = true;
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage:
  npm run configure
  npm run configure -- --preset=essential|full|minimal|keep [--reset-colors] --yes

Interactive (default): guided prompts.
Non-interactive: apply preset and optionally save.`);
    return;
  }

  let previousRaw = null;
  if (existsSync(CONFIG_PATH)) {
    try {
      previousRaw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    } catch {
      previousRaw = null;
    }
  }

  let cfg = loadConfig();

  if (args.nonInteractive) {
    const map = { essential: 0, full: 1, minimal: 2, keep: 3 };
    const p = args.preset || "keep";
    if (!(p in map)) {
      console.error(`Unknown preset: ${p}`);
      process.exit(1);
    }
    if (p === "essential") Object.assign(cfg, PRESETS.essential.patch);
    else if (p === "full") Object.assign(cfg, PRESETS.full.patch);
    else if (p === "minimal") Object.assign(cfg, PRESETS.minimal.patch);
    if (args.resetColors) cfg.colors = structuredClone(CLASSIC_COLORS);
    preview(cfg);
    if (!args.save) {
      console.log("Dry run (pass --yes to save).");
      return;
    }
    saveConfig(cfg, previousRaw);
    console.log(`Saved ${CONFIG_PATH}`);
    return;
  }

  if (!input.isTTY) {
    console.error("Interactive configure needs a TTY.");
    console.error("Or use: npm run configure -- --preset=essential --yes");
    process.exit(1);
  }

  const rl = createInterface({ input, output });
  console.log("cursor-hud configure");
  console.log(`Config file: ${CONFIG_PATH}`);
  preview(cfg);
  console.log(`Currently on: ${summarize(cfg)}`);

  const presetIdx = await choose(rl, "Preset", [
    PRESETS.essential.label,
    PRESETS.full.label,
    PRESETS.minimal.label,
    "Keep current settings (skip preset)",
  ]);
  if (presetIdx === 0) Object.assign(cfg, PRESETS.essential.patch);
  else if (presetIdx === 1) Object.assign(cfg, PRESETS.full.patch);
  else if (presetIdx === 2) Object.assign(cfg, PRESETS.minimal.patch);

  preview(cfg);

  const fine = await choose(rl, "Fine-tune toggles?", [
    "Yes — open toggle menu",
    "No — keep preset / current",
  ]);
  if (fine === 0) {
    await toggleMenu(rl, cfg);
    preview(cfg);
  }

  const colorIdx = await choose(rl, "Colors", [
    "Keep current colors",
    "Reset to classic ANSI (cyan / yellow / blue / magenta)",
  ]);
  if (colorIdx === 1) cfg.colors = structuredClone(CLASSIC_COLORS);

  preview(cfg);

  const saveIdx = await choose(rl, "Save?", [
    `Yes — write ${CONFIG_PATH}`,
    "No — discard",
  ]);
  rl.close();

  if (saveIdx !== 0) {
    console.log("No changes written.");
    return;
  }

  saveConfig(cfg, previousRaw);
  console.log(`Saved ${CONFIG_PATH}`);
  console.log("Restart your `agent` session if the footer layout looks stuck.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
