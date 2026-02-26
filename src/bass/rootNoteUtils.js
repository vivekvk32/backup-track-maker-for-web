export const NOTE_OPTIONS_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const NOTE_ALIAS_TO_SHARP = {
  C: "C",
  "C#": "C#",
  DB: "C#",
  D: "D",
  "D#": "D#",
  EB: "D#",
  E: "E",
  FB: "E",
  "E#": "F",
  F: "F",
  "F#": "F#",
  GB: "F#",
  G: "G",
  "G#": "G#",
  AB: "G#",
  A: "A",
  "A#": "A#",
  BB: "A#",
  B: "B",
  CB: "B",
  "B#": "C"
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeToken(note) {
  return String(note || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\u266D/g, "B")
    .replace(/\u266F/g, "#")
    .replace(/FLAT/g, "B")
    .replace(/SHARP/g, "#");
}

export function normalizeNoteName(note, fallback = "C") {
  const token = normalizeToken(note);
  if (NOTE_ALIAS_TO_SHARP[token]) {
    return NOTE_ALIAS_TO_SHARP[token];
  }

  if (NOTE_OPTIONS_SHARP.includes(token)) {
    return token;
  }

  return NOTE_ALIAS_TO_SHARP[normalizeToken(fallback)] || "C";
}

export function noteToPitchClass(note) {
  const normalized = normalizeNoteName(note, "C");
  const pitchClass = NOTE_OPTIONS_SHARP.indexOf(normalized);
  return pitchClass >= 0 ? pitchClass : 0;
}

export function rootNoteToMidi(note, baseOctave = 2) {
  const safeOctave = clamp(Math.round(Number(baseOctave) || 2), 1, 6);
  const pitchClass = noteToPitchClass(note);
  const midi = 12 + safeOctave * 12 + pitchClass;
  return clamp(midi, 24, 96);
}

