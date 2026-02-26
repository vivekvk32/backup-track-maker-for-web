import { getAudioNodes, resumeAudioContext, setMasterVolume } from "../audio/context";
import {
  audioBufferToMp3Blob,
  audioBufferToWavBlob,
  downloadBlob,
  renderPatternOffline
} from "../audio/exporter";
import { loadSamples, SAMPLE_CATEGORIES } from "../audio/loader";
import { METRONOME_SUBDIVISIONS } from "../audio/metronome";
import { buildPresetPattern, createEmptyPattern, LANE_IDS, PRESET_NAMES } from "../patterns/presets";
import { createSequencerGrid } from "./grid";

const LANES = [
  { id: "kick", label: "Bass Drum (Kick)", category: "kick", required: true },
  { id: "snare", label: "Snare", category: "snare", required: true },
  { id: "closed_hat", label: "Closed Hat", category: "closed_hat", required: true },
  { id: "open_hat", label: "Open Hat", category: "open_hat", required: false },
  { id: "clap", label: "Clap", category: "clap", required: false },
  { id: "perc", label: "Perc", category: "perc", required: false },
  { id: "crash", label: "Crash", category: "crash", required: false },
  { id: "ride", label: "Ride", category: "ride", required: false },
  { id: "tom", label: "Tom", category: "tom", required: false },
  { id: "shaker", label: "Shaker", category: "shaker", required: false },
  { id: "cowbell", label: "Cowbell", category: "cowbell", required: false }
];
const CUSTOM_PRESETS_STORAGE_KEY = "drum-loop-maker.custom-presets.v1";
const CUSTOM_PRESET_VALUE_PREFIX = "custom:";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createInitialLanes(totalSteps) {
  return Object.fromEntries(
    LANES.map((lane) => [
      lane.id,
      {
        samplePath: "",
        gain: 1,
        steps: Array.from({ length: totalSteps }, () => false)
      }
    ])
  );
}

function resizeSteps(steps, totalSteps) {
  const result = Array.from({ length: totalSteps }, () => false);
  if (!Array.isArray(steps)) {
    return result;
  }

  const copyCount = Math.min(steps.length, totalSteps);
  for (let i = 0; i < copyCount; i += 1) {
    result[i] = Boolean(steps[i]);
  }
  return result;
}

function getSampleOptionLabel(sample) {
  return `${sample.name} [${sample.pack}]`;
}

function toCustomPresetValue(name) {
  return `${CUSTOM_PRESET_VALUE_PREFIX}${name}`;
}

function isCustomPresetValue(value) {
  return typeof value === "string" && value.startsWith(CUSTOM_PRESET_VALUE_PREFIX);
}

function fromCustomPresetValue(value) {
  if (!isCustomPresetValue(value)) {
    return "";
  }
  return value.slice(CUSTOM_PRESET_VALUE_PREFIX.length);
}

function toDrumClipRef(name) {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `clip-${slug}` : "";
}

function snapshotPatternByLane(lanesById, totalSteps) {
  return Object.fromEntries(
    LANES.map((lane) => [lane.id, resizeSteps(lanesById[lane.id]?.steps, totalSteps)])
  );
}

function snapshotFirstBarPatternByLane(lanesById) {
  return Object.fromEntries(
    LANE_IDS.map((laneId) => [laneId, resizeSteps(lanesById[laneId]?.steps, 16)])
  );
}

function normalizeCustomPresets(rawPresets) {
  if (!Array.isArray(rawPresets)) {
    return [];
  }

  const seenNames = new Set();
  const normalized = [];
  for (const preset of rawPresets) {
    const name = String(preset?.name || "").trim();
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    if (seenNames.has(key)) {
      continue;
    }

    const loopBars = [1, 2, 4].includes(Number(preset?.loopBars)) ? Number(preset.loopBars) : 1;
    const totalSteps = loopBars * 16;
    normalized.push({
      name,
      loopBars,
      patternByLane: Object.fromEntries(
        LANES.map((lane) => [
          lane.id,
          resizeSteps(preset?.patternByLane?.[lane.id], totalSteps)
        ])
      )
    });
    seenNames.add(key);
  }

  return normalized.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
}

function loadCustomPresets() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_PRESETS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return normalizeCustomPresets(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persistCustomPresets(customPresets) {
  try {
    window.localStorage.setItem(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(customPresets));
    return true;
  } catch {
    return false;
  }
}

export async function initDrumsView(rootElement, { store, trackManager }) {
  if (!rootElement) {
    throw new Error("Missing root element.");
  }
  if (!store || !trackManager) {
    throw new Error("Missing shared store or track manager.");
  }

  rootElement.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <h1>Drum Backing-Track Loop Maker</h1>
        <p>Local-first sequencer for guitar practice. Samples are loaded from <code>public/samples</code>.</p>
      </header>

      <div id="status" class="status">Initializing audio engine...</div>

      <section class="panel">
        <h2>Transport & Timing</h2>
        <div class="control-grid">
          <label class="control">
            <span>BPM Slider (60-200)</span>
            <input id="bpm-range" type="range" min="60" max="200" step="1" value="110" />
          </label>
          <label class="control">
            <span>BPM Number (30-300)</span>
            <input id="bpm-number" type="number" min="30" max="300" step="1" value="110" />
          </label>
          <label class="control">
            <span>Swing %</span>
            <input id="swing" type="range" min="0" max="60" step="1" value="0" />
          </label>
          <label class="control">
            <span>Master Volume</span>
            <input id="master-volume" type="range" min="0" max="1" step="0.01" value="0.8" />
          </label>
          <label class="control">
            <span>Track Length (minutes)</span>
            <input id="track-minutes" type="number" min="1" max="30" step="1" value="4" />
          </label>
          <label class="control">
            <span>Loop Length</span>
            <select id="loop-bars">
              <option value="1" selected>1 bar</option>
              <option value="2">2 bars</option>
              <option value="4">4 bars</option>
            </select>
          </label>
          <label class="control">
            <span>Pattern Preset</span>
            <select id="preset"></select>
          </label>
          <div class="control preset-save-control">
            <span>Save Groove + DAW Clip</span>
            <div class="preset-save-row">
              <input id="custom-preset-name" type="text" maxlength="40" placeholder="My Groove" />
              <button id="save-preset" type="button">Save</button>
            </div>
          </div>
          <label class="control">
            <span>Sample Pack Source</span>
            <select id="sample-pack-source">
              <option value="all" selected>All Packs</option>
            </select>
          </label>
        </div>

        <div class="transport-buttons">
          <button id="play" type="button">Play</button>
          <button id="stop" type="button">Stop</button>
          <button id="reset-pattern" type="button">Reset Pattern</button>
        </div>
      </section>

      <section class="panel">
        <h2>Metronome</h2>
        <div class="control-grid">
          <label class="control checkbox">
            <input id="metronome-enabled" type="checkbox" checked />
            <span>Metronome On</span>
          </label>
          <label class="control">
            <span>Metronome Volume</span>
            <input id="metronome-volume" type="range" min="0" max="1" step="0.01" value="0.5" />
          </label>
          <label class="control checkbox">
            <input id="metronome-accent" type="checkbox" checked />
            <span>Accent Beat 1</span>
          </label>
          <label class="control">
            <span>Subdivision</span>
            <select id="metronome-subdivision">
              <option value="half">Half</option>
              <option value="quarter" selected>Quarter</option>
              <option value="eighth">Eighth</option>
              <option value="sixteenth">Sixteenth</option>
            </select>
          </label>
        </div>
      </section>

      <section class="panel">
        <h2>Lane Samples</h2>
        <div class="control-grid lane-preview-settings">
          <label class="control checkbox">
            <input id="preview-on-select" type="checkbox" checked />
            <span>Preview on Select</span>
          </label>
          <label class="control">
            <span>Preview Volume</span>
            <input id="preview-volume" type="range" min="0" max="1" step="0.01" value="0.85" />
          </label>
        </div>
        <div id="lane-controls" class="lane-controls"></div>
      </section>

      <section class="panel">
        <h2>Step Sequencer</h2>
        <div id="sequencer-grid"></div>
      </section>

      <section class="panel">
        <h2>Selected Samples</h2>
        <div id="selected-samples"></div>
      </section>

      <section class="panel">
        <h2>Export</h2>
        <div class="control-grid">
          <label class="control">
            <span>Export Length (minutes)</span>
            <input id="export-minutes" type="number" min="1" max="30" step="1" value="4" />
          </label>
        </div>
        <div class="transport-buttons">
          <button id="export-wav" type="button">Export WAV</button>
          <button id="export-mp3" type="button">Export MP3</button>
        </div>
        <div class="export-progress-wrap">
          <div class="export-progress-track">
            <div id="export-progress-fill" class="export-progress-fill"></div>
          </div>
          <div id="export-progress-text" class="export-progress-text">Idle</div>
        </div>
      </section>
    </div>
  `;

  const statusEl = rootElement.querySelector("#status");
  const presetEl = rootElement.querySelector("#preset");
  const laneControlsEl = rootElement.querySelector("#lane-controls");
  const selectedSamplesEl = rootElement.querySelector("#selected-samples");
  const gridEl = rootElement.querySelector("#sequencer-grid");
  const playBtn = rootElement.querySelector("#play");
  const stopBtn = rootElement.querySelector("#stop");
  const savePresetBtn = rootElement.querySelector("#save-preset");
  const exportWavBtn = rootElement.querySelector("#export-wav");
  const exportMp3Btn = rootElement.querySelector("#export-mp3");
  const exportProgressFillEl = rootElement.querySelector("#export-progress-fill");
  const exportProgressTextEl = rootElement.querySelector("#export-progress-text");

  const controls = {
    bpmRange: rootElement.querySelector("#bpm-range"),
    bpmNumber: rootElement.querySelector("#bpm-number"),
    swing: rootElement.querySelector("#swing"),
    masterVolume: rootElement.querySelector("#master-volume"),
    trackMinutes: rootElement.querySelector("#track-minutes"),
    loopBars: rootElement.querySelector("#loop-bars"),
    resetPattern: rootElement.querySelector("#reset-pattern"),
    metronomeEnabled: rootElement.querySelector("#metronome-enabled"),
    metronomeVolume: rootElement.querySelector("#metronome-volume"),
    metronomeAccent: rootElement.querySelector("#metronome-accent"),
    metronomeSubdivision: rootElement.querySelector("#metronome-subdivision"),
    previewOnSelect: rootElement.querySelector("#preview-on-select"),
    previewVolume: rootElement.querySelector("#preview-volume"),
    exportMinutes: rootElement.querySelector("#export-minutes"),
    customPresetName: rootElement.querySelector("#custom-preset-name"),
    samplePackSource: rootElement.querySelector("#sample-pack-source")
  };

  const sharedState = store.getState();
  const { audioContext, masterGain } = getAudioNodes();
  const state = {
    ready: false,
    isPlaying: Boolean(sharedState.transport.isPlaying),
    currentStep: Number(sharedState.ui.playheadStep) || -1,
    bpm: Number(sharedState.transport.bpm) || 110,
    swingPercent: Number(sharedState.transport.swingPercent) || 0,
    masterVolume: Number(sharedState.mixer.masterGain) || 0.8,
    trackMinutes: Number(sharedState.transport.trackMinutes) || 4,
    exportMinutes: 4,
    loopBars: [1, 2, 4].includes(Number(sharedState.transport.loopBars))
      ? Number(sharedState.transport.loopBars)
      : 1,
    presetName: "Rock",
    presetValue: "Rock",
    customPresets: loadCustomPresets(),
    isExporting: false,
    previewOnSelect: true,
    previewVolume: 0.85,
    packSource: "all",
    availablePacks: [],
    metronome: {
      enabled: Boolean(sharedState.transport.metronome.enabled),
      volume: Number(sharedState.transport.metronome.volume) || 0.5,
      accentBeatOne: Boolean(sharedState.transport.metronome.accentBeatOne),
      subdivision: sharedState.transport.metronome.subdivision || METRONOME_SUBDIVISIONS.QUARTER
    },
    lanes: createInitialLanes(
      ([1, 2, 4].includes(Number(sharedState.transport.loopBars))
        ? Number(sharedState.transport.loopBars)
        : 1) * 16
    ),
    buffersByPath: new Map(),
    sampleMetaByPath: new Map(),
    samplesByCategory: new Map(SAMPLE_CATEGORIES.map((name) => [name, []])),
    failedSamples: []
  };

  function syncCustomPresetsToDawClips() {
    const currentClips = store.getState().drumClips || {};
    for (const preset of state.customPresets) {
      const name = String(preset?.name || "").trim();
      if (!name) {
        continue;
      }
      const matchedClipEntry = Object.entries(currentClips).find(
        ([clipRef, clip]) =>
          clipRef !== "shared-main" &&
          String(clip?.name || "").trim().toLowerCase() === name.toLowerCase()
      );
      const clipRef = matchedClipEntry ? matchedClipEntry[0] : toDrumClipRef(name);
      if (!clipRef) {
        continue;
      }
      store.setDrumClip(clipRef, {
        name,
        lanes: snapshotFirstBarPatternByLane(preset.patternByLane)
      });
    }
  }

  setMasterVolume(state.masterVolume);
  syncCustomPresetsToDawClips();
  renderPresetOptions(state.presetValue);
  applyStoreDrumPatternToLocal();

  function setStatus(message, tone = "info") {
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  }

  function setExportProgress(progressPercent, message) {
    const safePercent = clamp(Number(progressPercent) || 0, 0, 100);
    exportProgressFillEl.style.width = `${safePercent}%`;
    exportProgressTextEl.textContent = message || `${Math.round(safePercent)}%`;
  }

  async function previewSample(samplePath, laneGain = 1) {
    if (!samplePath) {
      return;
    }

    const buffer = state.buffersByPath.get(samplePath);
    if (!buffer) {
      setStatus("Preview sample is not loaded yet.", "warn");
      return;
    }

    try {
      await resumeAudioContext();
      const source = audioContext.createBufferSource();
      const previewGain = audioContext.createGain();

      source.buffer = buffer;
      previewGain.gain.setValueAtTime(
        clamp((Number(state.previewVolume) || 0) * (Number(laneGain) || 0), 0, 1),
        audioContext.currentTime
      );

      source.connect(previewGain);
      previewGain.connect(masterGain);
      source.start(audioContext.currentTime);
    } catch (error) {
      setStatus(`Preview failed: ${String(error.message || error)}`, "error");
    }
  }

  function totalSteps() {
    return state.loopBars * 16;
  }

  function applyStoreDrumPatternToLocal() {
    const drumPattern = store.getState().drumPattern;
    const stepCount = totalSteps();
    for (const lane of LANES) {
      const laneState = state.lanes[lane.id];
      laneState.steps = resizeSteps(drumPattern.lanes?.[lane.id], stepCount);
      laneState.gain = clamp(Number(drumPattern.laneGains?.[lane.id]) || laneState.gain, 0, 1);
      laneState.samplePath = drumPattern.selectedSamples?.[lane.id] || laneState.samplePath;
    }
  }

  function syncDrumPatternToStore() {
    const lanes = {};
    const selectedSamples = {};
    const laneGains = {};
    for (const lane of LANES) {
      lanes[lane.id] = resizeSteps(state.lanes[lane.id].steps, totalSteps());
      selectedSamples[lane.id] = state.lanes[lane.id].samplePath;
      laneGains[lane.id] = clamp(Number(state.lanes[lane.id].gain) || 0, 0, 1);
    }
    store.setDrumPattern({
      lanes,
      selectedSamples,
      laneGains
    });
  }

  function renderPresetOptions(selectedValue = state.presetValue) {
    presetEl.innerHTML = "";

    for (const presetName of PRESET_NAMES) {
      const option = document.createElement("option");
      option.value = presetName;
      option.textContent = presetName;
      presetEl.append(option);
    }

    if (state.customPresets.length > 0) {
      const customGroup = document.createElement("optgroup");
      customGroup.label = "Saved Grooves";
      for (const customPreset of state.customPresets) {
        const option = document.createElement("option");
        option.value = toCustomPresetValue(customPreset.name);
        option.textContent = customPreset.name;
        customGroup.append(option);
      }
      presetEl.append(customGroup);
    }

    const hasSelected = Array.from(presetEl.options).some((option) => option.value === selectedValue);
    const nextValue = hasSelected ? selectedValue : PRESET_NAMES[0];
    presetEl.value = nextValue;
    state.presetValue = nextValue;
  }

  function saveCurrentPreset() {
    const requestedName = String(controls.customPresetName.value || "").trim();
    if (!requestedName) {
      setStatus("Enter a preset name before saving.", "warn");
      return;
    }

    if (PRESET_NAMES.some((name) => name.toLowerCase() === requestedName.toLowerCase())) {
      setStatus("That name is reserved by a built-in preset. Use a different name.", "warn");
      return;
    }

    const snapshot = {
      name: requestedName,
      loopBars: state.loopBars,
      patternByLane: snapshotPatternByLane(state.lanes, totalSteps())
    };

    const existingIndex = state.customPresets.findIndex(
      (item) => item.name.toLowerCase() === requestedName.toLowerCase()
    );
    const wasUpdate = existingIndex >= 0;
    if (wasUpdate) {
      state.customPresets[existingIndex] = snapshot;
    } else {
      state.customPresets.push(snapshot);
    }
    state.customPresets.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    );

    if (!persistCustomPresets(state.customPresets)) {
      setStatus("Could not save preset to browser storage.", "warn");
      return;
    }

    const drumClips = store.getState().drumClips || {};
    const matchedClipEntry = Object.entries(drumClips).find(
      ([clipRef, clip]) =>
        clipRef !== "shared-main" &&
        String(clip?.name || "").trim().toLowerCase() === requestedName.toLowerCase()
    );
    const clipRef = matchedClipEntry ? matchedClipEntry[0] : toDrumClipRef(requestedName);
    if (clipRef) {
      store.setDrumClip(clipRef, {
        name: requestedName,
        lanes: snapshotFirstBarPatternByLane(state.lanes)
      });
    }

    const savedValue = toCustomPresetValue(snapshot.name);
    renderPresetOptions(savedValue);
    state.presetName = snapshot.name;
    controls.customPresetName.value = "";
    setStatus(
      wasUpdate
        ? `Updated preset "${snapshot.name}" and DAW drum clip.`
        : `Saved preset "${snapshot.name}" and DAW drum clip.`
    );
  }

  function matchesPackFilter(sample) {
    if (state.packSource === "all") {
      return true;
    }
    return sample.pack === state.packSource;
  }

  function updatePackSourceOptions() {
    const current = state.packSource;
    controls.samplePackSource.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All Packs";
    controls.samplePackSource.append(allOption);

    for (const pack of state.availablePacks) {
      const option = document.createElement("option");
      option.value = pack;
      option.textContent = pack;
      controls.samplePackSource.append(option);
    }

    const nextValue = state.availablePacks.includes(current) || current === "all" ? current : "all";
    state.packSource = nextValue;
    controls.samplePackSource.value = nextValue;
  }

  function getLaneOptions(lane) {
    const categoryOptionsAll = state.samplesByCategory.get(lane.category) || [];
    const categoryOptionsByPack = categoryOptionsAll.filter(matchesPackFilter);

    if (categoryOptionsByPack.length > 0) {
      return { options: categoryOptionsByPack, warning: "" };
    }

    const unknownAll = state.samplesByCategory.get("unknown") || [];
    const unknownByPack = unknownAll.filter(matchesPackFilter);
    if (unknownByPack.length > 0) {
      return {
        options: unknownByPack,
        warning: `No ${lane.category} samples in selected pack. Using unknown from selected pack.`
      };
    }

    if (categoryOptionsAll.length > 0) {
      return {
        options: categoryOptionsAll,
        warning:
          state.packSource !== "all"
            ? `No ${lane.category} in selected pack. Falling back to all packs.`
            : ""
      };
    }

    return {
      options: unknownAll,
      warning: `No ${lane.category} samples found. Using unknown samples.`
    };
  }

  function ensureLaneSampleSelections() {
    for (const lane of LANES) {
      const laneState = state.lanes[lane.id];
      const { options } = getLaneOptions(lane);
      if (!options.length) {
        laneState.samplePath = "";
        continue;
      }

      const exists = options.some((sample) => sample.path === laneState.samplePath);
      if (!exists) {
        laneState.samplePath = options[0].path;
      }
    }
  }

  function renderSelectedSamples() {
    const html = LANES.map((lane) => {
      const laneState = state.lanes[lane.id];
      const meta = state.sampleMetaByPath.get(laneState.samplePath);
      if (!meta) {
        return `<div class="sample-card"><strong>${lane.label}:</strong> <span class="missing">No sample selected</span></div>`;
      }

      return `<div class="sample-card">
        <strong>${lane.label}:</strong> ${meta.name}
        <span class="pack">${meta.pack}</span>
        <span class="badge">${meta.analysis.lengthBadge}</span>
        <span class="badge">${meta.analysis.toneBadge}</span>
        <span class="badge">Guess: ${meta.analysis.guess}</span>
      </div>`;
    }).join("");

    selectedSamplesEl.innerHTML = html;
  }

  function renderLaneControls() {
    ensureLaneSampleSelections();

    laneControlsEl.innerHTML = LANES.map((lane) => {
      const laneState = state.lanes[lane.id];
      const { options, warning } = getLaneOptions(lane);
      const warningHtml = warning ? `<span class="warning">${warning}</span>` : "";

      const optionItems = options.length
        ? options
            .map((sample) => {
              const selected = laneState.samplePath === sample.path ? "selected" : "";
              return `<option value="${sample.path}" ${selected}>${getSampleOptionLabel(sample)}</option>`;
            })
            .join("")
        : `<option value="">No samples available</option>`;

      return `<div class="lane-row">
        <div class="lane-title">
          <strong>${lane.label}</strong>
          ${lane.required ? '<span class="required">required</span>' : ""}
        </div>
        <label>
          Sample
          <select data-role="lane-sample" data-lane-id="${lane.id}">
            ${optionItems}
          </select>
        </label>
        <label>
          Lane Gain
          <input data-role="lane-gain" data-lane-id="${lane.id}" type="range" min="0" max="1" step="0.01" value="${laneState.gain}" />
        </label>
        <div class="lane-preview-wrap">
          <button
            class="lane-preview-btn"
            data-role="lane-preview"
            data-lane-id="${lane.id}"
            type="button"
            ${laneState.samplePath ? "" : "disabled"}
          >
            Preview
          </button>
        </div>
        ${warningHtml}
      </div>`;
    }).join("");

    laneControlsEl.querySelectorAll("[data-role='lane-sample']").forEach((element) => {
      element.addEventListener("change", async (event) => {
        const target = event.target;
        const laneId = target.dataset.laneId;
        if (!laneId) {
          return;
        }
        state.lanes[laneId].samplePath = target.value;
        syncDrumPatternToStore();
        renderSelectedSamples();
        renderLaneControls();
        if (state.previewOnSelect && target.value) {
          await previewSample(target.value, state.lanes[laneId].gain);
        }
      });
    });

    laneControlsEl.querySelectorAll("[data-role='lane-gain']").forEach((element) => {
      element.addEventListener("input", (event) => {
        const target = event.target;
        const laneId = target.dataset.laneId;
        if (!laneId) {
          return;
        }
        state.lanes[laneId].gain = clamp(Number(target.value) || 0, 0, 1);
        syncDrumPatternToStore();
      });
    });

    laneControlsEl.querySelectorAll("[data-role='lane-preview']").forEach((element) => {
      element.addEventListener("click", async (event) => {
        const target = event.target;
        const laneId = target.dataset.laneId;
        if (!laneId) {
          return;
        }
        const laneState = state.lanes[laneId];
        if (!laneState?.samplePath) {
          setStatus("Select a sample first, then preview it.", "warn");
          return;
        }
        await previewSample(laneState.samplePath, laneState.gain);
      });
    });
  }

  function syncBpmInputsFromState() {
    controls.bpmNumber.value = String(Math.round(state.bpm));
    controls.bpmRange.value = String(clamp(Math.round(state.bpm), 60, 200));
  }

  function updateTransportButtons() {
    playBtn.disabled = !state.ready || state.isPlaying || state.isExporting;
    stopBtn.disabled = !state.isPlaying;
    exportWavBtn.disabled = !state.ready || state.isPlaying || state.isExporting;
    exportMp3Btn.disabled = !state.ready || state.isPlaying || state.isExporting;
  }

  function hasRequiredLaneSelections() {
    for (const lane of LANES.filter((item) => item.required)) {
      if (!state.lanes[lane.id].samplePath) {
        return false;
      }
    }
    return true;
  }

  const grid = createSequencerGrid(gridEl, {
    onToggleStep(laneId, stepIndex) {
      const laneState = state.lanes[laneId];
      if (!laneState || !Array.isArray(laneState.steps) || stepIndex >= laneState.steps.length) {
        return;
      }
      laneState.steps[stepIndex] = !laneState.steps[stepIndex];
      syncDrumPatternToStore();
      renderGrid();
    }
  });

  function renderGrid() {
    const pattern = Object.fromEntries(LANES.map((lane) => [lane.id, state.lanes[lane.id].steps]));
    grid.render({
      lanes: LANES,
      totalSteps: totalSteps(),
      pattern,
      currentStep: state.currentStep
    });
  }

  function applyPattern(patternByLane) {
    for (const lane of LANES) {
      state.lanes[lane.id].steps = resizeSteps(patternByLane[lane.id], totalSteps());
    }
    syncDrumPatternToStore();
    renderGrid();
  }

  function applyPreset(presetValue) {
    state.presetValue = presetValue;

    if (isCustomPresetValue(presetValue)) {
      const customName = fromCustomPresetValue(presetValue);
      const customPreset = state.customPresets.find((item) => item.name === customName);
      if (!customPreset) {
        const fallbackPreset = PRESET_NAMES[0];
        renderPresetOptions(fallbackPreset);
        state.presetName = fallbackPreset;
        applyPattern(buildPresetPattern(fallbackPreset, state.loopBars));
        setStatus(`Saved preset "${customName}" was not found.`, "warn");
        return;
      }

      state.presetName = customPreset.name;
      state.loopBars = customPreset.loopBars;
      controls.loopBars.value = String(customPreset.loopBars);
      store.setTransport({ loopBars: customPreset.loopBars });
      applyPattern(customPreset.patternByLane);
      return;
    }

    state.presetName = presetValue;
    const pattern = buildPresetPattern(presetValue, state.loopBars);
    applyPattern(pattern);
  }

  controls.bpmRange.addEventListener("input", (event) => {
    state.bpm = clamp(Number(event.target.value) || 110, 60, 200);
    store.setTransport({ bpm: state.bpm });
    syncBpmInputsFromState();
  });

  controls.bpmNumber.addEventListener("input", (event) => {
    const numericValue = clamp(Number(event.target.value) || 110, 30, 300);
    state.bpm = clamp(numericValue, 60, 200);
    if (numericValue !== state.bpm) {
      setStatus("BPM slider and number are synced in the shared 60-200 range.", "warn");
    }
    store.setTransport({ bpm: state.bpm });
    syncBpmInputsFromState();
  });

  controls.swing.addEventListener("input", (event) => {
    state.swingPercent = clamp(Number(event.target.value) || 0, 0, 60);
    store.setTransport({ swingPercent: state.swingPercent });
  });

  controls.masterVolume.addEventListener("input", (event) => {
    state.masterVolume = clamp(Number(event.target.value) || 0, 0, 1);
    store.setMixer({ masterGain: state.masterVolume });
    setMasterVolume(state.masterVolume);
  });

  controls.trackMinutes.addEventListener("input", (event) => {
    state.trackMinutes = clamp(Number(event.target.value) || 4, 1, 30);
    store.setTransport({ trackMinutes: state.trackMinutes });
  });

  controls.exportMinutes.addEventListener("input", (event) => {
    state.exportMinutes = clamp(Number(event.target.value) || 4, 1, 30);
  });

  controls.previewOnSelect.addEventListener("change", (event) => {
    state.previewOnSelect = Boolean(event.target.checked);
  });

  controls.previewVolume.addEventListener("input", (event) => {
    state.previewVolume = clamp(Number(event.target.value) || 0, 0, 1);
  });

  controls.samplePackSource.addEventListener("change", (event) => {
    state.packSource = event.target.value || "all";
    renderLaneControls();
    renderSelectedSamples();
    setStatus(
      state.packSource === "all"
        ? "Using samples from all packs."
        : `Using samples from pack: ${state.packSource}`
    );
  });

  controls.loopBars.addEventListener("change", (event) => {
    const nextLoopBars = [1, 2, 4].includes(Number(event.target.value))
      ? Number(event.target.value)
      : 1;
    store.setTransport({ loopBars: nextLoopBars });
  });

  presetEl.addEventListener("change", (event) => {
    applyPreset(event.target.value);
  });

  savePresetBtn.addEventListener("click", () => {
    saveCurrentPreset();
  });

  controls.customPresetName.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    saveCurrentPreset();
  });

  controls.resetPattern.addEventListener("click", () => {
    applyPattern(createEmptyPattern(totalSteps()));
    setStatus("Pattern reset.");
  });

  controls.metronomeEnabled.addEventListener("change", (event) => {
    state.metronome.enabled = Boolean(event.target.checked);
    store.setTransport({
      metronome: {
        enabled: state.metronome.enabled
      }
    });
  });

  controls.metronomeVolume.addEventListener("input", (event) => {
    state.metronome.volume = clamp(Number(event.target.value) || 0, 0, 1);
    store.setTransport({
      metronome: {
        volume: state.metronome.volume
      }
    });
  });

  controls.metronomeAccent.addEventListener("change", (event) => {
    state.metronome.accentBeatOne = Boolean(event.target.checked);
    store.setTransport({
      metronome: {
        accentBeatOne: state.metronome.accentBeatOne
      }
    });
  });

  controls.metronomeSubdivision.addEventListener("change", (event) => {
    state.metronome.subdivision = event.target.value;
    store.setTransport({
      metronome: {
        subdivision: state.metronome.subdivision
      }
    });
  });

  playBtn.addEventListener("click", async () => {
    if (!state.ready) {
      return;
    }
    if (!hasRequiredLaneSelections()) {
      setStatus("Kick, Snare, and Closed Hat need selected samples before playback.", "warn");
      return;
    }

    await trackManager.start({ context: "drums" });
    setStatus(`Playing for ${state.trackMinutes} minute(s)...`);
  });

  stopBtn.addEventListener("click", () => {
    trackManager.stop();
    setStatus("Stopped.");
  });

  function syncFromSharedState(shared) {
    const transport = shared.transport;
    const mixerState = shared.mixer;
    const nextLoopBars = [1, 2, 4].includes(Number(transport.loopBars))
      ? Number(transport.loopBars)
      : 1;
    if (nextLoopBars !== state.loopBars) {
      state.loopBars = nextLoopBars;
      for (const lane of LANES) {
        state.lanes[lane.id].steps = resizeSteps(state.lanes[lane.id].steps, totalSteps());
      }
      syncDrumPatternToStore();
      renderGrid();
    }

    state.isPlaying = Boolean(transport.isPlaying);
    state.currentStep = Number(shared.ui.playheadStep) || -1;
    state.bpm = clamp(Number(transport.bpm) || 110, 30, 300);
    state.swingPercent = clamp(Number(transport.swingPercent) || 0, 0, 60);
    state.trackMinutes = clamp(Number(transport.trackMinutes) || 4, 1, 30);
    state.masterVolume = clamp(Number(mixerState.masterGain) || 0, 0, 1);
    state.metronome = {
      enabled: Boolean(transport.metronome.enabled),
      volume: clamp(Number(transport.metronome.volume) || 0, 0, 1),
      accentBeatOne: Boolean(transport.metronome.accentBeatOne),
      subdivision: transport.metronome.subdivision || METRONOME_SUBDIVISIONS.QUARTER
    };

    controls.swing.value = String(Math.round(state.swingPercent));
    controls.trackMinutes.value = String(state.trackMinutes);
    controls.masterVolume.value = String(state.masterVolume);
    controls.loopBars.value = String(state.loopBars);
    controls.metronomeEnabled.checked = state.metronome.enabled;
    controls.metronomeVolume.value = String(state.metronome.volume);
    controls.metronomeAccent.checked = state.metronome.accentBeatOne;
    controls.metronomeSubdivision.value = state.metronome.subdivision;
    syncBpmInputsFromState();
    updateTransportButtons();
    renderGrid();
  }

  store.subscribe((nextState) => {
    syncFromSharedState(nextState);
  });

  trackManager.subscribe((event) => {
    if (event.type !== "stop") {
      return;
    }
    if (event.reason === "auto") {
      setStatus(`Auto-stopped after ${state.trackMinutes} minute(s).`);
      return;
    }
    setStatus("Stopped.");
  });

  async function runExport(format) {
    if (!state.ready) {
      return;
    }

    if (!hasRequiredLaneSelections()) {
      setStatus("Kick, Snare, and Closed Hat need selected samples before export.", "warn");
      return;
    }

    state.exportMinutes = clamp(Number(controls.exportMinutes.value) || state.exportMinutes, 1, 30);
    controls.exportMinutes.value = String(state.exportMinutes);

    const lanesSnapshot = Object.fromEntries(
      LANES.map((lane) => {
        const laneState = state.lanes[lane.id];
        return [
          lane.id,
          {
            samplePath: laneState.samplePath,
            gain: laneState.gain,
            steps: [...laneState.steps]
          }
        ];
      })
    );

    const metronomeSnapshot = {
      enabled: Boolean(state.metronome.enabled),
      volume: state.metronome.volume,
      accentBeatOne: Boolean(state.metronome.accentBeatOne),
      subdivision: state.metronome.subdivision
    };

    let renderProgressTimer = null;
    try {
      state.isExporting = true;
      updateTransportButtons();
      setStatus(`Rendering ${format.toUpperCase()} (${state.exportMinutes} minute(s))...`);
      setExportProgress(2, "Preparing render...");

      let renderProgress = 2;
      renderProgressTimer = setInterval(() => {
        renderProgress = Math.min(55, renderProgress + 1.5);
        setExportProgress(renderProgress, "Rendering offline audio...");
      }, 180);

      const renderedBuffer = await renderPatternOffline({
        bpm: state.bpm,
        swingPercent: state.swingPercent,
        loopBars: state.loopBars,
        durationMinutes: state.exportMinutes,
        masterVolume: state.masterVolume,
        lanes: lanesSnapshot,
        buffersByPath: state.buffersByPath,
        metronome: metronomeSnapshot
      });
      clearInterval(renderProgressTimer);
      renderProgressTimer = null;
      setExportProgress(60, "Render complete.");

      const dateTag = new Date().toISOString().replace(/[:.]/g, "-");
      const baseName = `drum-loop-${state.exportMinutes}m-${dateTag}`;

      if (format === "wav") {
        setExportProgress(75, "Encoding WAV...");
        const wavBlob = audioBufferToWavBlob(renderedBuffer);
        setExportProgress(92, "Preparing download...");
        await downloadBlob(wavBlob, `${baseName}.wav`);
      } else {
        const mp3Blob = await audioBufferToMp3Blob(renderedBuffer, 192, (progress01) => {
          const phaseProgress = 65 + progress01 * 27;
          setExportProgress(phaseProgress, "Encoding MP3...");
        });
        setExportProgress(93, "Preparing download...");
        await downloadBlob(mp3Blob, `${baseName}.mp3`);
      }

      setExportProgress(100, "Download started.");
      setStatus(`Exported ${format.toUpperCase()} successfully.`);
      setTimeout(() => {
        if (!state.isExporting) {
          setExportProgress(0, "Idle");
        }
      }, 1500);
    } catch (error) {
      setStatus(`Export failed: ${String(error.message || error)}`, "error");
      setExportProgress(0, "Export failed.");
    } finally {
      if (renderProgressTimer !== null) {
        clearInterval(renderProgressTimer);
      }
      state.isExporting = false;
      updateTransportButtons();
    }
  }

  exportWavBtn.addEventListener("click", () => {
    runExport("wav");
  });

  exportMp3Btn.addEventListener("click", () => {
    runExport("mp3");
  });

  syncFromSharedState(store.getState());
  updateTransportButtons();
  setExportProgress(0, "Idle");
  renderGrid();
  renderLaneControls();
  renderSelectedSamples();

  try {
    setStatus("Loading samples 0/0...");
    const loaded = await loadSamples(audioContext, {
      onProgress({ loaded, total }) {
        setStatus(`Loading ${loaded}/${total} samples...`);
      }
    });

    state.buffersByPath = loaded.buffersByPath;
    state.sampleMetaByPath = loaded.sampleMetaByPath;
    state.samplesByCategory = loaded.samplesByCategory;
    state.failedSamples = loaded.failed;
    trackManager.setDrumBuffers(state.buffersByPath);
    state.availablePacks = Array.from(
      new Set(Array.from(state.sampleMetaByPath.values()).map((item) => item.pack))
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    updatePackSourceOptions();
    ensureLaneSampleSelections();
    renderLaneControls();
    renderSelectedSamples();
    applyPreset(state.presetValue);
    syncDrumPatternToStore();

    state.ready = loaded.buffersByPath.size > 0;
    updateTransportButtons();

    const loadedCount = loaded.buffersByPath.size;
    const failedCount = loaded.failed.length;
    if (loadedCount === 0) {
      setStatus("No decodable WAV samples loaded. Check sample paths and regenerate manifest.", "warn");
    } else if (failedCount > 0) {
      setStatus(`Loaded ${loadedCount} sample(s). Failed to load ${failedCount} sample(s).`, "warn");
    } else {
      setStatus(`Loaded ${loadedCount} sample(s). Ready.`);
    }
  } catch (error) {
    state.ready = false;
    updateTransportButtons();
    setStatus(String(error.message || error), "error");
  }

  syncBpmInputsFromState();
}
