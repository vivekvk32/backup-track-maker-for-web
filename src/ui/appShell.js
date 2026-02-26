import { getAudioNodes, setMasterVolume } from "../audio/context";
import { createMixer } from "../audio/mixer";
import { createBassTrack } from "../bass/bassTrack";
import { createSf2Player } from "../bass/sf2Player";
import { createTrackManager } from "../daw/trackManager";
import { createTransportStore } from "../daw/transportStore";
import { initDawView } from "../daw/dawView";
import { createPianoChordTrack } from "../piano/pianoChordTrack";
import { initDrumsView } from "./drumsView";
import { readSessionsFromDatabase, writeSessionsToDatabase } from "./sessionDatabase";

const LEGACY_SESSION_STORAGE_KEY = "drum-loop-maker.sessions.v1";

function normalizeSessionName(name, fallbackName = "") {
  const safe = String(name || "").trim();
  if (safe) {
    return safe.slice(0, 80);
  }
  return String(fallbackName || "").trim() || "Untitled Session";
}

function createSessionId() {
  return `session-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function buildSessionSnapshot(state) {
  return {
    transport: {
      bpm: state.transport.bpm,
      swingPercent: state.transport.swingPercent,
      loopBars: state.transport.loopBars,
      arrangementBars: state.transport.arrangementBars,
      loopRange: state.transport.loopRange,
      trackMinutes: state.transport.trackMinutes,
      playContext: state.transport.playContext,
      metronome: state.transport.metronome
    },
    mixer: state.mixer,
    tracks: state.tracks,
    arrangement: state.arrangement,
    drumPattern: state.drumPattern,
    drumClips: state.drumClips,
    bassSettings: state.bassSettings,
    pianoSettings: state.pianoSettings,
    ui: {
      activeTab: state.ui.activeTab,
      bassSf2Path: state.ui.bassSf2Path,
      pianoSf2Path: state.ui.pianoSf2Path
    }
  };
}

function getSessionStateHash(state) {
  return JSON.stringify(buildSessionSnapshot(state));
}

function setActiveTabUi(state, tabs) {
  const isDrums = state.ui.activeTab === "drums";
  tabs.drumsButton.classList.toggle("active", isDrums);
  tabs.dawButton.classList.toggle("active", !isDrums);
  tabs.drumsPanel.hidden = !isDrums;
  tabs.dawPanel.hidden = isDrums;
}

export async function initAppShell(rootElement) {
  if (!rootElement) {
    throw new Error("Missing root element.");
  }

  rootElement.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <h1>Drum Backing-Track Loop Maker</h1>
        <p>Offline-first grooves with shared Drum + DAW transport.</p>
      </header>

      <section class="session-bar" aria-label="Session management">
        <label class="control">
          <span>Saved Sessions</span>
          <select id="session-select"></select>
        </label>
        <label class="control">
          <span>Session Name</span>
          <input id="session-name" type="text" placeholder="My backing track" />
        </label>
        <div class="session-actions">
          <button id="session-save" type="button">Save Session</button>
          <button id="session-load" type="button">Load Session</button>
          <button id="session-new" type="button">New Session</button>
          <button id="session-delete" type="button">Delete Session</button>
          <span id="session-dirty" class="session-dirty" data-state="saved">All changes saved</span>
          <span id="session-message" class="session-message" data-tone="ok"></span>
        </div>
      </section>

      <nav class="tab-nav" aria-label="Main tabs">
        <button id="tab-drums" class="tab-btn active" type="button">Drums</button>
        <button id="tab-daw" class="tab-btn" type="button">DAW</button>
      </nav>

      <section id="tab-panel-drums"></section>
      <section id="tab-panel-daw" hidden></section>
    </div>
  `;

  const tabs = {
    drumsButton: rootElement.querySelector("#tab-drums"),
    dawButton: rootElement.querySelector("#tab-daw"),
    drumsPanel: rootElement.querySelector("#tab-panel-drums"),
    dawPanel: rootElement.querySelector("#tab-panel-daw"),
    sessionSelect: rootElement.querySelector("#session-select"),
    sessionName: rootElement.querySelector("#session-name"),
    sessionSave: rootElement.querySelector("#session-save"),
    sessionLoad: rootElement.querySelector("#session-load"),
    sessionNew: rootElement.querySelector("#session-new"),
    sessionDelete: rootElement.querySelector("#session-delete"),
    sessionDirty: rootElement.querySelector("#session-dirty"),
    sessionMessage: rootElement.querySelector("#session-message")
  };

  const store = createTransportStore();

  const { audioContext, masterGain } = getAudioNodes();
  const mixer = createMixer({
    audioContext,
    outputNode: masterGain
  });
  mixer.applyMixerState(store.getState().mixer);
  setMasterVolume(store.getState().mixer.masterGain);

  const mixerNodes = mixer.getNodes();
  const bassSf2Player = createSf2Player({
    audioContext,
    outputNode: mixerNodes.bassInput,
    presetKeywords: ["bass"],
    testMidi: 40
  });
  bassSf2Player.setLowpassEnabled(true);

  const pianoSf2Player = createSf2Player({
    audioContext,
    outputNode: mixerNodes.pianoInput,
    presetKeywords: ["piano", "grand", "electric"],
    testMidi: 60
  });
  pianoSf2Player.setLowpassEnabled(false);

  const bassTrack = createBassTrack({
    sf2Player: bassSf2Player,
    store
  });
  const pianoTrack = createPianoChordTrack({
    sf2Player: pianoSf2Player,
    store
  });

  const trackManager = createTrackManager({
    audioContext,
    mixer,
    store,
    bassTrack,
    pianoTrack,
    bassSf2Player,
    pianoSf2Player
  });

  await initDrumsView(tabs.drumsPanel, {
    store,
    trackManager
  });

  const dawView = initDawView(tabs.dawPanel, {
    store,
    trackManager,
    bassSf2Player,
    pianoSf2Player
  });

  tabs.drumsButton.addEventListener("click", () => {
    store.setUi({ activeTab: "drums" });
  });

  tabs.dawButton.addEventListener("click", () => {
    store.setUi({ activeTab: "daw" });
  });

  let previousActiveTab = store.getState().ui.activeTab;
  let previousMixer = JSON.stringify(store.getState().mixer);
  let savedSessions = await readSessionsFromDatabase({
    legacyStorageKey: LEGACY_SESSION_STORAGE_KEY
  });
  let selectedSessionId = "";
  let baselineSessionHash = getSessionStateHash(store.getState());
  let isSessionDirty = false;
  let isApplyingSession = false;
  let sessionMessageTimer = null;

  function renderSessionDirty() {
    tabs.sessionDirty.dataset.state = isSessionDirty ? "dirty" : "saved";
    tabs.sessionDirty.textContent = isSessionDirty ? "Unsaved changes" : "All changes saved";
  }

  function showSessionMessage(message, tone = "ok") {
    if (sessionMessageTimer !== null) {
      clearTimeout(sessionMessageTimer);
      sessionMessageTimer = null;
    }

    tabs.sessionMessage.dataset.tone = tone;
    tabs.sessionMessage.textContent = String(message || "");
    if (!message) {
      return;
    }

    sessionMessageTimer = setTimeout(() => {
      tabs.sessionMessage.textContent = "";
      sessionMessageTimer = null;
    }, 2400);
  }

  function getSelectedSession() {
    return savedSessions.find((item) => item.id === selectedSessionId) || null;
  }

  function renderSessionSelect() {
    if (!savedSessions.some((session) => session.id === selectedSessionId)) {
      selectedSessionId = "";
    }

    tabs.sessionSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a session...";
    placeholder.selected = !selectedSessionId;
    tabs.sessionSelect.append(placeholder);

    for (const session of savedSessions) {
      const option = document.createElement("option");
      option.value = session.id;
      option.textContent = session.name;
      option.selected = session.id === selectedSessionId;
      tabs.sessionSelect.append(option);
    }
    tabs.sessionLoad.disabled = !selectedSessionId;
    tabs.sessionDelete.disabled = !selectedSessionId;
  }

  function updateDirtyFromState(nextState) {
    if (isApplyingSession) {
      return;
    }
    const currentHash = getSessionStateHash(nextState);
    isSessionDirty = currentHash !== baselineSessionHash;
    renderSessionDirty();
  }

  function syncSessionNameFromSelection() {
    const selected = getSelectedSession();
    if (selected) {
      tabs.sessionName.value = selected.name;
    }
  }

  async function saveCurrentSession() {
    const now = Date.now();
    const snapshot = buildSessionSnapshot(store.getState());
    const selected = getSelectedSession();
    const nameInput = normalizeSessionName(tabs.sessionName.value, selected?.name || "");
    const targetName = normalizeSessionName(nameInput, "Untitled Session");

    if (selected) {
      savedSessions = savedSessions.map((session) => {
        if (session.id !== selected.id) {
          return session;
        }
        return {
          ...session,
          name: targetName,
          updatedAt: now,
          snapshot
        };
      });
      selectedSessionId = selected.id;
    } else {
      const id = createSessionId();
      savedSessions.unshift({
        id,
        name: targetName,
        createdAt: now,
        updatedAt: now,
        snapshot
      });
      selectedSessionId = id;
    }

    savedSessions.sort((left, right) => right.updatedAt - left.updatedAt);
    const didWrite = await writeSessionsToDatabase(savedSessions);
    tabs.sessionName.value = targetName;
    baselineSessionHash = getSessionStateHash(store.getState());
    isSessionDirty = false;
    renderSessionSelect();
    renderSessionDirty();
    if (!didWrite) {
      showSessionMessage("Save failed: browser storage unavailable.", "error");
      return;
    }
    showSessionMessage(`Session "${targetName}" saved.`, "ok");
  }

  function loadSessionById(sessionId) {
    const selected = savedSessions.find((item) => item.id === sessionId);
    if (!selected) {
      return;
    }

    if (
      isSessionDirty &&
      !window.confirm("You have unsaved changes. Load another session and discard current changes?")
    ) {
      return;
    }

    trackManager.stop();
    isApplyingSession = true;
    store.importSessionSnapshot(selected.snapshot);
    isApplyingSession = false;
    selectedSessionId = selected.id;
    tabs.sessionName.value = selected.name;
    baselineSessionHash = getSessionStateHash(store.getState());
    isSessionDirty = false;
    renderSessionSelect();
    renderSessionDirty();
  }

  function createFreshSession() {
    if (
      isSessionDirty &&
      !window.confirm("You have unsaved changes. Start a fresh session and discard them?")
    ) {
      return;
    }

    trackManager.stop();
    isApplyingSession = true;
    store.resetSession();
    isApplyingSession = false;
    selectedSessionId = "";
    tabs.sessionName.value = "";
    baselineSessionHash = getSessionStateHash(store.getState());
    isSessionDirty = false;
    renderSessionSelect();
    renderSessionDirty();
  }

  async function deleteSelectedSession() {
    const selected = getSelectedSession();
    if (!selected) {
      return;
    }

    const allowDelete = window.confirm(`Delete session "${selected.name}"?`);
    if (!allowDelete) {
      return;
    }

    savedSessions = savedSessions.filter((item) => item.id !== selected.id);
    const didWrite = await writeSessionsToDatabase(savedSessions);
    if (!didWrite) {
      showSessionMessage("Delete failed: database unavailable.", "error");
      return;
    }
    selectedSessionId = "";
    tabs.sessionName.value = "";
    renderSessionSelect();
    showSessionMessage(`Session "${selected.name}" deleted.`, "ok");
  }

  tabs.sessionSelect.addEventListener("change", (event) => {
    selectedSessionId = String(event.target.value || "");
    syncSessionNameFromSelection();
    renderSessionSelect();
  });

  tabs.sessionSave.addEventListener("click", async () => {
    await saveCurrentSession();
  });

  tabs.sessionLoad.addEventListener("click", () => {
    if (!selectedSessionId) {
      return;
    }
    loadSessionById(selectedSessionId);
  });

  tabs.sessionNew.addEventListener("click", () => {
    createFreshSession();
  });

  tabs.sessionDelete.addEventListener("click", async () => {
    await deleteSelectedSession();
  });

  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveCurrentSession();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!isSessionDirty) {
      return;
    }
    event.preventDefault();
    event.returnValue = "You have unsaved session changes. Save before leaving?";
  });

  store.subscribe((nextState) => {
    setActiveTabUi(nextState, tabs);

    const nextMixerSerialized = JSON.stringify(nextState.mixer);
    if (nextMixerSerialized !== previousMixer) {
      previousMixer = nextMixerSerialized;
      mixer.applyMixerState(nextState.mixer);
      setMasterVolume(nextState.mixer.masterGain);
    }

    if (nextState.ui.activeTab === "daw" && previousActiveTab !== "daw") {
      dawView.onTabActivated().catch((error) => {
        console.error("Failed to activate DAW tab:", error);
      });
    }
    previousActiveTab = nextState.ui.activeTab;

    updateDirtyFromState(nextState);
  });

  const initialState = store.getState();
  setActiveTabUi(initialState, tabs);
  if (initialState.ui.activeTab === "daw") {
    dawView.onTabActivated().catch((error) => {
      console.error("Failed to activate DAW tab:", error);
    });
  }
  renderSessionSelect();
  renderSessionDirty();
}
