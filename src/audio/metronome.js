export const METRONOME_SUBDIVISIONS = {
  HALF: "half",
  QUARTER: "quarter",
  EIGHTH: "eighth",
  SIXTEENTH: "sixteenth"
};

function normalizeStepsPerBar(value) {
  const numeric = Number(value);
  if ([4, 8, 16, 32].includes(numeric)) {
    return numeric;
  }
  return 16;
}

function normalizeTimeSignature(value) {
  const source = value && typeof value === "object" ? value : {};
  const beatsPerBar = Math.max(1, Math.min(16, Math.round(Number(source.beatsPerBar) || 4)));
  const beatUnitRaw = Math.round(Number(source.beatUnit) || 4);
  const beatUnit = [2, 3, 4, 8, 16].includes(beatUnitRaw) ? beatUnitRaw : 4;
  return { beatsPerBar, beatUnit };
}

function metronomeIntervalSteps(subdivision, stepsPerBar, timeSignature) {
  const stepsPerBeat = stepsPerBar / timeSignature.beatsPerBar;
  switch (subdivision) {
    case METRONOME_SUBDIVISIONS.HALF:
      return stepsPerBeat * 2;
    case METRONOME_SUBDIVISIONS.QUARTER:
      return stepsPerBeat;
    case METRONOME_SUBDIVISIONS.EIGHTH:
      return stepsPerBeat / 2;
    case METRONOME_SUBDIVISIONS.SIXTEENTH:
      return stepsPerBeat / 4;
    default:
      return stepsPerBeat;
  }
}

export function shouldTriggerMetronomeStep(
  stepInBar,
  subdivision,
  { stepsPerBar = 16, timeSignature = { beatsPerBar: 4, beatUnit: 4 } } = {}
) {
  const safeStepsPerBar = normalizeStepsPerBar(stepsPerBar);
  const safeTimeSignature = normalizeTimeSignature(timeSignature);
  const interval = metronomeIntervalSteps(subdivision, safeStepsPerBar, safeTimeSignature);
  const safeInterval = Math.max(0.25, Number(interval) || 1);
  const nearestMultiple = Math.round(stepInBar / safeInterval);
  const nearestStep = nearestMultiple * safeInterval;
  return Math.abs(stepInBar - nearestStep) < 0.5;
}

export function scheduleClick(
  audioContext,
  atTime,
  { isAccent = false, volume = 0.6, outputNode }
) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  const frequency = isAccent ? 1800 : 1300;
  const peakGain = Math.min(1, Math.max(0, volume) * (isAccent ? 1 : 0.8));

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, atTime);

  gainNode.gain.setValueAtTime(0.0001, atTime);
  gainNode.gain.linearRampToValueAtTime(peakGain, atTime + 0.001);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.03);

  oscillator.connect(gainNode);
  gainNode.connect(outputNode);

  oscillator.start(atTime);
  oscillator.stop(atTime + 0.045);
}
