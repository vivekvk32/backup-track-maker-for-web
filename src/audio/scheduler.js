const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_TIME = 0.12;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
        totalSteps: Math.max(16, (safeEnd - startBar + 1) * 16)
      };
    }

    return {
      context,
      barOffset: 0,
      totalSteps: Math.max(16, arrangementBars * 16)
    };
  }

  const loopBars = [1, 2, 4].includes(Number(transport.loopBars)) ? Number(transport.loopBars) : 1;
  return {
    context: "drums",
    barOffset: 0,
    totalSteps: Math.max(16, loopBars * 16)
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

  function scheduleStep(stepIndex, baseStepTime, sixteenthSeconds) {
    const state = getState();
    const transport = state.transport;
    const swingPercent = clamp(Number(transport.swingPercent) || 0, 0, 60);
    const swingOffset = stepIndex % 2 === 1 ? (swingPercent / 100) * sixteenthSeconds : 0;
    const stepTime = baseStepTime + swingOffset;

    if (stepTime >= stopAtTime) {
      return;
    }

    const window = getPlaybackWindow(transport);
    const stepInLoop = stepIndex % window.totalSteps;
    const stepInBar = stepInLoop % 16;
    const currentBarIndex = window.barOffset + Math.floor(stepInLoop / 16);

    const payload = {
      stepIndex,
      stepInLoop,
      stepInBar,
      currentBarIndex,
      context: window.context,
      stepTime,
      sixteenthSeconds
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
      const sixteenth = (60 / bpm) / 4;
      scheduleStep(currentStep, nextNoteTime, sixteenth);
      nextNoteTime += sixteenth;

      const window = getPlaybackWindow(state.transport);
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

