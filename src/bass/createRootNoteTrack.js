import { normalizeNoteName, rootNoteToMidi } from "./rootNoteUtils";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

const RHYTHM_PATTERNS = {
  root8ths: {
    stepOffsets: [0, 2, 4, 6],
    intervals: [0, 0, 0, 0],
    velocities: [0.84, 0.8, 0.84, 0.8]
  },
  rootFifth: {
    stepOffsets: [0, 2, 4, 6],
    intervals: [0, 7, 0, 7],
    velocities: [0.84, 0.8, 0.84, 0.8]
  },
  octave: {
    stepOffsets: [0, 2, 4, 6],
    intervals: [0, 12, 0, 12],
    velocities: [0.86, 0.78, 0.86, 0.78]
  },
  walking: {
    stepOffsets: [0, 2, 4, 6],
    intervals: [0, 4, 7, 4],
    velocities: [0.82, 0.8, 0.84, 0.8]
  }
};

function getTrack(state, { trackId, trackType }) {
  if (trackId) {
    const byId = state.tracks.find((track) => track.id === trackId);
    if (byId) {
      return byId;
    }
  }
  return state.tracks.find((track) => track.type === trackType) || null;
}

function isTrackAudible(state, track) {
  if (!track) {
    return false;
  }

  const hasSolo = state.tracks.some((item) => Boolean(item.solo));
  if (hasSolo) {
    return Boolean(track.solo);
  }
  return !Boolean(track.mute);
}

function getNoteForStep(noteData, stepInBar) {
  if (!noteData || typeof noteData !== "object") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(noteData, "root")) {
    if (noteData.split && stepInBar >= 8) {
      return normalizeNoteName(noteData.secondRoot || noteData.root || "G", "G");
    }
    return normalizeNoteName(noteData.root || "C", "C");
  }

  if (noteData.type === "split") {
    if (stepInBar < 8) {
      return normalizeNoteName(noteData.firstHalf || "C", "C");
    }
    return normalizeNoteName(noteData.secondHalf || "G", "G");
  }

  return normalizeNoteName(noteData.note || "C", "C");
}

function getPatternEventIndex(pattern, localStep) {
  const idx = pattern.stepOffsets.indexOf(localStep);
  return idx >= 0 ? idx : -1;
}

export function createRootNoteTrack({
  sf2Player,
  store,
  trackType,
  trackId,
  settingsKey,
  baseOctave,
  minReliableMidi = null
}) {
  function scheduleArrangementStep({ currentBarIndex, stepInBar, stepTime, sixteenthSeconds }) {
    if (!sf2Player.isReady()) {
      return;
    }

    const state = store.getState();
    const track = getTrack(state, { trackId, trackType });
    if (!track || !isTrackAudible(state, track)) {
      return;
    }

    const cell = state.arrangement?.[track.id]?.[currentBarIndex];
    if (!cell || (cell.type !== "note" && cell.kind !== "note")) {
      return;
    }

    const localStepInHalf = stepInBar % 8;
    const settings = state.trackSettings?.[track.id] || state[settingsKey] || {};
    const pattern = RHYTHM_PATTERNS[settings.rhythmPreset] || RHYTHM_PATTERNS.root8ths;
    const eventIndex = getPatternEventIndex(pattern, localStepInHalf);
    if (eventIndex < 0) {
      return;
    }

    const noteName = getNoteForStep(cell.data || cell, stepInBar);
    if (!noteName) {
      return;
    }

    const interval = Number(pattern.intervals[eventIndex]) || 0;
    const baseMidi = rootNoteToMidi(noteName, baseOctave);
    const octaveLift = minReliableMidi !== null && baseMidi < minReliableMidi ? 12 : 0;
    const midi = clamp(baseMidi + octaveLift + interval, 24, 108);

    let velocity = clamp((Number(pattern.velocities[eventIndex]) || 0.82) * track.volume, 0.1, 1);
    let startTime = stepTime;

    if (settings?.humanize?.velocity) {
      velocity = clamp(velocity * (1 + randomRange(-0.05, 0.05)), 0.1, 1);
    }
    if (settings?.humanize?.timing) {
      startTime += randomRange(-0.005, 0.005);
    }

    const durationSeconds = Math.max(0.05, sixteenthSeconds * 1.75);
    sf2Player.playSf2Note(midi, velocity, startTime, durationSeconds);
  }

  return {
    scheduleArrangementStep,
    scheduleStep() {
      // Backward-compatible no-op.
    },
    resizePatternForLoopBars() {
      // Arrangement mode no-op.
    }
  };
}
