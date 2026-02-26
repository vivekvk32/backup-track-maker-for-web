export const METRONOME_SUBDIVISIONS = {
  HALF: "half",
  QUARTER: "quarter",
  EIGHTH: "eighth",
  SIXTEENTH: "sixteenth"
};

export function shouldTriggerMetronomeStep(stepInBar, subdivision) {
  switch (subdivision) {
    case METRONOME_SUBDIVISIONS.HALF:
      return stepInBar % 8 === 0;
    case METRONOME_SUBDIVISIONS.QUARTER:
      return stepInBar % 4 === 0;
    case METRONOME_SUBDIVISIONS.EIGHTH:
      return stepInBar % 2 === 0;
    case METRONOME_SUBDIVISIONS.SIXTEENTH:
      return true;
    default:
      return stepInBar % 4 === 0;
  }
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
