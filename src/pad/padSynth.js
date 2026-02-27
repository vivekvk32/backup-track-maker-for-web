function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (Number(midi) - 69) / 12);
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

export function createPadSynth({ audioContext, outputNode, irUrl = "/ir/small-hall.wav" }) {
  const dryGain = audioContext.createGain();
  const reverbSendGain = audioContext.createGain();
  const reverbReturnGain = audioContext.createGain();
  let convolver = null;
  let irLoaded = false;
  const activeVoices = new Set();

  dryGain.gain.setValueAtTime(1, audioContext.currentTime);
  reverbSendGain.gain.setValueAtTime(0.18, audioContext.currentTime);
  reverbReturnGain.gain.setValueAtTime(0.35, audioContext.currentTime);

  dryGain.connect(outputNode);
  reverbSendGain.connect(reverbReturnGain);
  reverbReturnGain.connect(outputNode);

  async function loadImpulseResponse() {
    if (irLoaded || !irUrl) {
      return irLoaded;
    }

    try {
      const response = await fetch(irUrl);
      if (!response.ok) {
        return false;
      }
      const arrayBuffer = await response.arrayBuffer();
      const impulse = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      convolver = audioContext.createConvolver();
      convolver.buffer = impulse;
      reverbSendGain.disconnect();
      reverbSendGain.connect(convolver);
      convolver.connect(reverbReturnGain);
      irLoaded = true;
      return true;
    } catch {
      irLoaded = false;
      return false;
    }
  }

  function scheduleVoice({
    midi,
    startTime,
    duration,
    velocity,
    settings,
    panOffset = 0
  }) {
    const gainNode = audioContext.createGain();
    const filterNode = audioContext.createBiquadFilter();
    filterNode.type = "lowpass";
    const attackMs = clamp(Number(settings.attackMs) || 180, 1, 3000);
    const releaseMs = clamp(Number(settings.releaseMs) || 900, 1, 5000);
    const detuneCents = clamp(Number(settings.detuneCents) || 0, 0, 60);
    const cutoff = clamp(Number(settings.filterCutoffHz) || 2200, 80, 20000);
    const reverbSend = clamp(Number(settings.reverbSend) || 0, 0, 1);
    const vibratoDepth = clamp(Number(settings.vibratoDepth) || 0, 0, 80);
    const vibratoRateHz = clamp(Number(settings.vibratoRateHz) || 4, 0.1, 12);
    const safeVelocity = clamp(Number(velocity) || 0.72, 0.02, 1);
    const frequency = midiToFrequency(midi);
    const attack = attackMs / 1000;
    const release = releaseMs / 1000;
    const safeDuration = Math.max(0.03, Number(duration) || 0.5);
    const releaseStart = startTime + safeDuration;
    const stopTime = releaseStart + release + 0.08;

    const panNode =
      typeof audioContext.createStereoPanner === "function"
        ? audioContext.createStereoPanner()
        : null;

    const preOutNode = panNode || filterNode;
    if (panNode) {
      panNode.pan.setValueAtTime(clamp(panOffset, -1, 1), startTime);
      filterNode.connect(panNode);
    }

    const sendNode = audioContext.createGain();
    sendNode.gain.setValueAtTime(reverbSend, startTime);

    filterNode.frequency.setValueAtTime(cutoff, startTime);
    filterNode.Q.setValueAtTime(0.6, startTime);
    gainNode.gain.cancelScheduledValues(startTime);
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.linearRampToValueAtTime(safeVelocity, startTime + attack);
    gainNode.gain.setValueAtTime(safeVelocity, releaseStart);
    gainNode.gain.linearRampToValueAtTime(0.0001, stopTime);

    const voice = {
      oscillators: [],
      lfoOsc: null,
      lfoGain: null,
      gainNode,
      filterNode,
      panNode,
      sendNode,
      stopTime
    };
    activeVoices.add(voice);

    filterNode.connect(gainNode);
    gainNode.connect(preOutNode);
    preOutNode.connect(dryGain);
    preOutNode.connect(sendNode);
    sendNode.connect(reverbSendGain);

    const oscDetunes = [-detuneCents, 0, detuneCents];
    for (const cents of oscDetunes) {
      const osc = audioContext.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(frequency, startTime);
      osc.detune.setValueAtTime(cents, startTime);
      osc.connect(filterNode);
      osc.start(startTime);
      osc.stop(stopTime + 0.05);
      voice.oscillators.push(osc);
    }

    if (vibratoDepth > 0.01) {
      const lfoOsc = audioContext.createOscillator();
      const lfoGain = audioContext.createGain();
      lfoOsc.type = "sine";
      lfoOsc.frequency.setValueAtTime(vibratoRateHz, startTime);
      lfoGain.gain.setValueAtTime(vibratoDepth, startTime);
      lfoOsc.connect(lfoGain);
      for (const osc of voice.oscillators) {
        lfoGain.connect(osc.detune);
      }
      lfoOsc.start(startTime);
      lfoOsc.stop(stopTime + 0.05);
      voice.lfoOsc = lfoOsc;
      voice.lfoGain = lfoGain;
    }

    const cleanupAt = Math.max(0, (stopTime - audioContext.currentTime) * 1000 + 40);
    setTimeout(() => {
      activeVoices.delete(voice);
      try {
        gainNode.disconnect();
      } catch {}
      try {
        filterNode.disconnect();
      } catch {}
      try {
        sendNode.disconnect();
      } catch {}
      if (panNode) {
        try {
          panNode.disconnect();
        } catch {}
      }
      if (voice.lfoGain) {
        try {
          voice.lfoGain.disconnect();
        } catch {}
      }
    }, cleanupAt);
  }

  function scheduleChord({ midiNotes, startTime, duration, velocity, settings, trackVolume = 1 }) {
    if (!Array.isArray(midiNotes) || !midiNotes.length) {
      return;
    }
    const humanizeVelocity = Boolean(settings?.humanize?.velocity);
    const humanizeTiming = Boolean(settings?.humanize?.timing);
    const safeDuration = Math.max(0.08, Number(duration) || 0.9);
    for (let index = 0; index < midiNotes.length; index += 1) {
      const midi = Math.round(Number(midiNotes[index]) || 60);
      let noteVelocity = clamp((Number(velocity) || 0.72) * Number(trackVolume || 1), 0.02, 1);
      let noteStart = Number(startTime);
      if (humanizeVelocity) {
        noteVelocity = clamp(noteVelocity * (1 + randomRange(-0.04, 0.04)), 0.02, 1);
      }
      if (humanizeTiming) {
        noteStart += randomRange(-0.0045, 0.0045);
      }
      const panWidth = clamp(Number(settings?.detuneCents) || 0, 0, 60) / 60;
      const spread = midiNotes.length <= 1 ? 0 : (index / (midiNotes.length - 1)) * 2 - 1;
      scheduleVoice({
        midi,
        startTime: noteStart,
        duration: safeDuration,
        velocity: noteVelocity,
        settings,
        panOffset: spread * panWidth * 0.55
      });
    }
  }

  function allNotesOff() {
    const now = audioContext.currentTime;
    for (const voice of activeVoices) {
      try {
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setTargetAtTime(0.0001, now, 0.02);
      } catch {}
      for (const osc of voice.oscillators) {
        try {
          osc.stop(now + 0.04);
        } catch {}
      }
      if (voice.lfoOsc) {
        try {
          voice.lfoOsc.stop(now + 0.04);
        } catch {}
      }
    }
    activeVoices.clear();
  }

  function dispose() {
    allNotesOff();
    try {
      dryGain.disconnect();
    } catch {}
    try {
      reverbSendGain.disconnect();
    } catch {}
    try {
      reverbReturnGain.disconnect();
    } catch {}
    if (convolver) {
      try {
        convolver.disconnect();
      } catch {}
      convolver = null;
    }
  }

  return {
    loadImpulseResponse,
    scheduleChord,
    allNotesOff,
    dispose
  };
}
