import { getNoteColor } from "../bass/noteColors";
import { NOTE_OPTIONS_SHARP, normalizeNoteName, noteToPitchClass } from "../bass/rootNoteUtils";

export const PIANO_CHORD_QUALITIES = ["maj", "min", "7", "maj7", "m7", "dim", "sus2", "sus4"];

const QUALITY_SUFFIX = {
  maj: "",
  min: "m",
  "7": "7",
  maj7: "maj7",
  m7: "m7",
  dim: "dim",
  sus2: "sus2",
  sus4: "sus4"
};

const QUALITY_INTERVALS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7]
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function rotateIntervals(intervals, inversion) {
  const total = intervals.length;
  const shift = ((inversion % total) + total) % total;
  const rotated = intervals.slice(shift).concat(intervals.slice(0, shift));
  for (let index = 0; index < shift; index += 1) {
    rotated[total - shift + index] += 12;
  }
  return rotated;
}

function shiftVoicingIntoRange(notes, minMidi, maxMidi) {
  if (!Array.isArray(notes) || notes.length === 0) {
    return [];
  }

  let shifted = [...notes].sort((left, right) => left - right);
  const minNote = shifted[0];
  const maxNote = shifted[shifted.length - 1];

  if (maxNote - minNote > maxMidi - minMidi) {
    return [];
  }

  while (shifted[0] < minMidi) {
    shifted = shifted.map((note) => note + 12);
    if (shifted[shifted.length - 1] > maxMidi) {
      return [];
    }
  }

  while (shifted[shifted.length - 1] > maxMidi) {
    shifted = shifted.map((note) => note - 12);
    if (shifted[0] < minMidi) {
      return [];
    }
  }

  return shifted;
}

function findPitchInRange(pitchClass, minMidi, maxMidi, preferredTop = null) {
  const matches = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    if (((midi % 12) + 12) % 12 === pitchClass) {
      matches.push(midi);
    }
  }
  if (!matches.length) {
    return null;
  }

  if (preferredTop === null || preferredTop === undefined) {
    return matches[0];
  }

  let best = matches[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const midi of matches) {
    const distance = Math.abs(preferredTop - midi);
    if (distance < bestDistance) {
      best = midi;
      bestDistance = distance;
    }
  }
  return best;
}

function scoreVoicing(candidate, previousVoicing) {
  if (!Array.isArray(previousVoicing) || previousVoicing.length === 0) {
    const center = 67;
    return candidate.reduce((sum, note) => sum + Math.abs(note - center), 0);
  }

  const previous = [...previousVoicing].sort((left, right) => left - right);
  const current = [...candidate].sort((left, right) => left - right);
  const limit = Math.max(previous.length, current.length);
  let score = 0;
  for (let index = 0; index < limit; index += 1) {
    const prevNote = previous[Math.min(index, previous.length - 1)];
    const currentNote = current[Math.min(index, current.length - 1)];
    score += Math.abs(currentNote - prevNote);
  }

  const currentCenter = current.reduce((sum, note) => sum + note, 0) / current.length;
  score += Math.abs(currentCenter - 67) * 0.2;
  return score;
}

export function buildChordSymbol({ root, quality, bass }) {
  const safeRoot = normalizeNoteName(root, "C");
  const safeQuality = PIANO_CHORD_QUALITIES.includes(quality) ? quality : "maj";
  const suffix = QUALITY_SUFFIX[safeQuality] || "";
  const safeBass = bass ? normalizeNoteName(bass, safeRoot) : null;

  if (safeBass) {
    return `${safeRoot}${suffix}/${safeBass}`;
  }
  return `${safeRoot}${suffix}`;
}

export function normalizeChordData(input, fallbackRoot = "C") {
  const source = input && typeof input === "object" ? input : {};
  const root = normalizeNoteName(source.root || fallbackRoot, fallbackRoot);
  const quality = PIANO_CHORD_QUALITIES.includes(source.quality) ? source.quality : "maj";
  const bass = source.bass ? normalizeNoteName(source.bass, root) : null;
  const symbol = buildChordSymbol({ root, quality, bass });
  return {
    root,
    quality,
    bass,
    symbol
  };
}

export function chordToPitchClasses(chord) {
  const normalized = normalizeChordData(chord, "C");
  const rootPitchClass = noteToPitchClass(normalized.root);
  const intervals = QUALITY_INTERVALS[normalized.quality] || QUALITY_INTERVALS.maj;
  return intervals.map((interval) => (rootPitchClass + interval) % 12);
}

export function chooseSmartVoicing(chord, prevVoicing, options = {}) {
  const normalized = normalizeChordData(chord, "C");
  const minMidi = clamp(Math.round(Number(options.minMidi) || 55), 36, 96);
  const maxMidi = clamp(Math.round(Number(options.maxMidi) || 79), minMidi + 6, 108);
  const rootPitchClass = noteToPitchClass(normalized.root);
  const intervals = QUALITY_INTERVALS[normalized.quality] || QUALITY_INTERVALS.maj;

  const candidates = [];
  for (let octave = 3; octave <= 6; octave += 1) {
    const rootMidi = 12 + octave * 12 + rootPitchClass;
    for (let inversion = 0; inversion < intervals.length; inversion += 1) {
      const rotated = rotateIntervals(intervals, inversion);
      const notes = rotated.map((interval) => rootMidi + interval);
      const shifted = shiftVoicingIntoRange(notes, minMidi, maxMidi);
      if (shifted.length) {
        candidates.push(shifted);
      }
    }
  }

  if (!candidates.length) {
    const fallbackRoot = findPitchInRange(rootPitchClass, minMidi, maxMidi, 64);
    return fallbackRoot === null ? [] : [fallbackRoot];
  }

  let best = candidates[0];
  let bestScore = scoreVoicing(best, prevVoicing);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score = scoreVoicing(candidate, prevVoicing);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  let voiced = uniqueSorted(best);

  if (normalized.bass) {
    const bassPitchClass = noteToPitchClass(normalized.bass);
    const maxBassTarget = voiced.length > 1 ? voiced[1] : voiced[0] + 2;
    const bassMidi = findPitchInRange(bassPitchClass, minMidi, maxMidi, maxBassTarget);
    if (bassMidi !== null) {
      voiced = uniqueSorted([bassMidi, ...voiced.filter((note) => note !== bassMidi)]);
      while (voiced.length > 1 && voiced[0] >= voiced[1]) {
        const lowered = voiced[0] - 12;
        if (lowered < minMidi) {
          break;
        }
        voiced[0] = lowered;
        voiced.sort((left, right) => left - right);
      }
    }
  }

  return voiced.filter((midi) => midi >= minMidi && midi <= maxMidi);
}

export function getChordRootColor(chord) {
  const normalized = normalizeChordData(chord, "C");
  return getNoteColor(normalized.root);
}

export { NOTE_OPTIONS_SHARP };
