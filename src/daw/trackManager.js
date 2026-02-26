import { scheduleClick, shouldTriggerMetronomeStep } from "../audio/metronome";
import { createScheduler } from "../audio/scheduler";
import { resumeAudioContext } from "../audio/context";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cloneCell(cell) {
  if (!cell || typeof cell !== "object") {
    return null;
  }
  return JSON.parse(JSON.stringify(cell));
}

export function createTrackManager({
  audioContext,
  mixer,
  store,
  bassTrack,
  pianoTrack,
  bassSf2Player,
  pianoSf2Player
}) {
  let drumBuffersByPath = new Map();
  const listeners = new Set();
  const mixerNodes = mixer.getNodes();

  function emit(event) {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function getTrackByType(state, type) {
    return state.tracks.find((track) => track.type === type) || null;
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

  function scheduleDrumSample(buffer, atTime, gainValue) {
    const source = audioContext.createBufferSource();
    const laneGain = audioContext.createGain();

    source.buffer = buffer;
    laneGain.gain.setValueAtTime(clamp(Number(gainValue) || 0, 0, 1), atTime);
    source.connect(laneGain);
    laneGain.connect(mixerNodes.drumInput);
    source.start(atTime);
  }

  function scheduleDrumFromLaneMap(state, laneMap, stepIndex, stepTime, trackVolume = 1) {
    const selectedSamples = state.drumPattern.selectedSamples;
    const laneGains = state.drumPattern.laneGains;

    for (const [laneId, steps] of Object.entries(laneMap)) {
      if (!Array.isArray(steps) || !steps[stepIndex]) {
        continue;
      }

      const samplePath = selectedSamples[laneId];
      if (!samplePath) {
        continue;
      }

      const buffer = drumBuffersByPath.get(samplePath);
      if (!buffer) {
        continue;
      }

      const laneVolume = clamp((Number(laneGains[laneId]) || 0) * trackVolume, 0, 1);
      scheduleDrumSample(buffer, stepTime, laneVolume);
    }
  }

  function scheduleDrumStepInDrumsMode(stepInLoop, stepTime) {
    const state = store.getState();
    const drumTrack = getTrackByType(state, "drum");
    if (!isTrackAudible(state, drumTrack)) {
      return;
    }

    const sourceMode = state.drumPattern.sourceMode;
    const laneMap = sourceMode === "fallback" ? state.drumPattern.fallback.lanes : state.drumPattern.lanes;
    scheduleDrumFromLaneMap(state, laneMap, stepInLoop, stepTime, drumTrack.volume);
  }

  function scheduleDrumStepInDawMode(currentBarIndex, stepInBar, stepTime) {
    const state = store.getState();
    const drumTrack = getTrackByType(state, "drum");
    if (!drumTrack || !isTrackAudible(state, drumTrack)) {
      return;
    }

    const cell = state.arrangement?.[drumTrack.id]?.[currentBarIndex];
    if (!cell || cell.kind !== "drum") {
      return;
    }

    const clipRef = String(cell?.data?.clipRef || "shared-main");
    const laneMap =
      state.drumClips?.[clipRef]?.lanes ||
      state.drumClips?.["shared-main"]?.lanes ||
      state.drumPattern.lanes;
    scheduleDrumFromLaneMap(state, laneMap, stepInBar, stepTime, drumTrack.volume);
  }

  function scheduleMetronomeStep(stepInBar, stepTime) {
    const transport = store.getState().transport;
    if (!transport.metronome.enabled) {
      return;
    }

    if (!shouldTriggerMetronomeStep(stepInBar, transport.metronome.subdivision)) {
      return;
    }

    const isAccent = Boolean(transport.metronome.accentBeatOne) && stepInBar === 0;
    scheduleClick(audioContext, stepTime, {
      isAccent,
      volume: clamp(Number(transport.metronome.volume) || 0, 0, 1),
      outputNode: mixerNodes.drumInput
    });
  }

  const scheduler = createScheduler({
    audioContext,
    getState: () => store.getState(),
    onScheduleStep({ context, stepInLoop, stepInBar, currentBarIndex, stepTime, sixteenthSeconds }) {
      if (context === "daw") {
        scheduleDrumStepInDawMode(currentBarIndex, stepInBar, stepTime);
        bassTrack.scheduleArrangementStep({
          currentBarIndex,
          stepInBar,
          stepTime,
          sixteenthSeconds
        });
        pianoTrack.scheduleArrangementStep({
          currentBarIndex,
          stepInBar,
          stepTime,
          sixteenthSeconds
        });
      } else {
        scheduleDrumStepInDrumsMode(stepInLoop, stepTime);
      }

      scheduleMetronomeStep(stepInBar, stepTime);
    },
    onStep(stepPayload) {
      if (stepPayload.context === "daw") {
        store.setUi({
          playheadStep: -1,
          dawPlayhead: {
            barIndex: stepPayload.currentBarIndex,
            stepInBar: stepPayload.stepInBar,
            activeHalf: stepPayload.stepInBar < 8 ? 0 : 1
          }
        });
      } else {
        store.setUi({
          playheadStep: stepPayload.stepInLoop,
          dawPlayhead: {
            barIndex: -1,
            stepInBar: -1,
            activeHalf: null
          }
        });
      }

      emit({
        type: "step",
        payload: cloneCell(stepPayload)
      });
    },
    onStop(reason) {
      if (typeof pianoTrack.resetArrangementState === "function") {
        pianoTrack.resetArrangementState();
      }
      bassSf2Player.allNotesOff();
      pianoSf2Player.allNotesOff();
      store.setTransport({ isPlaying: false });
      store.setUi({
        playheadStep: -1,
        dawPlayhead: {
          barIndex: -1,
          stepInBar: -1,
          activeHalf: null
        }
      });
      emit({ type: "stop", reason });
    }
  });

  function setDrumBuffers(buffersByPath) {
    drumBuffersByPath = buffersByPath instanceof Map ? buffersByPath : new Map();
  }

  async function start({ context = "drums" } = {}) {
    if (scheduler.isRunning()) {
      return;
    }

    await resumeAudioContext();
    if (typeof pianoTrack.resetArrangementState === "function") {
      pianoTrack.resetArrangementState();
    }
    store.setTransport({
      playContext: context === "daw" ? "daw" : "drums",
      isPlaying: true
    });
    scheduler.start();
    emit({ type: "start", context: context === "daw" ? "daw" : "drums" });
  }

  function stop() {
    scheduler.stop();
    if (typeof pianoTrack.resetArrangementState === "function") {
      pianoTrack.resetArrangementState();
    }
    bassSf2Player.allNotesOff();
    pianoSf2Player.allNotesOff();
  }

  function setPlaying(isPlaying) {
    if (isPlaying) {
      start({ context: store.getState().transport.playContext || "drums" });
      return;
    }
    stop();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function dispose() {
    stop();
    listeners.clear();
  }

  return {
    start,
    stop,
    setPlaying,
    dispose,
    subscribe,
    setDrumBuffers
  };
}

