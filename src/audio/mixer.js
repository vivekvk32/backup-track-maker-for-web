function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createMixer({ audioContext, outputNode }) {
  const masterGainNode = audioContext.createGain();

  const drumInput = audioContext.createGain();
  const drumFader = audioContext.createGain();
  const drumRoute = audioContext.createGain();

  const bassInput = audioContext.createGain();
  const bassFader = audioContext.createGain();
  const bassRoute = audioContext.createGain();
  const pianoInput = audioContext.createGain();
  const pianoFader = audioContext.createGain();
  const pianoRoute = audioContext.createGain();

  drumInput.connect(drumFader);
  drumFader.connect(drumRoute);
  drumRoute.connect(masterGainNode);

  bassInput.connect(bassFader);
  bassFader.connect(bassRoute);
  bassRoute.connect(masterGainNode);

  pianoInput.connect(pianoFader);
  pianoFader.connect(pianoRoute);
  pianoRoute.connect(masterGainNode);

  masterGainNode.connect(outputNode);

  function applyMixerState(mixerState) {
    const drumSolo = Boolean(mixerState.drumSolo);
    const bassSolo = Boolean(mixerState.bassSolo);
    const pianoSolo = Boolean(mixerState.pianoSolo);
    const hasSolo = drumSolo || bassSolo || pianoSolo;

    const drumEnabled = hasSolo ? drumSolo : !Boolean(mixerState.drumMute);
    const bassEnabled = hasSolo ? bassSolo : !Boolean(mixerState.bassMute);
    const pianoEnabled = hasSolo ? pianoSolo : !Boolean(mixerState.pianoMute);

    drumFader.gain.setValueAtTime(clamp(Number(mixerState.drumGain) || 0, 0, 1), audioContext.currentTime);
    bassFader.gain.setValueAtTime(clamp(Number(mixerState.bassGain) || 0, 0, 1), audioContext.currentTime);
    pianoFader.gain.setValueAtTime(clamp(Number(mixerState.pianoGain) || 0, 0, 1), audioContext.currentTime);
    drumRoute.gain.setValueAtTime(drumEnabled ? 1 : 0, audioContext.currentTime);
    bassRoute.gain.setValueAtTime(bassEnabled ? 1 : 0, audioContext.currentTime);
    pianoRoute.gain.setValueAtTime(pianoEnabled ? 1 : 0, audioContext.currentTime);
  }

  return {
    applyMixerState,
    getNodes() {
      return {
        masterGainNode,
        drumInput,
        bassInput,
        pianoInput
      };
    }
  };
}
