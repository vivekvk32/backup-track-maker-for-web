let audioContext = null;
let masterGain = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function ensureAudioContext() {
  if (audioContext && masterGain) {
    return { audioContext, masterGain };
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Web Audio API is not supported in this browser.");
  }

  audioContext = new AudioContextCtor();
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.8;
  masterGain.connect(audioContext.destination);

  return { audioContext, masterGain };
}

export async function resumeAudioContext() {
  const { audioContext: context } = ensureAudioContext();
  if (context.state === "suspended") {
    await context.resume();
  }
  return context;
}

export function setMasterVolume(value) {
  const { audioContext: context, masterGain: gainNode } = ensureAudioContext();
  const clamped = clamp(Number(value) || 0, 0, 1);
  gainNode.gain.setValueAtTime(clamped, context.currentTime);
}

export function getAudioNodes() {
  return ensureAudioContext();
}
