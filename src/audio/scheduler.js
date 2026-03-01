const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_TIME = 0.12;
const DAW_STEPS_PER_BAR = 16;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeStepsPerBar(value) {
  const numeric = Number(value);
  if ([4, 8, 16, 32].includes(numeric)) {
    return numeric;
  }
  return 16;
}

function normalizeTimeSignature(value) {
  const source = value && typeof value === "object" ? value : {};
  const beatsPerBar = clamp(Math.round(Number(source.beatsPerBar) || 4), 1, 16);
  const beatUnitRaw = Math.round(Number(source.beatUnit) || 4);
  const beatUnit = [2, 3, 4, 8, 16].includes(beatUnitRaw) ? beatUnitRaw : 4;
  return {
    beatsPerBar,
    beatUnit
  };
}

function getDrumStepDurationSeconds({ bpm, stepsPerBar, timeSignature }) {
  const beatsPerBar = clamp(Math.round(Number(timeSignature?.beatsPerBar) || 4), 1, 16);
  const beatUnitRaw = Math.round(Number(timeSignature?.beatUnit) || 4);
  const beatUnit = [2, 3, 4, 8, 16].includes(beatUnitRaw) ? beatUnitRaw : 4;
  const barSeconds = (60 / bpm) * beatsPerBar * (4 / beatUnit);
  return barSeconds / Math.max(1, stepsPerBar);
}

function getPlaybackWindow(transport) {
  const context = transport.playContext === "daw" ? "daw" : "drums";

  if (context === "daw") {
    const arrangementBars = clamp(Math.round(Number(transport.arrangementBars) || 64), 8, 256);
    const loopRange = transport.loopRange || {};

    if (loopRange.enabled) {
      const startBar = clamp(Math.round(Number(loopRange.startBar) || 0), 0, arrangementBars - 1);
      const endBar = clamp(Math.round(Number(loopRange.endBar) || arrangementBars - 1), 0, arrangementBars - 1);
      const safeEnd = endBar < startBar ? startBar : endBar;
      return {
        context,
        barOffset: startBar,
        stepsPerBar: DAW_STEPS_PER_BAR,
        timeSignature: { beatsPerBar: 4, beatUnit: 4 },
        totalSteps: Math.max(DAW_STEPS_PER_BAR, (safeEnd - startBar + 1) * DAW_STEPS_PER_BAR)
      };
    }

    return {
      context,
      barOffset: 0,
      stepsPerBar: DAW_STEPS_PER_BAR,
      timeSignature: { beatsPerBar: 4, beatUnit: 4 },
      totalSteps: Math.max(DAW_STEPS_PER_BAR, arrangementBars * DAW_STEPS_PER_BAR)
    };
  }

  const loopBars = [1, 2, 4].includes(Number(transport.loopBars)) ? Number(transport.loopBars) : 1;
  const stepsPerBar = normalizeStepsPerBar(transport.stepsPerBar);
  const timeSignature = normalizeTimeSignature(transport.timeSignature);
  return {
    context: "drums",
    barOffset: 0,
    stepsPerBar,
    timeSignature,
    totalSteps: Math.max(stepsPerBar, loopBars * stepsPerBar)
  };
}

export function createScheduler({ audioContext, getState, onScheduleStep, onStep, onStop }) {
  let timerId = null;
  let running = false;
  let nextNoteTime = 0;
  let currentStep = 0;
  let stopAtTime = Number.POSITIVE_INFINITY;
  const pendingVisualTimeouts = new Set();

  function clearTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function clearVisualTimeouts() {
    for (const timeoutId of pendingVisualTimeouts) {
      clearTimeout(timeoutId);
    }
    pendingVisualTimeouts.clear();
  }

  function queueVisualStep(payload) {
    if (!onStep) {
      return;
    }

    const delayMs = Math.max(0, (payload.stepTime - audioContext.currentTime) * 1000);
    const timeoutId = setTimeout(() => {
      pendingVisualTimeouts.delete(timeoutId);
      onStep(payload);
    }, delayMs);
    pendingVisualTimeouts.add(timeoutId);
  }

  function scheduleStep(stepIndex, baseStepTime, stepSeconds) {
    const state = getState();
    const transport = state.transport;
    const swingPercent = clamp(Number(transport.swingPercent) || 0, 0, 60);
    const swingOffset = stepIndex % 2 === 1 ? (swingPercent / 100) * stepSeconds : 0;
    const stepTime = baseStepTime + swingOffset;

    if (stepTime >= stopAtTime) {
      return;
    }

    const window = getPlaybackWindow(transport);
    const stepInLoop = stepIndex % window.totalSteps;
    const stepInBar = stepInLoop % window.stepsPerBar;
    const currentBarIndex = window.barOffset + Math.floor(stepInLoop / window.stepsPerBar);

    const payload = {
      stepIndex,
      stepInLoop,
      stepInBar,
      currentBarIndex,
      context: window.context,
      stepsPerBar: window.stepsPerBar,
      timeSignature: window.timeSignature,
      stepTime,
      sixteenthSeconds: stepSeconds
    };

    if (onScheduleStep) {
      onScheduleStep(payload);
    }

    queueVisualStep(payload);
  }

  function internalStop(reason) {
    if (!running) {
      return;
    }

    running = false;
    clearTimer();
    clearVisualTimeouts();

    if (onStop) {
      onStop(reason);
    }
  }

  function schedulerLoop() {
    if (!running) {
      return;
    }

    const now = audioContext.currentTime;
    while (nextNoteTime < now + SCHEDULE_AHEAD_TIME) {
      if (nextNoteTime >= stopAtTime) {
        internalStop("auto");
        return;
      }

      const state = getState();
      const bpm = clamp(Number(state.transport.bpm) || 120, 30, 300);
      const window = getPlaybackWindow(state.transport);
      const stepDurationSeconds =
        window.context === "daw"
          ? (60 / bpm) / 4
          : getDrumStepDurationSeconds({
              bpm,
              stepsPerBar: window.stepsPerBar,
              timeSignature: window.timeSignature
            });

      scheduleStep(currentStep, nextNoteTime, stepDurationSeconds);
      nextNoteTime += stepDurationSeconds;
      currentStep = (currentStep + 1) % window.totalSteps;
    }
  }

  return {
    start() {
      if (running) {
        return;
      }

      const state = getState();
      const minutes = Math.max(1, Number(state.transport.trackMinutes) || 4);

      running = true;
      currentStep = 0;
      nextNoteTime = audioContext.currentTime + 0.03;
      stopAtTime = nextNoteTime + minutes * 60;

      timerId = setInterval(schedulerLoop, LOOKAHEAD_MS);
    },

    stop() {
      internalStop("manual");
    },

    isRunning() {
      return running;
    }
  };
}
