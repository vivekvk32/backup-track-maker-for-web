import { normalizeNoteName } from "./rootNoteUtils";

const BASE_COLORS = {
  C: "#d64a4a",
  D: "#e38b39",
  E: "#d9b92d",
  F: "#46aa55",
  G: "#3e78df",
  A: "#8b4fd8",
  B: "#db64aa"
};

function hexToRgb(hex) {
  const clean = String(hex || "#000000").replace("#", "");
  const value = clean.length === 3
    ? clean
        .split("")
        .map((item) => `${item}${item}`)
        .join("")
    : clean;
  const number = Number.parseInt(value, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255
  };
}

function toHex(value) {
  const safe = Math.max(0, Math.min(255, Math.round(value)));
  return safe.toString(16).padStart(2, "0");
}

function darken(hex, factor = 0.82) {
  const rgb = hexToRgb(hex);
  return `#${toHex(rgb.r * factor)}${toHex(rgb.g * factor)}${toHex(rgb.b * factor)}`;
}

function rgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`;
}

function getTextColor(baseLetter) {
  return baseLetter === "E" ? "#1a1a1a" : "#ffffff";
}

export function getNoteColor(note) {
  const normalized = normalizeNoteName(note, "C");
  const baseLetter = normalized[0] || "C";
  const base = BASE_COLORS[baseLetter] || BASE_COLORS.C;
  const isAccidental = normalized.includes("#");
  const shade = isAccidental ? darken(base, 0.82) : base;

  return {
    bg: shade,
    border: darken(shade, 0.72),
    text: getTextColor(baseLetter),
    glow: rgba(shade, 0.62)
  };
}

