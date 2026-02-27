import { normalizeNoteName, rootNoteToMidi } from "../bass/rootNoteUtils";

const SCALE_MINORISH = new Set(["minor", "pentatonic", "blues"]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeScale(value) {
  const token = String(value || "").toLowerCase();
  if (["major", "minor", "pentatonic", "blues"].includes(token)) {
    return token;
  }
  return "major";
}

export function resolveIntervals(harmonyMode, scale) {
  const mode = String(harmonyMode || "triad").toLowerCase();
  const normalizedScale = normalizeScale(scale);
  const minorish = SCALE_MINORISH.has(normalizedScale);

  if (mode === "single") {
    return [0];
  }
  if (mode === "power") {
    return [0, 7];
  }
  if (mode === "sus2") {
    return [0, 2, 7];
  }
  if (mode === "sus4") {
    return [0, 5, 7];
  }
  if (mode === "seventh") {
    return minorish ? [0, 3, 7, 10] : [0, 4, 7, 11];
  }
  return minorish ? [0, 3, 7] : [0, 4, 7];
}

export function buildHarmonyMidi(root, settings = {}) {
  const normalizedRoot = normalizeNoteName(root || "C", "C");
  const octave = clamp(Math.round(Number(settings.octave) || 4), 2, 5);
  const intervals = resolveIntervals(settings.harmonyMode, settings.scale);
  const baseMidi = rootNoteToMidi(normalizedRoot, octave);
  return intervals
    .map((interval) => baseMidi + interval)
    .filter((midi) => Number.isFinite(midi))
    .map((midi) => clamp(Math.round(midi), 24, 108));
}

export function getSegmentForStep(cell, stepInBar) {
  if (!cell || typeof cell !== "object") {
    return null;
  }

  const step = clamp(Math.round(Number(stepInBar) || 0), 0, 15);
  const sixteenthLength = cell.split ? 8 : 16;

  if (cell.split) {
    if (step < 8) {
      return {
        root: normalizeNoteName(cell.root || "C", "C"),
        half: 0,
        isStart: step === 0,
        stepOffsetInSegment: step,
        segmentSixteenths: 8
      };
    }
    return {
      root: normalizeNoteName(cell.secondRoot || cell.root || "G", "G"),
      half: 1,
      isStart: step === 8,
      stepOffsetInSegment: step - 8,
      segmentSixteenths: 8
    };
  }

  return {
    root: normalizeNoteName(cell.root || "C", "C"),
    half: null,
    isStart: step === 0,
    stepOffsetInSegment: step,
    segmentSixteenths: sixteenthLength
  };
}
