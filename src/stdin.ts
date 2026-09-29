import type { StatusLinePayload } from "./types.js";

const DEFAULT_FIRST_BYTE_MS = 250;
const DEFAULT_IDLE_MS = 40;
const DEFAULT_MAX_BYTES = 512 * 1024;

/**
 * Read StatusLine JSON from stdin. Returns null if TTY / empty / invalid.
 */
export async function readStdin(
  stream: NodeJS.ReadStream = process.stdin,
): Promise<StatusLinePayload | null> {
  if (stream.isTTY) return null;

  stream.setEncoding("utf8");

  return await new Promise((resolve) => {
    let raw = "";
    let settled = false;
    let sawData = false;
    let firstTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: StatusLinePayload | null) => {
      if (settled) return;
      settled = true;
      if (firstTimer) clearTimeout(firstTimer);
      if (idleTimer) clearTimeout(idleTimer);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
      try {
        stream.pause();
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    const tryParse = (): StatusLinePayload | null | undefined => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      try {
        return JSON.parse(trimmed) as StatusLinePayload;
      } catch {
        return undefined;
      }
    };

    const scheduleIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const parsed = tryParse();
        finish(parsed ?? null);
      }, DEFAULT_IDLE_MS);
    };

    const onData = (chunk: string) => {
      if (!sawData) {
        sawData = true;
        if (firstTimer) clearTimeout(firstTimer);
      }
      raw += chunk;
      if (raw.length > DEFAULT_MAX_BYTES) {
        finish(tryParse() ?? null);
        return;
      }
      scheduleIdle();
    };

    const onEnd = () => {
      finish(tryParse() ?? null);
    };

    const onError = () => finish(null);

    firstTimer = setTimeout(() => {
      if (!sawData) finish(null);
    }, DEFAULT_FIRST_BYTE_MS);

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}
