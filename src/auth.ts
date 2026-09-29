import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Resolve Cursor CLI access token without logging it.
 * Order: CURSOR_AUTH_FILE → ~/.config/cursor/auth.json → ~/.cursor/auth.json → macOS Keychain.
 */
export async function getAccessToken(): Promise<string | null> {
  const envPath = process.env.CURSOR_AUTH_FILE?.trim();
  const candidates = [
    envPath,
    join(homedir(), ".config", "cursor", "auth.json"),
    join(homedir(), ".cursor", "auth.json"),
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf8");
      const data = JSON.parse(raw) as { accessToken?: unknown };
      if (typeof data.accessToken === "string" && data.accessToken.length > 0) {
        return data.accessToken;
      }
    } catch {
      /* try next */
    }
  }

  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", "cursor-access-token", "-a", "cursor-user", "-w"],
        { timeout: 800, maxBuffer: 16 * 1024 },
      );
      const token = stdout.trim();
      if (token) return token;
    } catch {
      /* no keychain item */
    }
  }

  return null;
}
