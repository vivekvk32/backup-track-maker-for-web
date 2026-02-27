import { buildHarmonyMidi, getSegmentForStep } from "../harmony/harmonyGenerator";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

export function createPadTrack({ padSynth, store }) {
  function scheduleArrangementStep({ currentBarIndex, stepInBar, stepTime, sixteenthSeconds }) {
    const state = store.getState();
    const padTracks = state.tracks.filter((track) => track.engine === "pad_synth");
    if (!padTracks.length) {
      return;
    }

    for (const track of padTracks) {
      if (!isTrackAudible(state, track)) {
        continue;
      }
      const cell = state.arrangement?.[track.id]?.[currentBarIndex];
      if (!cell || cell.type !== "note") {
        continue;
      }
      const settings = state.trackSettings?.[track.id];
      if (!settings) {
        continue;
      }
      const segment = getSegmentForStep(cell, stepInBar);
      if (!segment || !segment.isStart) {
        continue;
      }
      const midiNotes = buildHarmonyMidi(segment.root, settings);
      if (!midiNotes.length) {
        continue;
      }
      const duration = Math.max(0.12, sixteenthSeconds * segment.segmentSixteenths);
      const baseVelocity = clamp(Number(track.volume) * 0.78, 0.04, 1);
      padSynth.scheduleChord({
        midiNotes,
        startTime: stepTime,
        duration,
        velocity: baseVelocity,
        settings,
        trackVolume: track.volume
      });
    }
  }

  return {
    scheduleArrangementStep
  };
}
