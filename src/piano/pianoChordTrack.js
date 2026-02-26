import { TRACK_IDS } from "../daw/transportStore";
import { chooseSmartVoicing, normalizeChordData } from "./chordUtils";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

const STYLE_STEP_OFFSETS = {
  block: [0, 4],
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
    state.tracks.find((track) => track.type === "instrument") ||
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

function getChordForStep(barData, stepInBar) {
  const source = barData && typeof barData === "object" ? barData : null;
  if (!source) {
    return null;
  }

  if (source.type === "split") {
    if (stepInBar < 8) {
      return {
        chord: normalizeChordData(source.firstHalf, "C"),
        half: 0,
        localStep: stepInBar
      };
    }
    return {
      chord: normalizeChordData(source.secondHalf, "G"),
      half: 1,
      localStep: stepInBar - 8
    };
  }

  return {
    chord: normalizeChordData(source.chord, "C"),
    half: null,
    localStep: stepInBar
  };
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

export function createPianoChordTrack({ sf2Player, store }) {
  let previousVoicing = null;
  let activeChordKey = "";
  let activeVoicing = null;

  function resetArrangementState() {
    previousVoicing = null;
    activeChordKey = "";
    activeVoicing = null;
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
    if (!cell || cell.kind !== "chord") {
      return;
    }

    const chordPayload = getChordForStep(cell.data, stepInBar);
    if (!chordPayload) {
      return;
    }

    const settings = state.pianoSettings || {};
    const style = Object.prototype.hasOwnProperty.call(STYLE_STEP_OFFSETS, settings.playStyle)
      ? settings.playStyle
      : "block";
    const stepOffsets = STYLE_STEP_OFFSETS[style] || STYLE_STEP_OFFSETS.block;
    const eventIndex = stepOffsets.indexOf(chordPayload.localStep % 8);
    if (eventIndex < 0) {
      return;
    }

    const chordKey = `${currentBarIndex}:${chordPayload.half ?? "full"}:${chordPayload.chord.symbol}`;
    if (chordKey !== activeChordKey || !Array.isArray(activeVoicing) || !activeVoicing.length) {
      activeVoicing = chooseSmartVoicing(chordPayload.chord, previousVoicing, {
        minMidi: 55,
        maxMidi: 79
      });
      activeChordKey = chordKey;
      previousVoicing = activeVoicing;
    }

    if (!activeVoicing || !activeVoicing.length) {
      return;
    }

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
      for (const midi of activeVoicing) {
        let velocity = baseVelocity;
        if (humanizeVelocity) {
          velocity = clamp(velocity * (1 + randomRange(-0.05, 0.05)), 0.08, 1);
        }
        sf2Player.playSf2Note(midi, velocity, startTime, durationSeconds);
      }
      return;
    }

    const arpOrder = getArpOrder(style, activeVoicing);
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
