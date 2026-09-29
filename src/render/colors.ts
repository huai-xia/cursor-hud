/** ANSI helpers — keep tiny, no chalk dependency. */

import type { BarColorConfig, ThresholdConfig } from "../types.js";

export const RESET = "\x1b[0m";
export const DIM = "\x1b[2m";
export const BOLD = "\x1b[1m";

export type AnsiPainter = (s: string) => string;

export type Rgb = readonly [number, number, number];

const NAMED: Record<string, string> = {
  black: "30",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  magenta: "35",
  cyan: "36",
  white: "37",
  gray: "90",
  grey: "90",
  brightBlack: "90",
  brightRed: "91",
  brightGreen: "92",
  brightYellow: "93",
  brightBlue: "94",
  brightMagenta: "95",
  brightCyan: "96",
  brightWhite: "97",
};

/** Approximate RGB for named ANSI colors (used in gradients). */
const NAMED_RGB: Record<string, Rgb> = {
  black: [0, 0, 0],
  red: [220, 50, 47],
  green: [0, 200, 80],
  yellow: [220, 180, 40],
  blue: [60, 120, 220],
  magenta: [200, 80, 200],
  cyan: [40, 180, 200],
  white: [220, 220, 220],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  brightBlack: [100, 100, 100],
  brightRed: [255, 100, 100],
  brightGreen: [100, 255, 140],
  brightYellow: [255, 230, 100],
  brightBlue: [120, 160, 255],
  brightMagenta: [230, 140, 255],
  brightCyan: [100, 230, 255],
  brightWhite: [255, 255, 255],
};

function paintCode(code: string): AnsiPainter {
  return (s: string) => `\x1b[${code}m${s}${RESET}`;
}

export function rgbAnsi(r: number, g: number, b: number): string {
  return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
}

export function parseColorToRgb(spec: string | undefined): Rgb | null {
  if (!spec) return null;
  const key = spec.trim();
  if (!key) return null;

  const hex = /^#([0-9a-fA-F]{6})$/.exec(key);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  return NAMED_RGB[key] || NAMED_RGB[key.toLowerCase()] || null;
}

/** Resolve a color name (`green`) or `#RRGGBB` to a painter. */
export function colorPainter(spec: string | undefined, fallback: AnsiPainter): AnsiPainter {
  if (!spec) return fallback;
  const key = spec.trim();
  if (!key) return fallback;

  // Hex → truecolor. Named colors stay classic ANSI (32/36/…) so the
  // default HUD matches the pre-gradient look.
  const hex = /^#([0-9a-fA-F]{6})$/.exec(key);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return (s: string) => `${rgbAnsi(r, g, b)}${s}${RESET}`;
  }

  const named = NAMED[key] || NAMED[key.toLowerCase()];
  if (named) return paintCode(named);
  return fallback;
}

export const cyan = colorPainter("cyan", (s) => s);
export const green = colorPainter("green", (s) => s);
export const yellow = colorPainter("yellow", (s) => s);
export const red = colorPainter("red", (s) => s);
export const magenta = colorPainter("magenta", (s) => s);
export const blue = colorPainter("blue", (s) => s);
export const dim = (s: string) => `${DIM}${s}${RESET}`;

export function barPainter(
  pct: number,
  colors: BarColorConfig | undefined,
  thresholds: ThresholdConfig,
  defaults: {
    ok: AnsiPainter;
    mid?: AnsiPainter;
    high?: AnsiPainter;
    warn: AnsiPainter;
    crit: AnsiPainter;
  },
): AnsiPainter {
  if (colors?.fixed) {
    return colorPainter(colors.fixed, defaults.ok);
  }
  if (colors?.gradient && colors.gradient.length >= 2) {
    const rgb = sampleGradient(colors.gradient, pct / 100);
    if (rgb) {
      const [r, g, b] = rgb;
      return (s: string) => `${rgbAnsi(r, g, b)}${s}${RESET}`;
    }
  }
  if (pct >= thresholds.crit) {
    return colorPainter(colors?.crit, defaults.crit);
  }
  if (pct >= thresholds.warn) {
    return colorPainter(colors?.warn, defaults.warn);
  }
  if (pct >= thresholds.high) {
    return colorPainter(colors?.high, defaults.high ?? defaults.warn);
  }
  if (pct >= thresholds.mid) {
    return colorPainter(colors?.mid, defaults.mid ?? defaults.warn);
  }
  return colorPainter(colors?.ok, defaults.ok);
}

/** Interpolate multi-stop gradient; t in [0, 1]. */
export function sampleGradient(stops: string[], t: number): Rgb | null {
  const rgbs = stops.map(parseColorToRgb).filter((x): x is Rgb => x !== null);
  if (rgbs.length === 0) return null;
  if (rgbs.length === 1) return rgbs[0];

  const x = Math.max(0, Math.min(1, t));
  const seg = x * (rgbs.length - 1);
  const i = Math.min(rgbs.length - 2, Math.floor(seg));
  const local = seg - i;
  const a = rgbs[i];
  const b = rgbs[i + 1];
  return [
    a[0] + (b[0] - a[0]) * local,
    a[1] + (b[1] - a[1]) * local,
    a[2] + (b[2] - a[2]) * local,
  ];
}

/**
 * Draw a bar. If `gradient` has 2+ stops, each filled cell is colored along
 * the gradient (left=first stop … right=last stop among filled cells, mapped
 * by overall percentage span 0→pct so a half-full bar only shows the first half
 * of the gradient — warmer colors appear as usage grows).
 */
export function drawBar(
  pct: number,
  width: number,
  gradient?: string[],
): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((clamped * width) / 100);
  const empty = width - filled;

  if (!gradient || gradient.length < 2 || filled <= 0) {
    return `${"█".repeat(filled)}${"░".repeat(empty)}`;
  }

  let out = "";
  for (let i = 0; i < filled; i++) {
    // Map cell index across the *full* bar width so color encodes absolute usage.
    // Cell 0 ≈ 0%, last cell of a full bar ≈ 100%.
    const t = width <= 1 ? clamped / 100 : i / (width - 1);
    const rgb = sampleGradient(gradient, t) || ([0, 200, 80] as Rgb);
    out += `${rgbAnsi(rgb[0], rgb[1], rgb[2])}█`;
  }
  out += `${RESET}${DIM}${"░".repeat(empty)}${RESET}`;
  return out;
}
