import { isAbsolute } from "node:path";

/** Normalize for prefix compare (POSIX-ish). */
function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Prefer project-relative paths. Roots are tried longest-first
 * (cwd, then project_dir). Non-matching absolute paths stay absolute.
 */
export function relativizePath(path: string, roots: string[]): string {
  const raw = path.trim();
  if (!raw) return raw;
  const n = norm(raw);
  const sorted = roots
    .filter((r) => typeof r === "string" && r.trim())
    .map((r) => norm(r.trim()))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const root of sorted) {
    if (n === root) return ".";
    if (n.startsWith(`${root}/`)) return n.slice(root.length + 1);
  }
  return raw;
}

/** Strip known project roots from free text (e.g. shell commands). */
export function stripRootsInText(text: string, roots: string[]): string {
  let out = text;
  const sorted = roots
    .filter((r) => typeof r === "string" && r.trim())
    .map((r) => norm(r.trim()))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const root of sorted) {
    // "/root/foo" → "foo"; trailing "/root" → "."
    out = out.split(`${root}/`).join("");
    out = out.split(root).join(".");
  }
  return out;
}

export function formatToolTarget(
  raw: string | undefined,
  roots: string[],
  maxLen: number,
): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Path-like → relativize; shell/other text → strip root prefixes inside.
  const looksPath =
    isAbsolute(trimmed) ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    roots.some((r) => r && (trimmed === r || trimmed.startsWith(`${norm(r)}/`)));

  let display = looksPath
    ? relativizePath(trimmed, roots)
    : stripRootsInText(trimmed, roots);

  display = display.replace(/\s+/g, " ").trim();
  if (display.length <= maxLen) return display;
  return `${display.slice(0, Math.max(0, maxLen - 1))}…`;
}
