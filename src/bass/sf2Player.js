import { createSoundFont2SynthNode } from "sf2-synth-audio-worklet";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const LOAD_TIMEOUT_MS = 120000;
let sf2LoadQueue = Promise.resolve();
let cachedProcessorModuleUrl = "";
let addModulePatched = false;
let originalAudioWorkletAddModule = null;

function runInSf2LoadQueue(task) {
  const next = sf2LoadQueue.then(task, task);
  sf2LoadQueue = next.catch(() => {});
  return next;
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  });
}

function isDuplicateWorkletRegistrationError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || error || "").toLowerCase();
  if (!message) {
    return false;
  }
  const duplicateHint =
    message.includes("already") &&
    (message.includes("register") ||
      message.includes("registered") ||
      message.includes("exists") ||
      message.includes("defined"));
  return name === "NotSupportedError" ? duplicateHint : duplicateHint;
}

async function createSynthNodeSafe(audioContext, sf2Url) {
  if (
    !addModulePatched &&
    typeof AudioWorklet !== "undefined" &&
    AudioWorklet?.prototype?.addModule
  ) {
    try {
      originalAudioWorkletAddModule = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = async function patchedAddModule(...args) {
        try {
          return await originalAudioWorkletAddModule.apply(this, args);
        } catch (error) {
          if (isDuplicateWorkletRegistrationError(error)) {
            return undefined;
          }
          throw error;
        }
      };
      addModulePatched = true;
    } catch {
      addModulePatched = false;
    }
  }

  const originalCreateObjectUrl =
    typeof URL !== "undefined" && URL?.createObjectURL
      ? URL.createObjectURL.bind(URL)
      : null;
  let createObjectUrlPatched = false;

  try {
    if (originalCreateObjectUrl) {
      URL.createObjectURL = (obj) => {
        const mime = String(obj?.type || "").toLowerCase();
        if (mime.includes("javascript")) {
          if (cachedProcessorModuleUrl) {
            return cachedProcessorModuleUrl;
          }
          cachedProcessorModuleUrl = originalCreateObjectUrl(obj);
          return cachedProcessorModuleUrl;
        }
        return originalCreateObjectUrl(obj);
      };
      createObjectUrlPatched = true;
    }

    return await withTimeout(
      createSoundFont2SynthNode(audioContext, sf2Url),
      LOAD_TIMEOUT_MS,
      "SF2 load"
    );
  } finally {
    if (createObjectUrlPatched && originalCreateObjectUrl) {
      URL.createObjectURL = originalCreateObjectUrl;
    }
  }
}

function findPreset(headers, presetKeywords) {
  if (!Array.isArray(headers)) {
    return { preset: null, matchedKeyword: false };
  }

  const keywords = Array.isArray(presetKeywords)
    ? presetKeywords.map((item) => String(item || "").toLowerCase()).filter(Boolean)
    : [];

  if (keywords.length > 0) {
    const byKeyword = headers.find((header) => {
      const name = String(header?.name || "").toLowerCase();
      return keywords.some((keyword) => name.includes(keyword));
    });
    if (byKeyword) {
      return { preset: byKeyword, matchedKeyword: true };
    }
  }

  return { preset: headers[0] || null, matchedKeyword: false };
}

export function createSf2Player({
  audioContext,
  outputNode,
  presetKeywords = [],
  testMidi = 40
}) {
  let synthNode = null;
  let status = "idle";
  let error = "";
  let selectedPresetName = "";
  let lastLoadedUrl = "";
  let loadGeneration = 0;

  const outputGain = audioContext.createGain();
  const lowpass = audioContext.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(20000, audioContext.currentTime);
  outputGain.gain.setValueAtTime(1.8, audioContext.currentTime);

  lowpass.connect(outputGain);
  outputGain.connect(outputNode);

  function disconnectCurrentNode() {
    if (!synthNode) {
      return;
    }
    try {
      synthNode.disconnect();
    } catch {
      // Ignore disconnect errors for a stale node.
    }
    synthNode = null;
  }

  async function load({ sf2Url }) {
    const safeUrl = String(sf2Url || "").trim();
    if (!safeUrl) {
      status = "error";
      error = "Missing SF2 URL";
      return false;
    }
    if (isReady() && lastLoadedUrl === safeUrl) {
      return true;
    }

    const myGeneration = ++loadGeneration;
    status = "loading";
    error = "";
    selectedPresetName = "";
    disconnectCurrentNode();

    try {
      const node = await runInSf2LoadQueue(() => createSynthNodeSafe(audioContext, safeUrl));
      if (myGeneration !== loadGeneration) {
        try {
          node.disconnect();
        } catch {
          // ignore stale disconnect
        }
        status = "idle";
        error = "Load cancelled";
        return false;
      }

      node.connect(lowpass);
      synthNode = node;
      node.onprocessorerror = () => {
        status = "error";
        error = "SF2 processor crashed. Try another SF2 file.";
        disconnectCurrentNode();
      };

      try {
        const headers = await withTimeout(node.getPresetHeaders(), 5000, "Preset scan");
        const { preset: selected } = findPreset(headers, presetKeywords);
        if (selected) {
          selectedPresetName = String(selected.name || "").trim();
          node.setProgram(0, Number(selected.bank) || 0, Number(selected.preset) || 0);
        }
      } catch {
        // Program selection is optional; keep default program.
      }

      status = "ready";
      error = "";
      lastLoadedUrl = safeUrl;
      return true;
    } catch (loadError) {
      status = "error";
      error = String(loadError?.message || loadError);
      lastLoadedUrl = "";
      return false;
    }
  }

  function isReady() {
    return status === "ready" && Boolean(synthNode);
  }

  function getStatus() {
    return { status, error, presetName: selectedPresetName };
  }

  function getDebugState() {
    return {
      status,
      error,
      presetName: selectedPresetName,
      ready: isReady(),
      hasNode: Boolean(synthNode)
    };
  }

  function playSf2Note(midiNote, velocity01, startTime, durationSeconds) {
    if (!isReady()) {
      return;
    }
    const safeMidi = clamp(Math.round(Number(midiNote) || 48), 0, 127);
    const safeVelocity = clamp(Number(velocity01) || 0.8, 0.01, 1);
    const safeDuration = Math.max(0.02, Number(durationSeconds) || 0.12);
    const delaySeconds = Math.max(0, Number(startTime) - audioContext.currentTime);
    const offDelaySeconds = delaySeconds + safeDuration;

    const midiVelocity = clamp(Math.round(safeVelocity * 127), 1, 127);
    synthNode.noteOn(0, safeMidi, midiVelocity, delaySeconds);
    synthNode.noteOff(0, safeMidi, offDelaySeconds);
  }

  function playTestNote() {
    playSf2Note(testMidi, 0.85, audioContext.currentTime + 0.01, 0.35);
  }

  function allNotesOff() {
    if (!synthNode) {
      return;
    }
    for (let midi = 24; midi <= 96; midi += 1) {
      synthNode.noteOff(0, midi, 0);
    }
  }

  function setOutputGain(value) {
    outputGain.gain.setValueAtTime(clamp(Number(value) || 0, 0, 3), audioContext.currentTime);
  }

  function setLowpassEnabled(enabled) {
    const frequency = enabled ? 3400 : 20000;
    lowpass.frequency.setValueAtTime(frequency, audioContext.currentTime);
  }

  function dispose() {
    allNotesOff();
    disconnectCurrentNode();
    lastLoadedUrl = "";
  }

  return {
    load,
    isReady,
    getStatus,
    getDebugState,
    playSf2Note,
    playTestNote,
    allNotesOff,
    setOutputGain,
    setLowpassEnabled,
    dispose
  };
}
