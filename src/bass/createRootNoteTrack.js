import { normalizeNoteName, rootNoteToMidi } from "./rootNoteUtils";
import { getSegmentForStep } from "../harmony/harmonyGenerator";
import { getChordIntervals } from "../piano/chordUtils";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

const RHYTHM_PATTERNS = {
  root8ths: {
    stepOffsets: [0, 2, 4, 6],
    events: [
      { mode: "anchor", fallbackInterval: 0 },
      { mode: "anchor", fallbackInterval: 0 },
      { mode: "anchor", fallbackInterval: 0 },
      { mode: "anchor", fallbackInterval: 0 }
    ],
    velocities: [0.84, 0.8, 0.84, 0.8]
  },
  rootFifth: {
    stepOffsets: [0, 2, 4, 6],
    events: [
      { mode: "anchor", fallbackInterval: 0 },
      { mode: "chord", toneIndex: 2, fallbackInterval: 7 },
      { mode: "anchor", fallbackInterval: 0 },
      { mode: "chord", toneIndex: 2, fallbackInterval: 7 }
    ],
    velocities: [0.84, 0.8, 0.84, 0.8]
  },
  octave: {
    stepOffsets: [0, 2, 4, 6],
    events: [
      { mode: "anchor", fallbackInterval: 0 },
      { mode: "anchor", fallbackInterval: 12 },
      { mode: "anchor", fallbackInterval: 0 },
      { mode: "anchor", fallbackInterval: 12 }
    ],
    velocities: [0.86, 0.78, 0.86, 0.78]
  },
  walking: {
    stepOffsets: [0, 2, 4, 6],
    events: [
      { mode: "anchor", fallbackInterval: 0 },
      { mode: "chord", toneIndex: 1, fallbackInterval: 4 },
      { mode: "chord", toneIndex: 2, fallbackInterval: 7 },
      { mode: "chord", toneIndex: 3, fallbackInterval: 12 }
    ],
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

function getPatternEventIndex(pattern, localStep) {
  const idx = pattern.stepOffsets.indexOf(localStep);
  return idx >= 0 ? idx : -1;
}

function liftIntoReliableRange(midi, minReliableMidi) {
  let nextMidi = clamp(Math.round(Number(midi) || 48), 24, 108);
  if (minReliableMidi === null || minReliableMidi === undefined) {
    return nextMidi;
  }
  while (nextMidi < minReliableMidi && nextMidi + 12 <= 108) {
    nextMidi += 12;
  }
  return clamp(nextMidi, 24, 108);
}

function resolveChordToneMidi(segment, event, baseOctave) {
  const safeEvent = event && typeof event === "object" ? event : {};
  const anchorNote = normalizeNoteName(segment?.bass || segment?.root || "C", "C");
  const anchorMidi = rootNoteToMidi(anchorNote, baseOctave);

  if (safeEvent.mode !== "chord" || !segment?.quality) {
    return anchorMidi + (Number(safeEvent.fallbackInterval) || 0);
  }

  const intervals = getChordIntervals(segment.quality);
  if (!intervals.length) {
    return anchorMidi + (Number(safeEvent.fallbackInterval) || 0);
  }

  const rawToneIndex = Math.max(0, Math.round(Number(safeEvent.toneIndex) || 0));
  const intervalIndex = rawToneIndex % intervals.length;
  const octaveLift = Math.floor(rawToneIndex / intervals.length) * 12;
  const rootMidi = rootNoteToMidi(segment.root || anchorNote, baseOctave);
  return rootMidi + intervals[intervalIndex] + octaveLift;
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
    if (!cell || (cell.type !== "note" && cell.kind !== "note" && cell.kind !== "chord")) {
      return;
    }

    const segment = getSegmentForStep(cell, stepInBar);
    if (!segment) {
      return;
    }

    const localStepInHalf = segment.stepOffsetInSegment % 8;
    const settings = state.trackSettings?.[track.id] || state[settingsKey] || {};
    const pattern = RHYTHM_PATTERNS[settings.rhythmPreset] || RHYTHM_PATTERNS.root8ths;
    const eventIndex = getPatternEventIndex(pattern, localStepInHalf);
    if (eventIndex < 0) {
      return;
    }

    const event = pattern.events[eventIndex] || pattern.events[0] || { fallbackInterval: 0 };
    const midi = liftIntoReliableRange(
      resolveChordToneMidi(segment, event, baseOctave),
      minReliableMidi
    );

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
