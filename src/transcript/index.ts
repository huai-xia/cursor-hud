import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseTranscript } from "./parse.js";
import type { TranscriptData } from "./types.js";

interface CacheFile {
  version: 2;
  path: string;
  mtimeMs: number;
  size: number;
  data: TranscriptData;
}

function cacheFileFor(transcriptPath: string): string {
  const hash = createHash("sha1").update(transcriptPath).digest("hex").slice(0, 16);
  return join(homedir(), ".cursor", "cursor-hud", "cache", `transcript-${hash}.json`);
}

export async function loadTranscript(transcriptPath?: string): Promise<TranscriptData> {
  const empty: TranscriptData = { tools: [], agents: [], todos: [] };
  if (!transcriptPath || !existsSync(transcriptPath)) return empty;

  let mtimeMs = 0;
  let size = 0;
  try {
    const st = statSync(transcriptPath);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    return empty;
  }

  const cachePath = cacheFileFor(transcriptPath);
  try {
    if (existsSync(cachePath)) {
      const cached = JSON.parse(readFileSync(cachePath, "utf8")) as CacheFile;
      if (
        cached.version === 2 &&
        cached.path === transcriptPath &&
        cached.mtimeMs === mtimeMs &&
        cached.size === size &&
        cached.data
      ) {
        return cached.data;
      }
    }
  } catch {
    /* rebuild */
  }

  const data = await parseTranscript(transcriptPath);

  try {
    mkdirSync(join(homedir(), ".cursor", "cursor-hud", "cache"), {
      recursive: true,
      mode: 0o700,
    });
    const payload: CacheFile = {
      version: 2,
      path: transcriptPath,
      mtimeMs,
      size,
      data,
    };
    writeFileSync(cachePath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  } catch {
    /* ignore cache write */
  }

  return data;
}
