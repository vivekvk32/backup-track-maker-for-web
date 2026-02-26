export const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const SCALES = {
  Major: [0, 2, 4, 5, 7, 9, 11],
  "Natural Minor": [0, 2, 3, 5, 7, 8, 10],
  "Minor Pentatonic": [0, 3, 5, 7, 10],
  Blues: [0, 3, 5, 6, 7, 10]
};

const CYCLE_STEPS = [
  null,
  { degree: 1, octaveOffset: 0, lengthSteps: 1, velocity: 0.85 },
  { degree: 5, octaveOffset: 0, lengthSteps: 1, velocity: 0.85 },
  { degree: 1, octaveOffset: 1, lengthSteps: 1, velocity: 0.85 },
  { degree: 3, octaveOffset: 0, lengthSteps: 1, velocity: 0.82 },
  { degree: 7, octaveOffset: 0, lengthSteps: 1, velocity: 0.8 }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function buildScaleOffsets(scaleName) {
  const source = SCALES[scaleName] || SCALES.Major;
  const offsets = [];
  for (let index = 0; index < 7; index += 1) {
    offsets.push(source[index] ?? source[source.length - 1] ?? 0);
  }
  return offsets;
}

export function degreeToMidi({ key, scale, octave, degree, octaveOffset = 0 }) {
  const keyIndex = KEYS.indexOf(key);
  const safeKeyIndex = keyIndex >= 0 ? keyIndex : 0;
  const safeOctave = clamp(Number(octave) || 2, 1, 4);
  const safeDegree = clamp(Number(degree) || 1, 1, 7);
  const safeOffset = [0, 1].includes(Number(octaveOffset)) ? Number(octaveOffset) : 0;

  const scaleOffsets = buildScaleOffsets(scale);
  const baseMidi = 12 + safeOctave * 12 + safeKeyIndex;
  const midi = baseMidi + scaleOffsets[safeDegree - 1] + safeOffset * 12;
  return clamp(midi, 24, 96);
}

function tokenToCycleIndex(token) {
  if (!token || typeof token !== "object") {
    return 0;
  }
  if (token.degree === 1 && token.octaveOffset === 0) {
    return 1;
  }
  if (token.degree === 5 && token.octaveOffset === 0) {
    return 2;
  }
  if (token.degree === 1 && token.octaveOffset === 1) {
    return 3;
  }
  if (token.degree === 3) {
    return 4;
  }
  if (token.degree === 7) {
    return 5;
  }
  return 0;
}

export function cycleStepToken(token) {
  const currentIndex = tokenToCycleIndex(token);
  const nextIndex = (currentIndex + 1) % CYCLE_STEPS.length;
  const next = CYCLE_STEPS[nextIndex];
  return next ? { ...next } : null;
}

export function bassStepTokenLabel(token) {
  if (!token || typeof token !== "object") {
    return "off";
  }
  if (token.degree === 1 && token.octaveOffset === 1) {
    return "8";
  }
  return String(clamp(Number(token.degree) || 1, 1, 7));
}

