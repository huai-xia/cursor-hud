import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitStatus } from "./types.js";

const execFileAsync = promisify(execFile);

async function git(
  cwd: string,
  args: string[],
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "--no-optional-locks", ...args], {
      timeout: 800,
      maxBuffer: 64 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function getGitStatus(cwd?: string): Promise<GitStatus | null> {
  if (!cwd) return null;

  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return null;

  const branch =
    (await git(cwd, ["symbolic-ref", "--short", "HEAD"])) ||
    (await git(cwd, ["rev-parse", "--short", "HEAD"])) ||
    "detached";

  const porcelain = await git(cwd, ["status", "--porcelain"]);
  const dirty = porcelain !== null && porcelain.length > 0;

  let ahead = 0;
  let behind = 0;
  const counts = await git(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
  if (counts) {
    const [a, b] = counts.split(/\s+/);
    ahead = Number.parseInt(a || "0", 10) || 0;
    behind = Number.parseInt(b || "0", 10) || 0;
  }

  return { branch, dirty, ahead, behind };
}
