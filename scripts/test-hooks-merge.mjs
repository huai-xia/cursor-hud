#!/usr/bin/env node
/**
 * Smoke tests for mergeAgentsWithHooks (P3 option A).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeAgentsWithHooks,
  writeAgentHooksFile,
} from "../dist/agent-hooks.js";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), "cursor-hud-hooks-"));
const path = join(dir, "agent-hooks.json");
const sid = "sess-test";
const now = 1_700_000_000_000;

try {
  // 1) hooks-only → inject running
  writeAgentHooksFile(path, {
    sessions: {
      [sid]: {
        "tu-1": {
          status: "running",
          type: "explore",
          description: "probe-a",
          background: true,
          startedAt: now - 5000,
          toolUseId: "tu-1",
        },
      },
    },
  });
  const t1 = { tools: [], agents: [], todos: [] };
  mergeAgentsWithHooks(t1, sid, { path, now, prune: false });
  assert(t1.agents.length === 1, "inject one agent");
  assert(t1.agents[0].status === "running", "injected running");
  assert(t1.agents[0].background === true, "background flag");

  // 2) transcript completed wins — clear force-running
  writeAgentHooksFile(path, {
    sessions: {
      [sid]: {
        "tu-2": {
          status: "running",
          type: "explore",
          description: "probe-b",
          background: false,
          startedAt: now - 1000,
          toolUseId: "tu-2",
        },
      },
    },
  });
  const t2 = {
    tools: [],
    agents: [
      {
        id: "x",
        type: "explore",
        description: "probe-b",
        status: "completed",
        background: false,
      },
    ],
    todos: [],
  };
  mergeAgentsWithHooks(t2, sid, { path, now, prune: true });
  assert(t2.agents[0].status === "completed", "completed not overridden");

  // 3) transcript running + matching hook keeps running / stamps start
  writeAgentHooksFile(path, {
    sessions: {
      [sid]: {
        "tu-3": {
          status: "running",
          type: "generalPurpose",
          description: "probe-c",
          background: false,
          startedAt: now - 9000,
          toolUseId: "tu-3",
        },
      },
    },
  });
  const t3 = {
    tools: [],
    agents: [
      {
        id: "y",
        type: "generalPurpose",
        description: "probe-c",
        status: "running",
        background: false,
      },
    ],
    todos: [],
  };
  mergeAgentsWithHooks(t3, sid, { path, now, prune: false });
  assert(t3.agents[0].status === "running", "stay running");
  assert(t3.agents[0].startedAtMs === now - 9000, "startedAt from hooks");

  console.log("test:hooks-merge OK");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
