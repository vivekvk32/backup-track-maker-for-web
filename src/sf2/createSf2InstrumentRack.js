import { rootNoteToMidi } from "../bass/rootNoteUtils";
import { createSf2Player } from "../bass/sf2Player";
import { getSegmentForStep } from "../harmony/harmonyGenerator";
import { chooseSmartVoicing, normalizeChordData } from "../piano/chordUtils";

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

function fitPlayableRange(midiNotes) {
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

export function createSf2InstrumentRack({ audioContext, outputNode, store }) {
  const entries = new Map();

  function getInstrumentTracks(state = store.getState()) {
    return state.tracks.filter((track) => track.engine === "sf2_track");
  }

  function disposeMissingTracks(state = store.getState()) {
    const activeIds = new Set(getInstrumentTracks(state).map((track) => track.id));
    for (const [trackId, entry] of entries.entries()) {
      if (activeIds.has(trackId)) {
        continue;
      }
      entry.player.dispose();
      entries.delete(trackId);
    }
  }

  function ensureEntry(trackId) {
    const safeTrackId = String(trackId || "");
    if (!safeTrackId) {
      return null;
    }
    if (entries.has(safeTrackId)) {
      return entries.get(safeTrackId);
    }

    const player = createSf2Player({
      audioContext,
      outputNode,
      presetKeywords: [],
      testMidi: 60
    });
    player.setLowpassEnabled(false);

    const entry = {
      player,
      loadPromise: null,
      previousVoicing: null,
      fallbackStatus: "idle",
      fallbackError: ""
    };
    entries.set(safeTrackId, entry);
    return entry;
  }

  function getTrack(trackId, state = store.getState()) {
    const safeTrackId = String(trackId || "");
    return state.tracks.find((track) => track.id === safeTrackId && track.engine === "sf2_track") || null;
  }

  function getTrackPath(trackId, state = store.getState()) {
    return String(state.trackSettings?.[trackId]?.sf2Path || "").trim();
  }

  function applyTrackFx(entry, settings = {}) {
    entry?.player?.setEcho?.({
      mix: settings.echoMix,
      feedback: settings.echoFeedback,
      timeMs: settings.echoTimeMs
    });
  }

  function getTrackStatus(trackId) {
    const entry = entries.get(String(trackId || ""));
    if (!entry) {
      return {
        status: "idle",
        error: "",
        presetName: ""
      };
    }
    const status = entry.player.getStatus();
    return {
      status: status.status || entry.fallbackStatus,
      error: status.error || entry.fallbackError,
      presetName: status.presetName || ""
    };
  }

  function isLoadInFlight(trackId) {
    return Boolean(entries.get(String(trackId || ""))?.loadPromise);
  }

  async function loadTrack(trackId) {
    const state = store.getState();
    disposeMissingTracks(state);
    const track = getTrack(trackId, state);
    if (!track) {
      return false;
    }

    const path = getTrackPath(track.id, state);
    const entry = ensureEntry(track.id);
    applyTrackFx(entry, state.trackSettings?.[track.id] || {});
    if (!path) {
      entry.fallbackStatus = "error";
      entry.fallbackError = "Missing SF2 path";
      return false;
    }

    if (entry.loadPromise) {
      return entry.loadPromise;
    }

    entry.fallbackStatus = "loading";
    entry.fallbackError = "";
    entry.loadPromise = (async () => {
      try {
        const ok = await entry.player.load({ sf2Url: path });
        const status = entry.player.getStatus();
        entry.fallbackStatus = status.status || (ok ? "ready" : "error");
        entry.fallbackError = status.error || "";
        return ok;
      } finally {
        entry.loadPromise = null;
      }
    })();

    return entry.loadPromise;
  }

  async function ensureTracksReady(trackIds) {
    const pendingLoads = [];
    for (const trackId of trackIds) {
      const entry = entries.get(String(trackId || ""));
      if (entry?.player.isReady()) {
        continue;
      }
      pendingLoads.push(loadTrack(trackId));
    }
    if (!pendingLoads.length) {
      return true;
    }
    const results = await Promise.all(pendingLoads);
    return results.every(Boolean);
  }

  function playTestNote(trackId) {
    const entry = entries.get(String(trackId || ""));
    if (!entry?.player.isReady()) {
      return false;
    }
    entry.player.playTestNote();
    return true;
  }

  function buildVoicingRange(settings = {}) {
    const octave = clamp(Math.round(Number(settings.octave) || 4), 2, 5);
    const minMidi = clamp(rootNoteToMidi("C", octave) - 5, 48, 78);
    return {
      minMidi,
      maxMidi: clamp(minMidi + 24, minMidi + 6, 96)
    };
  }

  function buildSegmentVoicing(segment, settings, previousVoicing) {
    if (!segment?.chord) {
      return [];
    }

    const range = buildVoicingRange(settings);
    const voiced = chooseSmartVoicing(
      normalizeChordData(segment.chord, segment.root || "C"),
      previousVoicing,
      range
    );
    return fitPlayableRange(voiced);
  }

  function scheduleArrangementStep({ currentBarIndex, stepInBar, stepTime, sixteenthSeconds }) {
    const state = store.getState();
    disposeMissingTracks(state);

    for (const track of getInstrumentTracks(state)) {
      const entry = entries.get(track.id);
      if (!entry?.player.isReady() || !isTrackAudible(state, track)) {
        continue;
      }

      const cell = state.arrangement?.[track.id]?.[currentBarIndex];
      if (!cell || cell.kind !== "chord") {
        continue;
      }

      const settings = state.trackSettings?.[track.id] || {};
      applyTrackFx(entry, settings);
      const segment = getSegmentForStep(cell, stepInBar);
      if (!segment) {
        continue;
      }

      const style = Object.prototype.hasOwnProperty.call(STYLE_STEP_OFFSETS, settings.playStyle)
        ? settings.playStyle
        : "block";
      const eventOffsets = STYLE_STEP_OFFSETS[style] || STYLE_STEP_OFFSETS.block;
      const localStep = segment.stepOffsetInSegment % 8;
      const eventIndex = eventOffsets.indexOf(localStep);
      if (eventIndex < 0) {
        continue;
      }

      const voicing = buildSegmentVoicing(segment, settings, entry.previousVoicing);
      if (!voicing.length) {
        entry.previousVoicing = null;
        continue;
      }
      entry.previousVoicing = [...voicing];

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
          entry.player.playSf2Note(midi, velocity, startTime, durationSeconds);
        }
        continue;
      }

      const arpOrder = getArpOrder(style, voicing);
      if (!arpOrder.length) {
        continue;
      }

      let velocity = baseVelocity;
      if (humanizeVelocity) {
        velocity = clamp(velocity * (1 + randomRange(-0.05, 0.05)), 0.08, 1);
      }
      entry.player.playSf2Note(
        arpOrder[eventIndex % arpOrder.length],
        velocity,
        startTime,
        durationSeconds
      );
    }
  }

  function resetArrangementState() {
    for (const entry of entries.values()) {
      entry.previousVoicing = null;
    }
  }

  function allNotesOff() {
    for (const entry of entries.values()) {
      entry.player.allNotesOff();
    }
  }

  function dispose() {
    allNotesOff();
    for (const entry of entries.values()) {
      entry.player.dispose();
    }
    entries.clear();
  }

  return {
    loadTrack,
    ensureTracksReady,
    getTrackStatus,
    isLoadInFlight,
    playTestNote,
    scheduleArrangementStep,
    resetArrangementState,
    allNotesOff,
    dispose
  };
}
