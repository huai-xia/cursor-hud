import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { StatusLinePayload } from "./types.js";

/**
 * Persist raw statusLine payloads for format discovery (P0 probe).
 * Keeps last N captures + a "latest.json". Never throws into the HUD path.
 */
export async function maybeCapture(
  payload: StatusLinePayload,
  captureDir: string,
  enabled: boolean,
  minIntervalMs = 60_000,
): Promise<void> {
  if (!enabled) return;
  try {
    mkdirSync(captureDir, { recursive: true, mode: 0o700 });
    const latest = join(captureDir, "latest.json");
    const body = JSON.stringify(payload, null, 2);
    writeFileSync(latest, body, { encoding: "utf8", mode: 0o600 });

    // Throttle stamped copies so statusLine refresh doesn't fill the disk.
    let writeStamp = true;
    const stampMarker = join(captureDir, ".last-stamp");
    try {
      const age = Date.now() - statSync(stampMarker).mtimeMs;
      if (age < minIntervalMs) writeStamp = false;
    } catch {
      /* first run */
    }
    if (writeStamp) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writeFileSync(join(captureDir, `stdin-${stamp}.json`), body, {
        encoding: "utf8",
        mode: 0o600,
      });
      writeFileSync(stampMarker, String(Date.now()), { encoding: "utf8", mode: 0o600 });
    }

    const meta = {
      capturedAt: new Date().toISOString(),
      transcript_path: payload.transcript_path ?? null,
      transcript_exists: payload.transcript_path
        ? existsSync(payload.transcript_path)
        : false,
      keys: Object.keys(payload).sort(),
      model: payload.model ?? null,
      context_window: payload.context_window ?? null,
    };
    writeFileSync(join(captureDir, "latest-meta.json"), JSON.stringify(meta, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });

    if (payload.transcript_path && existsSync(payload.transcript_path) && writeStamp) {
      try {
        const dest = join(captureDir, "latest-transcript-head.jsonl");
        const fh = await open(payload.transcript_path, "r");
        try {
          const buf = Buffer.alloc(200 * 1024);
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          writeFileSync(dest, buf.subarray(0, bytesRead), { mode: 0o600 });
        } finally {
          await fh.close();
        }
      } catch {
        /* ignore large-file / permission issues */
      }
    }
  } catch {
    /* capture must never break the HUD */
  }
}
