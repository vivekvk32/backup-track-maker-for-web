import { TRACK_IDS } from "../daw/transportStore";
import { buildHarmonyMidi, getSegmentForStep } from "../harmony/harmonyGenerator";
import { rootNoteToMidi } from "../bass/rootNoteUtils";
import { chooseSmartVoicing, normalizeChordData } from "./chordUtils";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

const STYLE_STEP_OFFSETS = {
  block: [0],
  stabs8: [0, 2, 4, 6],
  arpUp: [0, 2, 4, 6],
  arpDown: [0, 2, 4, 6],
  arpUpDown: [0, 2, 4, 6]
};

const STYLE_BASE_VELOCITY = {
  block: 0.74,
  stabs8: 0.7,
  arpUp: 0.68,
  arpDown: 0.68,
  arpUpDown: 0.68
};

function getPianoTrack(state) {
  return (
    state.tracks.find((track) => track.id === TRACK_IDS.PIANO) ||
    state.tracks.find((track) => track.engine === "piano_sf2") ||
    null
  );
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

function getArpOrder(style, voicing) {
  if (!Array.isArray(voicing) || voicing.length === 0) {
    return [];
  }

  if (style === "arpDown") {
    return [...voicing].reverse();
  }

  if (style === "arpUpDown") {
    if (voicing.length <= 1) {
      return [...voicing];
    }
    return [...voicing, ...voicing.slice(1, -1).reverse()];
  }

  return [...voicing];
}

function fitPianoRange(midiNotes) {
  if (!Array.isArray(midiNotes)) {
    return [];
  }
  return midiNotes
    .map((note) => {
      let midi = Math.round(Number(note) || 60);
      while (midi < 55) {
        midi += 12;
      }
      while (midi > 84) {
        midi -= 12;
      }
      return clamp(midi, 55, 84);
    })
    .sort((left, right) => left - right);
}

export function createPianoChordTrack({ sf2Player, store }) {
  let previousVoicing = null;

  function getVoicingRange(settings = {}) {
    const octave = clamp(Math.round(Number(settings.octave) || 4), 2, 5);
    const minMidi = clamp(rootNoteToMidi("C", octave) - 5, 48, 78);
    return {
      minMidi,
      maxMidi: clamp(minMidi + 24, minMidi + 6, 96)
    };
  }

  function buildSegmentVoicing(segment, settings) {
    if (segment?.chord) {
      const range = getVoicingRange(settings);
      const voiced = chooseSmartVoicing(
        normalizeChordData(segment.chord, segment.root || "C"),
        previousVoicing,
        range
      );
      return fitPianoRange(voiced);
    }

    return fitPianoRange(buildHarmonyMidi(segment?.root, settings));
  }

  function resetArrangementState() {
    previousVoicing = null;
  }

  function scheduleArrangementStep({ currentBarIndex, stepInBar, stepTime, sixteenthSeconds }) {
    if (!sf2Player.isReady()) {
      return;
    }

    const state = store.getState();
    const track = getPianoTrack(state);
    if (!track || !isTrackAudible(state, track)) {
      return;
    }

    const cell = state.arrangement?.[track.id]?.[currentBarIndex];
    if (!cell || (cell.type !== "note" && cell.kind !== "chord")) {
      return;
    }

    const settings = state.trackSettings?.[track.id] || {};
    const segment = getSegmentForStep(cell, stepInBar);
    if (!segment) {
      return;
    }

    const style = Object.prototype.hasOwnProperty.call(STYLE_STEP_OFFSETS, settings.playStyle)
      ? settings.playStyle
      : "block";
    const eventOffsets = STYLE_STEP_OFFSETS[style] || STYLE_STEP_OFFSETS.block;
    const localStep = segment.stepOffsetInSegment % 8;
    const eventIndex = eventOffsets.indexOf(localStep);
    if (eventIndex < 0) {
      return;
    }

    const voicing = buildSegmentVoicing(segment, settings);
    if (!voicing.length) {
      previousVoicing = null;
      return;
    }
    previousVoicing = [...voicing];

    const humanizeVelocity = Boolean(settings?.humanize?.velocity);
    const humanizeTiming = Boolean(settings?.humanize?.timing);
    let startTime = stepTime;
    if (humanizeTiming) {
      startTime += randomRange(-0.005, 0.005);
    }

    const baseVelocity = clamp((STYLE_BASE_VELOCITY[style] || 0.72) * track.volume, 0.08, 1);
    const durationSeconds =
      style === "stabs8"
        ? Math.max(0.05, sixteenthSeconds * 1.15)
        : Math.max(0.08, sixteenthSeconds * 1.85);

    if (style === "block" || style === "stabs8") {
      for (const midi of voicing) {
        let velocity = baseVelocity;
        if (humanizeVelocity) {
          velocity = clamp(velocity * (1 + randomRange(-0.05, 0.05)), 0.08, 1);
        }
        sf2Player.playSf2Note(midi, velocity, startTime, durationSeconds);
      }
      return;
    }

    const arpOrder = getArpOrder(style, voicing);
    if (!arpOrder.length) {
      return;
    }

    const midi = arpOrder[eventIndex % arpOrder.length];
    let velocity = baseVelocity;
    if (humanizeVelocity) {
      velocity = clamp(velocity * (1 + randomRange(-0.05, 0.05)), 0.08, 1);
    }
    sf2Player.playSf2Note(midi, velocity, startTime, durationSeconds);
  }

  return {
    scheduleArrangementStep,
    resetArrangementState,
    scheduleStep() {
      // compatibility no-op
    },
    resizePatternForLoopBars() {
      // arrangement mode no-op
    }
  };
}
