import { getNoteColor } from "../bass/noteColors";
import { normalizeNoteName } from "../bass/rootNoteUtils";
import { getAudioNodes, resumeAudioContext } from "../audio/context";
import {
  audioBufferToMp3Blob,
  audioBufferToWavBlob,
  captureNodeOutputToAudioBuffer,
  downloadBlob
} from "../audio/exporter";
import {
  NOTE_OPTIONS_SHARP,
  PIANO_CHORD_QUALITIES,
  buildChordSymbol,
  getChordRootColor,
  normalizeChordData
} from "../piano/chordUtils";
import { SHARED_DRUM_CLIP_REF, TRACK_IDS } from "./transportStore";

const PIANO_SF2_OPTIONS = [
  {
    value: "/instruments/1115_Korg_IS50_Marimboyd.sf2",
    label: "Korg IS50 (Marimboyd)"
  },
  {
    value: "/instruments/Stein_Grand_Piano.sf2",
    label: "Stein Grand Piano"
  },
  {
    value: "/instruments/projectsam_world_percussion.sf2",
    label: "ProjectSAM World Percussion (True Strike 2 W)"
  }
];

function renderPianoSf2ChoiceOptions() {
  const builtIn = PIANO_SF2_OPTIONS.map(
    (option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`
  ).join("");
  return `${builtIn}<option value="custom">Custom Path</option>`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cloneCell(cell) {
  if (!cell || typeof cell !== "object") {
    return null;
  }
  return JSON.parse(JSON.stringify(cell));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function getTrackByType(state, type) {
  return state.tracks.find((track) => track.type === type) || null;
}

function getPianoTrack(state) {
  return (
    state.tracks.find((track) => track.id === TRACK_IDS.PIANO) ||
    state.tracks.find((track) => track.engine === "piano_sf2") ||
    null
  );
}

function getVisibleTracks(state) {
  return state.tracks;
}

function isBassTrack(track) {
  return track.id === TRACK_IDS.BASS || track.engine === "bass_sf2" || track.type === "bass";
}

function isPianoTrack(track) {
  return track.id === TRACK_IDS.PIANO || track.engine === "piano_sf2";
}

function isPadTrack(track) {
  return track.engine === "pad_synth";
}

function isDrumTrack(track) {
  return track.type === "drum" || track.engine === "drum_clip";
}

function getArrangementCell(state, trackId, barIndex) {
  return state.arrangement?.[trackId]?.[barIndex] || null;
}

function getSortedDrumClipEntries(state) {
  const entries = Object.entries(state.drumClips || {});
  entries.sort((left, right) => {
    if (left[0] === SHARED_DRUM_CLIP_REF) {
      return -1;
    }
    if (right[0] === SHARED_DRUM_CLIP_REF) {
      return 1;
    }
    return String(left[1]?.name || left[0]).localeCompare(String(right[1]?.name || right[0]), undefined, {
      sensitivity: "base"
    });
  });
  return entries;
}

function getDrumClipName(state, clipRef) {
  const safeRef = String(clipRef || SHARED_DRUM_CLIP_REF);
  return (
    state.drumClips?.[safeRef]?.name ||
    state.drumClips?.[SHARED_DRUM_CLIP_REF]?.name ||
    "Drum"
  );
}

function renderHeaders(barCount, state) {
  const isPlaying = state.transport.isPlaying && state.transport.playContext === "daw";
  const activeBar = isPlaying ? Number(state.ui.dawPlayhead?.barIndex) : -1;
  const loop = state.transport.loopRange;
  return Array.from({ length: barCount }, (_, index) => {
    const cls = [
      "daw-bar-head-cell",
      loop.enabled && index >= loop.startBar && index <= loop.endBar ? "in-loop" : "",
      activeBar === index ? "active" : ""
    ]
      .filter(Boolean)
      .join(" ");
    return `<div class="${cls}">${index + 1}</div>`;
  }).join("");
}

function renderTrackListRows(tracks, selectedTrackId) {
  return tracks
    .map((track) => {
      const canDelete = isPadTrack(track);
      return `<div class="daw-track-row ${selectedTrackId === track.id ? "selected" : ""}">
        <div class="daw-track-title">${track.name}</div>
        <div class="daw-track-controls">
          <label>Vol <input data-role="track-volume" data-track-id="${track.id}" type="range" min="0" max="1" step="0.001" value="${track.volume}" /></label>
          <label class="tiny"><input data-role="track-mute" data-track-id="${track.id}" type="checkbox" ${track.mute ? "checked" : ""} />M</label>
          <label class="tiny"><input data-role="track-solo" data-track-id="${track.id}" type="checkbox" ${track.solo ? "checked" : ""} />S</label>
          ${canDelete ? `<button type="button" data-role="remove-track" data-track-id="${track.id}">Del</button>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

function renderNoteBlock(data, activeHalf) {
  if (data.split) {
    const first = normalizeNoteName(data.root || "C", "C");
    const second = normalizeNoteName(data.secondRoot || data.root || "G", "G");
    const c1 = getNoteColor(first);
    const c2 = getNoteColor(second);
    return `<div class="daw-note-split">
      <div class="daw-note-half ${activeHalf === 0 ? "active-half" : ""}" style="--note-bg:${c1.bg};--note-border:${c1.border};--note-text:${c1.text};--note-glow:${c1.glow};">${first}</div>
      <div class="daw-note-half ${activeHalf === 1 ? "active-half" : ""}" style="--note-bg:${c2.bg};--note-border:${c2.border};--note-text:${c2.text};--note-glow:${c2.glow};">${second}</div>
    </div>`;
  }
  const note = normalizeNoteName(data.root || "C", "C");
  const color = getNoteColor(note);
  return `<div class="daw-note-full ${activeHalf !== null ? "active-half" : ""}" style="--note-bg:${color.bg};--note-border:${color.border};--note-text:${color.text};--note-glow:${color.glow};">${note}</div>`;
}

function renderChordSymbol(chordData) {
  const normalized = normalizeChordData(chordData, "C");
  return normalized.symbol || buildChordSymbol(normalized);
}

function renderChordBlock(data, activeHalf) {
  if (data.type === "split") {
    const first = normalizeChordData(data.firstHalf, "C");
    const second = normalizeChordData(data.secondHalf, "G");
    const c1 = getChordRootColor(first);
    const c2 = getChordRootColor(second);
    return `<div class="daw-chord-split">
      <div class="daw-chord-half ${activeHalf === 0 ? "active-half" : ""}" style="--note-bg:${c1.bg};--note-border:${c1.border};--note-text:${c1.text};--note-glow:${c1.glow};">${escapeHtml(renderChordSymbol(first))}</div>
      <div class="daw-chord-half ${activeHalf === 1 ? "active-half" : ""}" style="--note-bg:${c2.bg};--note-border:${c2.border};--note-text:${c2.text};--note-glow:${c2.glow};">${escapeHtml(renderChordSymbol(second))}</div>
    </div>`;
  }

  const chord = normalizeChordData(data.chord, "C");
  const color = getChordRootColor(chord);
  return `<div class="daw-chord-full ${activeHalf !== null ? "active-half" : ""}" style="--note-bg:${color.bg};--note-border:${color.border};--note-text:${color.text};--note-glow:${color.glow};">${escapeHtml(renderChordSymbol(chord))}</div>`;
}

function renderGridRows(state, tracks) {
  const bars = state.transport.arrangementBars;
  const selected = state.ui.dawSelection;
  const isPlaying = state.transport.isPlaying && state.transport.playContext === "daw";
  const playhead = state.ui.dawPlayhead || { barIndex: -1, activeHalf: null };
  return tracks
    .map((track) => {
      const row = Array.from({ length: bars }, (_, barIndex) => {
        const cell = getArrangementCell(state, track.id, barIndex);
        const isSelected =
          selected && selected.trackId === track.id && Number(selected.barIndex) === barIndex;
        const isActiveBar = isPlaying && Number(playhead.barIndex) === barIndex;
        const cls = [
          "daw-bar-cell",
          isDrumTrack(track)
            ? "daw-drum-cell"
            : isBassTrack(track) || isPianoTrack(track) || isPadTrack(track)
              ? "daw-note-cell"
              : "daw-chord-cell",
          cell ? "has-content" : "",
          isSelected ? "selected" : "",
          isActiveBar ? "active-bar" : ""
        ]
          .filter(Boolean)
          .join(" ");
        let inner = '<span class="daw-empty-label">--</span>';
        if (isDrumTrack(track)) {
          if (cell && (cell.type === "drum" || cell.kind === "drum")) {
            const clipRef = String(cell?.clipRef || cell?.data?.clipRef || SHARED_DRUM_CLIP_REF);
            const clipName = getDrumClipName(state, clipRef);
            inner = `<span class="daw-drum-label" title="${escapeHtml(clipName)}">${escapeHtml(clipName)}</span>`;
          } else {
            inner = '<span class="daw-empty-label">+</span>';
          }
        } else if ((isBassTrack(track) || isPianoTrack(track) || isPadTrack(track)) && cell && cell.type === "note") {
          inner = renderNoteBlock(
            cell,
            isActiveBar ? playhead.activeHalf : null
          );
        }
        return `<button type="button" class="${cls}" data-role="grid-cell" data-track-id="${track.id}" data-bar-index="${barIndex}">${inner}</button>`;
      }).join("");
      return `<div class="daw-grid-row">${row}</div>`;
    })
    .join("");
}

function hasAnyCellsByKind(state, track, kind) {
  if (!track) {
    return false;
  }
  return Object.values(state.arrangement?.[track.id] || {}).some((cell) => {
    if (!cell) {
      return false;
    }
    if (kind === "drum") {
      return cell.type === "drum" || cell.kind === "drum";
    }
    if (kind === "note") {
      return cell.type === "note" || cell.kind === "note" || cell.kind === "chord";
    }
    return false;
  });
}

function statusLabel(status, error) {
  if (status === "loading") {
    return "Loading...";
  }
  if (status === "ready") {
    return "Ready";
  }
  if (status === "error") {
    return error ? `Error: ${error}` : "Error";
  }
  return "Idle";
}

function getPianoSf2ChoiceValue(path) {
  const safePath = String(path || "").trim();
  if (!safePath) {
    return "custom";
  }
  const match = PIANO_SF2_OPTIONS.find((item) => item.value === safePath);
  return match ? match.value : "custom";
}

function isRenderableArrangementCell(cell) {
  return Boolean(
    cell &&
      typeof cell === "object" &&
      (cell.type === "drum" || cell.type === "note" || cell.kind === "drum" || cell.kind === "note" || cell.kind === "chord")
  );
}

function getGeneratedArrangementRange(state) {
  const arrangement = state?.arrangement && typeof state.arrangement === "object" ? state.arrangement : {};
  let minBar = Number.POSITIVE_INFINITY;
  let maxBar = -1;

  for (const track of state?.tracks || []) {
    const trackCells = arrangement?.[track.id];
    if (!trackCells || typeof trackCells !== "object") {
      continue;
    }
    for (const [barKey, cell] of Object.entries(trackCells)) {
      if (!isRenderableArrangementCell(cell)) {
        continue;
      }
      const barIndex = Number(barKey);
      if (!Number.isInteger(barIndex) || barIndex < 0) {
        continue;
      }
      if (barIndex < minBar) {
        minBar = barIndex;
      }
      if (barIndex > maxBar) {
        maxBar = barIndex;
      }
    }
  }

  if (maxBar < 0 || !Number.isFinite(minBar)) {
    return null;
  }

  return {
    startBar: minBar,
    endBar: maxBar,
    bars: maxBar - minBar + 1
  };
}

export function initDawView(rootElement, { store, trackManager, padSynth, bassSf2Player, pianoSf2Player }) {
  if (!rootElement) {
    throw new Error("Missing DAW root element.");
  }

  rootElement.innerHTML = `
    <section class="panel">
      <h2>Backing Track Transport</h2>
      <div class="control-grid">
        <label class="control"><span>BPM</span><input id="daw-bpm-number" type="number" min="30" max="300" step="1" /></label>
        <label class="control"><span>Swing %</span><input id="daw-swing" type="range" min="0" max="60" step="1" /></label>
        <label class="control"><span>Track Length (minutes)</span><input id="daw-track-minutes" type="number" min="1" max="30" step="1" /></label>
        <label class="control"><span>Arrangement Bars</span><input id="daw-arrangement-bars" type="number" min="8" max="256" step="4" /></label>
        <label class="control checkbox"><input id="daw-loop-enabled" type="checkbox" /><span>Enable Loop Range</span></label>
        <label class="control"><span>Loop Start (bar)</span><input id="daw-loop-start" type="number" min="1" step="1" /></label>
        <label class="control"><span>Loop End (bar)</span><input id="daw-loop-end" type="number" min="1" step="1" /></label>
      </div>
      <div class="transport-buttons"><button id="daw-play" type="button">Play</button><button id="daw-stop" type="button">Stop</button></div>
    </section>

    <section class="panel">
      <h2>Bass Engine</h2>
      <div class="control-grid">
        <label class="control"><span>Rhythm Preset</span><select id="daw-bass-rhythm"><option value="root8ths">Root 8ths</option><option value="rootFifth">Root + Fifth Groove</option><option value="octave">Octave Groove</option><option value="walking">Simple Walking</option></select></label>
        <label class="control checkbox"><input id="daw-bass-humanize-velocity" type="checkbox" /><span>Humanize Velocity (+/-5%)</span></label>
        <label class="control checkbox"><input id="daw-bass-humanize-timing" type="checkbox" /><span>Humanize Timing (+/-5ms)</span></label>
        <label class="control"><span>Bass SF2 Path</span><input id="daw-bass-sf2-path" type="text" /></label>
      </div>
      <div class="transport-buttons"><button id="daw-bass-sf2-load" type="button">Load Bass SF2</button><button id="daw-bass-sf2-test" type="button">Test Bass</button><span id="daw-bass-sf2-status" class="inline-status">Idle</span></div>
      <div id="daw-bass-warning" class="inline-warning"></div>
    </section>

    <section class="panel">
      <h2>Piano Engine</h2>
      <div class="control-grid">
        <label class="control"><span>Play Style</span><select id="daw-piano-style"><option value="block">Block Chords</option><option value="stabs8">8th Stabs</option><option value="arpUp">Arpeggio Up</option><option value="arpDown">Arpeggio Down</option><option value="arpUpDown">Arpeggio Up/Down</option></select></label>
        <label class="control checkbox"><input id="daw-piano-humanize-velocity" type="checkbox" /><span>Humanize Velocity (+/-5%)</span></label>
        <label class="control checkbox"><input id="daw-piano-humanize-timing" type="checkbox" /><span>Humanize Timing (+/-5ms)</span></label>
        <label class="control"><span>Piano SF2 Option</span><select id="daw-piano-sf2-choice">${renderPianoSf2ChoiceOptions()}</select></label>
        <label class="control"><span>Piano SF2 Path</span><input id="daw-piano-sf2-path" type="text" /></label>
      </div>
      <div class="transport-buttons"><button id="daw-piano-sf2-load" type="button">Load Piano SF2</button><button id="daw-piano-sf2-test" type="button">Test Piano</button><span id="daw-piano-sf2-status" class="inline-status">Idle</span></div>
      <div id="daw-piano-warning" class="inline-warning"></div>
    </section>

    <section class="panel">
      <h2>DAW Export</h2>
      <div class="control-grid">
        <label class="control"><span>Generated Length</span><input id="daw-export-minutes" type="text" readonly /></label>
      </div>
      <div class="transport-buttons">
        <button id="daw-export-wav" type="button">Export WAV</button>
        <button id="daw-export-mp3" type="button">Export MP3</button>
        <span id="daw-export-status" class="inline-status">Idle</span>
      </div>
      <div class="export-progress-wrap">
        <div class="export-progress-track">
          <div id="daw-export-progress-fill" class="export-progress-fill"></div>
        </div>
        <div id="daw-export-progress-text" class="export-progress-text">Idle</div>
      </div>
    </section>

    <section class="panel">
      <h2>Arrangement</h2>
      <div class="transport-buttons">
        <select id="daw-add-track-type">
          <option value="pad_synth">Pad Synth</option>
          <option value="drum_clip">Drum (disabled if exists)</option>
          <option value="bass_sf2">Bass (disabled if exists)</option>
          <option value="piano_sf2">Piano (disabled if exists)</option>
        </select>
        <button id="daw-add-track" type="button">Add Track</button>
      </div>
      <div class="inline-status">Drum bars are clip-based. Click a Drums cell and select a clip. Changes apply immediately.</div>
      <div class="daw-arrangement-shell">
        <div class="daw-track-list-column"><div class="daw-track-header">Track List</div><div id="daw-track-list"></div></div>
        <div class="daw-grid-column"><div class="daw-grid-scroll"><div id="daw-bar-head" class="daw-bar-head-row"></div><div id="daw-grid-rows"></div></div></div>
      </div>
    </section>

    <section class="panel">
      <h2>Selected Track Inspector</h2>
      <div id="daw-track-inspector"></div>
    </section>

    <div id="daw-note-editor" class="daw-note-editor hidden" role="dialog" aria-modal="true">
      <div class="daw-note-editor-card">
        <h3 id="daw-editor-title">Edit Bass Bar</h3>
        <div class="control-grid">
          <label class="control"><span>Bar Mode</span><select id="editor-mode"><option value="full">Full Bar</option><option value="split">Split Halves</option></select></label>
          <label class="control" id="editor-full-wrap"><span>Note</span><select id="editor-full-note"></select></label>
          <label class="control hidden" id="editor-first-wrap"><span>First Half</span><select id="editor-first-note"></select></label>
          <label class="control hidden" id="editor-second-wrap"><span>Second Half</span><select id="editor-second-note"></select></label>
        </div>
        <div class="transport-buttons"><button id="editor-save" type="button">Done</button><button id="editor-clear" type="button">Clear</button><button id="editor-cancel" type="button">Cancel</button></div>
      </div>
    </div>

    <div id="daw-chord-editor" class="daw-note-editor hidden" role="dialog" aria-modal="true">
      <div class="daw-note-editor-card">
        <h3 id="daw-chord-editor-title">Edit Piano Bar</h3>
        <div class="control-grid">
          <label class="control"><span>Bar Mode</span><select id="chord-editor-mode"><option value="full">Full Bar</option><option value="split">Split Halves</option></select></label>
          <label class="control" id="chord-full-root-wrap"><span>Root</span><select id="chord-full-root"></select></label>
          <label class="control" id="chord-full-quality-wrap"><span>Quality</span><select id="chord-full-quality"></select></label>
          <label class="control" id="chord-full-bass-wrap"><span>Slash Bass</span><select id="chord-full-bass"></select></label>
          <label class="control" id="chord-full-symbol-wrap"><span>Symbol</span><input id="chord-full-symbol" type="text" readonly /></label>
          <label class="control hidden" id="chord-first-root-wrap"><span>First Root</span><select id="chord-first-root"></select></label>
          <label class="control hidden" id="chord-first-quality-wrap"><span>First Quality</span><select id="chord-first-quality"></select></label>
          <label class="control hidden" id="chord-first-bass-wrap"><span>First Slash</span><select id="chord-first-bass"></select></label>
          <label class="control hidden" id="chord-first-symbol-wrap"><span>First Symbol</span><input id="chord-first-symbol" type="text" readonly /></label>
          <label class="control hidden" id="chord-second-root-wrap"><span>Second Root</span><select id="chord-second-root"></select></label>
          <label class="control hidden" id="chord-second-quality-wrap"><span>Second Quality</span><select id="chord-second-quality"></select></label>
          <label class="control hidden" id="chord-second-bass-wrap"><span>Second Slash</span><select id="chord-second-bass"></select></label>
          <label class="control hidden" id="chord-second-symbol-wrap"><span>Second Symbol</span><input id="chord-second-symbol" type="text" readonly /></label>
        </div>
        <div class="transport-buttons"><button id="chord-editor-save" type="button">Done</button><button id="chord-editor-clear" type="button">Clear</button><button id="chord-editor-cancel" type="button">Cancel</button></div>
      </div>
    </div>

    <div id="daw-drum-editor" class="daw-note-editor hidden" role="dialog" aria-modal="true">
      <div class="daw-note-editor-card">
        <h3 id="daw-drum-editor-title">Edit Drum Bar</h3>
        <div class="control-grid">
          <label class="control"><span>Drum Clip</span><select id="drum-editor-clip"></select></label>
        </div>
        <div class="transport-buttons"><button id="drum-editor-save" type="button">Done</button><button id="drum-editor-clear" type="button">Clear</button><button id="drum-editor-cancel" type="button">Cancel</button></div>
      </div>
    </div>
  `;

  const controls = {
    bpmNumber: rootElement.querySelector("#daw-bpm-number"),
    swing: rootElement.querySelector("#daw-swing"),
    trackMinutes: rootElement.querySelector("#daw-track-minutes"),
    exportMinutes: rootElement.querySelector("#daw-export-minutes"),
    arrangementBars: rootElement.querySelector("#daw-arrangement-bars"),
    loopEnabled: rootElement.querySelector("#daw-loop-enabled"),
    loopStart: rootElement.querySelector("#daw-loop-start"),
    loopEnd: rootElement.querySelector("#daw-loop-end"),
    play: rootElement.querySelector("#daw-play"),
    stop: rootElement.querySelector("#daw-stop"),
    bassRhythm: rootElement.querySelector("#daw-bass-rhythm"),
    bassHumanizeVelocity: rootElement.querySelector("#daw-bass-humanize-velocity"),
    bassHumanizeTiming: rootElement.querySelector("#daw-bass-humanize-timing"),
    bassSf2Path: rootElement.querySelector("#daw-bass-sf2-path"),
    bassSf2Load: rootElement.querySelector("#daw-bass-sf2-load"),
    bassSf2Test: rootElement.querySelector("#daw-bass-sf2-test"),
    bassSf2Status: rootElement.querySelector("#daw-bass-sf2-status"),
    bassWarning: rootElement.querySelector("#daw-bass-warning"),
    pianoStyle: rootElement.querySelector("#daw-piano-style"),
    pianoHumanizeVelocity: rootElement.querySelector("#daw-piano-humanize-velocity"),
    pianoHumanizeTiming: rootElement.querySelector("#daw-piano-humanize-timing"),
    pianoSf2Choice: rootElement.querySelector("#daw-piano-sf2-choice"),
    pianoSf2Path: rootElement.querySelector("#daw-piano-sf2-path"),
    pianoSf2Load: rootElement.querySelector("#daw-piano-sf2-load"),
    pianoSf2Test: rootElement.querySelector("#daw-piano-sf2-test"),
    pianoSf2Status: rootElement.querySelector("#daw-piano-sf2-status"),
    pianoWarning: rootElement.querySelector("#daw-piano-warning"),
    exportWav: rootElement.querySelector("#daw-export-wav"),
    exportMp3: rootElement.querySelector("#daw-export-mp3"),
    exportStatus: rootElement.querySelector("#daw-export-status"),
    exportProgressFill: rootElement.querySelector("#daw-export-progress-fill"),
    exportProgressText: rootElement.querySelector("#daw-export-progress-text"),
    addTrackType: rootElement.querySelector("#daw-add-track-type"),
    addTrack: rootElement.querySelector("#daw-add-track"),
    trackInspector: rootElement.querySelector("#daw-track-inspector"),
    trackList: rootElement.querySelector("#daw-track-list"),
    barHead: rootElement.querySelector("#daw-bar-head"),
    gridRows: rootElement.querySelector("#daw-grid-rows"),
    noteEditor: rootElement.querySelector("#daw-note-editor"),
    editorTitle: rootElement.querySelector("#daw-editor-title"),
    editorMode: rootElement.querySelector("#editor-mode"),
    editorFullWrap: rootElement.querySelector("#editor-full-wrap"),
    editorFirstWrap: rootElement.querySelector("#editor-first-wrap"),
    editorSecondWrap: rootElement.querySelector("#editor-second-wrap"),
    editorFullNote: rootElement.querySelector("#editor-full-note"),
    editorFirstNote: rootElement.querySelector("#editor-first-note"),
    editorSecondNote: rootElement.querySelector("#editor-second-note"),
    editorSave: rootElement.querySelector("#editor-save"),
    editorClear: rootElement.querySelector("#editor-clear"),
    editorCancel: rootElement.querySelector("#editor-cancel"),
    chordEditor: rootElement.querySelector("#daw-chord-editor"),
    chordEditorTitle: rootElement.querySelector("#daw-chord-editor-title"),
    chordEditorMode: rootElement.querySelector("#chord-editor-mode"),
    chordFullRootWrap: rootElement.querySelector("#chord-full-root-wrap"),
    chordFullQualityWrap: rootElement.querySelector("#chord-full-quality-wrap"),
    chordFullBassWrap: rootElement.querySelector("#chord-full-bass-wrap"),
    chordFullSymbolWrap: rootElement.querySelector("#chord-full-symbol-wrap"),
    chordFirstRootWrap: rootElement.querySelector("#chord-first-root-wrap"),
    chordFirstQualityWrap: rootElement.querySelector("#chord-first-quality-wrap"),
    chordFirstBassWrap: rootElement.querySelector("#chord-first-bass-wrap"),
    chordFirstSymbolWrap: rootElement.querySelector("#chord-first-symbol-wrap"),
    chordSecondRootWrap: rootElement.querySelector("#chord-second-root-wrap"),
    chordSecondQualityWrap: rootElement.querySelector("#chord-second-quality-wrap"),
    chordSecondBassWrap: rootElement.querySelector("#chord-second-bass-wrap"),
    chordSecondSymbolWrap: rootElement.querySelector("#chord-second-symbol-wrap"),
    chordFullRoot: rootElement.querySelector("#chord-full-root"),
    chordFullQuality: rootElement.querySelector("#chord-full-quality"),
    chordFullBass: rootElement.querySelector("#chord-full-bass"),
    chordFullSymbol: rootElement.querySelector("#chord-full-symbol"),
    chordFirstRoot: rootElement.querySelector("#chord-first-root"),
    chordFirstQuality: rootElement.querySelector("#chord-first-quality"),
    chordFirstBass: rootElement.querySelector("#chord-first-bass"),
    chordFirstSymbol: rootElement.querySelector("#chord-first-symbol"),
    chordSecondRoot: rootElement.querySelector("#chord-second-root"),
    chordSecondQuality: rootElement.querySelector("#chord-second-quality"),
    chordSecondBass: rootElement.querySelector("#chord-second-bass"),
    chordSecondSymbol: rootElement.querySelector("#chord-second-symbol"),
    chordEditorSave: rootElement.querySelector("#chord-editor-save"),
    chordEditorClear: rootElement.querySelector("#chord-editor-clear"),
    chordEditorCancel: rootElement.querySelector("#chord-editor-cancel"),
    drumEditor: rootElement.querySelector("#daw-drum-editor"),
    drumEditorTitle: rootElement.querySelector("#daw-drum-editor-title"),
    drumEditorClip: rootElement.querySelector("#drum-editor-clip"),
    drumEditorSave: rootElement.querySelector("#drum-editor-save"),
    drumEditorClear: rootElement.querySelector("#drum-editor-clear"),
    drumEditorCancel: rootElement.querySelector("#drum-editor-cancel")
  };

  for (const note of NOTE_OPTIONS_SHARP) {
    for (const element of [controls.editorFullNote, controls.editorFirstNote, controls.editorSecondNote]) {
      const option = document.createElement("option");
      option.value = note;
      option.textContent = note;
      element.append(option);
    }
  }

  for (const note of NOTE_OPTIONS_SHARP) {
    for (const element of [
      controls.chordFullRoot,
      controls.chordFirstRoot,
      controls.chordSecondRoot
    ]) {
      const option = document.createElement("option");
      option.value = note;
      option.textContent = note;
      element.append(option);
    }
  }

  for (const quality of PIANO_CHORD_QUALITIES) {
    for (const element of [
      controls.chordFullQuality,
      controls.chordFirstQuality,
      controls.chordSecondQuality
    ]) {
      const option = document.createElement("option");
      option.value = quality;
      option.textContent = quality;
      element.append(option);
    }
  }

  for (const element of [controls.chordFullBass, controls.chordFirstBass, controls.chordSecondBass]) {
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "None";
    element.append(noneOption);
    for (const note of NOTE_OPTIONS_SHARP) {
      const option = document.createElement("option");
      option.value = note;
      option.textContent = note;
      element.append(option);
    }
  }

  const engineUi = {
    bass: { loadInFlight: false, loadPromise: null, transientStatus: "" },
    piano: { loadInFlight: false, loadPromise: null, transientStatus: "" }
  };
  const exportUi = {
    isExporting: false,
    progress: 0,
    status: "Idle",
    detail: "Idle"
  };
  const editorState = {
    open: false,
    trackId: "",
    trackName: "",
    barIndex: -1,
    mode: "full",
    fullNote: "C",
    firstHalf: "C",
    secondHalf: "G"
  };
  const chordEditorState = {
    open: false,
    trackId: "",
    trackName: "",
    barIndex: -1,
    mode: "full",
    fullChord: normalizeChordData({ root: "C", quality: "maj", bass: null }, "C"),
    firstHalf: normalizeChordData({ root: "C", quality: "maj", bass: null }, "C"),
    secondHalf: normalizeChordData({ root: "G", quality: "maj", bass: null }, "G")
  };
  const drumEditorState = {
    open: false,
    trackId: "",
    trackName: "",
    barIndex: -1,
    clipRef: SHARED_DRUM_CLIP_REF
  };

  function setEditorMode(mode) {
    const safeMode = mode === "split" ? "split" : "full";
    editorState.mode = safeMode;
    controls.editorMode.value = safeMode;
    controls.editorFullWrap.classList.toggle("hidden", safeMode === "split");
    controls.editorFirstWrap.classList.toggle("hidden", safeMode !== "split");
    controls.editorSecondWrap.classList.toggle("hidden", safeMode !== "split");
  }

  function openNoteEditor(trackId, trackName, barIndex) {
    closeChordEditor();
    closeDrumEditor();
    const state = store.getState();
    const cell = getArrangementCell(state, trackId, barIndex);
    const data = cell?.type === "note"
      ? cell
      : { type: "note", root: "C", split: false, secondRoot: null };
    editorState.open = true;
    editorState.trackId = trackId;
    editorState.trackName = trackName;
    editorState.barIndex = barIndex;
    if (data.split) {
      editorState.mode = "split";
      editorState.firstHalf = normalizeNoteName(data.root || "C", "C");
      editorState.secondHalf = normalizeNoteName(data.secondRoot || "G", "G");
    } else {
      editorState.mode = "full";
      editorState.fullNote = normalizeNoteName(data.root || "C", "C");
    }
    controls.editorTitle.textContent = `Edit ${trackName} Bar`;
    controls.editorFullNote.value = editorState.fullNote;
    controls.editorFirstNote.value = editorState.firstHalf;
    controls.editorSecondNote.value = editorState.secondHalf;
    setEditorMode(editorState.mode);
    controls.noteEditor.classList.remove("hidden");
  }

  function closeNoteEditor() {
    editorState.open = false;
    controls.noteEditor.classList.add("hidden");
  }

  function setChordEditorMode(mode) {
    const safeMode = mode === "split" ? "split" : "full";
    chordEditorState.mode = safeMode;
    controls.chordEditorMode.value = safeMode;

    const isSplit = safeMode === "split";
    controls.chordFullRootWrap.classList.toggle("hidden", isSplit);
    controls.chordFullQualityWrap.classList.toggle("hidden", isSplit);
    controls.chordFullBassWrap.classList.toggle("hidden", isSplit);
    controls.chordFullSymbolWrap.classList.toggle("hidden", isSplit);
    controls.chordFirstRootWrap.classList.toggle("hidden", !isSplit);
    controls.chordFirstQualityWrap.classList.toggle("hidden", !isSplit);
    controls.chordFirstBassWrap.classList.toggle("hidden", !isSplit);
    controls.chordFirstSymbolWrap.classList.toggle("hidden", !isSplit);
    controls.chordSecondRootWrap.classList.toggle("hidden", !isSplit);
    controls.chordSecondQualityWrap.classList.toggle("hidden", !isSplit);
    controls.chordSecondBassWrap.classList.toggle("hidden", !isSplit);
    controls.chordSecondSymbolWrap.classList.toggle("hidden", !isSplit);
  }

  function pullChordFromControls(rootControl, qualityControl, bassControl, fallbackRoot) {
    return normalizeChordData(
      {
        root: String(rootControl.value || fallbackRoot),
        quality: String(qualityControl.value || "maj"),
        bass: String(bassControl.value || "").trim() || null
      },
      fallbackRoot
    );
  }

  function refreshChordEditorSymbols() {
    chordEditorState.fullChord = pullChordFromControls(
      controls.chordFullRoot,
      controls.chordFullQuality,
      controls.chordFullBass,
      "C"
    );
    chordEditorState.firstHalf = pullChordFromControls(
      controls.chordFirstRoot,
      controls.chordFirstQuality,
      controls.chordFirstBass,
      "C"
    );
    chordEditorState.secondHalf = pullChordFromControls(
      controls.chordSecondRoot,
      controls.chordSecondQuality,
      controls.chordSecondBass,
      "G"
    );

    controls.chordFullSymbol.value = chordEditorState.fullChord.symbol;
    controls.chordFirstSymbol.value = chordEditorState.firstHalf.symbol;
    controls.chordSecondSymbol.value = chordEditorState.secondHalf.symbol;
  }

  function loadChordIntoControls(chord, rootControl, qualityControl, bassControl) {
    const normalized = normalizeChordData(chord, "C");
    rootControl.value = normalized.root;
    qualityControl.value = normalized.quality;
    bassControl.value = normalized.bass || "";
  }

  function openChordEditor(trackId, trackName, barIndex) {
    closeNoteEditor();
    closeDrumEditor();
    const state = store.getState();
    const cell = getArrangementCell(state, trackId, barIndex);
    const data =
      cell?.kind === "chord"
        ? cell.data
        : {
            type: "full",
            chord: normalizeChordData({ root: "C", quality: "maj", bass: null }, "C")
          };

    chordEditorState.open = true;
    chordEditorState.trackId = trackId;
    chordEditorState.trackName = trackName;
    chordEditorState.barIndex = barIndex;
    chordEditorState.mode = data.type === "split" ? "split" : "full";
    chordEditorState.fullChord =
      data.type === "split"
        ? normalizeChordData({ root: "C", quality: "maj", bass: null }, "C")
        : normalizeChordData(data.chord, "C");
    chordEditorState.firstHalf =
      data.type === "split"
        ? normalizeChordData(data.firstHalf, "C")
        : normalizeChordData({ root: "C", quality: "maj", bass: null }, "C");
    chordEditorState.secondHalf =
      data.type === "split"
        ? normalizeChordData(data.secondHalf, "G")
        : normalizeChordData({ root: "G", quality: "maj", bass: null }, "G");

    controls.chordEditorTitle.textContent = `Edit ${trackName} Bar`;
    controls.chordEditorMode.value = chordEditorState.mode;
    loadChordIntoControls(
      chordEditorState.fullChord,
      controls.chordFullRoot,
      controls.chordFullQuality,
      controls.chordFullBass
    );
    loadChordIntoControls(
      chordEditorState.firstHalf,
      controls.chordFirstRoot,
      controls.chordFirstQuality,
      controls.chordFirstBass
    );
    loadChordIntoControls(
      chordEditorState.secondHalf,
      controls.chordSecondRoot,
      controls.chordSecondQuality,
      controls.chordSecondBass
    );
    setChordEditorMode(chordEditorState.mode);
    refreshChordEditorSymbols();
    controls.chordEditor.classList.remove("hidden");
  }

  function closeChordEditor() {
    chordEditorState.open = false;
    controls.chordEditor.classList.add("hidden");
  }

  function openDrumEditor(trackId, trackName, barIndex) {
    closeNoteEditor();
    closeChordEditor();
    const state = store.getState();
    const clipEntries = getSortedDrumClipEntries(state);
    const cell = getArrangementCell(state, trackId, barIndex);
    const currentClipRef =
      (cell?.type === "drum" || cell?.kind === "drum")
        ? String(cell?.clipRef || cell?.data?.clipRef || SHARED_DRUM_CLIP_REF)
        : SHARED_DRUM_CLIP_REF;
    const selectedClipRef = clipEntries.some(([ref]) => ref === currentClipRef)
      ? currentClipRef
      : SHARED_DRUM_CLIP_REF;

    controls.drumEditorClip.innerHTML = clipEntries
      .map(([ref, clip]) => {
        const name = String(clip?.name || ref);
        return `<option value="${escapeHtml(ref)}">${escapeHtml(name)}</option>`;
      })
      .join("");
    controls.drumEditorClip.value = selectedClipRef;

    drumEditorState.open = true;
    drumEditorState.trackId = trackId;
    drumEditorState.trackName = trackName;
    drumEditorState.barIndex = barIndex;
    drumEditorState.clipRef = selectedClipRef;
    controls.drumEditorTitle.textContent = `Edit ${trackName} Bar`;
    controls.drumEditor.classList.remove("hidden");
  }

  function closeDrumEditor() {
    drumEditorState.open = false;
    controls.drumEditor.classList.add("hidden");
  }

  function applyNoteEditorSelection({ closeAfterApply = false } = {}) {
    if (!editorState.open) {
      return;
    }
    if (editorState.mode === "split") {
      store.setArrangementCell(editorState.trackId, editorState.barIndex, {
        type: "note",
        root: normalizeNoteName(editorState.firstHalf, "C"),
        split: true,
        secondRoot: normalizeNoteName(editorState.secondHalf, "G")
      });
    } else {
      store.setArrangementCell(editorState.trackId, editorState.barIndex, {
        type: "note",
        root: normalizeNoteName(editorState.fullNote, "C"),
        split: false,
        secondRoot: null
      });
    }
    if (closeAfterApply) {
      closeNoteEditor();
    }
  }

  function applyChordEditorSelection({ closeAfterApply = false } = {}) {
    if (!chordEditorState.open) {
      return;
    }
    refreshChordEditorSymbols();
    if (chordEditorState.mode === "split") {
      store.setArrangementCell(chordEditorState.trackId, chordEditorState.barIndex, {
        kind: "chord",
        data: {
          type: "split",
          firstHalf: normalizeChordData(chordEditorState.firstHalf, "C"),
          secondHalf: normalizeChordData(chordEditorState.secondHalf, "G")
        }
      });
    } else {
      store.setArrangementCell(chordEditorState.trackId, chordEditorState.barIndex, {
        kind: "chord",
        data: {
          type: "full",
          chord: normalizeChordData(chordEditorState.fullChord, "C")
        }
      });
    }
    if (closeAfterApply) {
      closeChordEditor();
    }
  }

  function applyDrumEditorSelection({ closeAfterApply = false } = {}) {
    if (!drumEditorState.open) {
      return;
    }
    const state = store.getState();
    const clipRef = state.drumClips?.[drumEditorState.clipRef]
      ? drumEditorState.clipRef
      : SHARED_DRUM_CLIP_REF;
    store.setArrangementCell(drumEditorState.trackId, drumEditorState.barIndex, {
      type: "drum",
      clipRef
    });
    if (closeAfterApply) {
      closeDrumEditor();
    }
  }

  function getEngineConfig(kind) {
    if (kind === "piano") {
      return {
        sf2PathKey: "pianoSf2Path",
        sf2StatusKey: "pianoSf2Status",
        sf2ErrorKey: "pianoSf2Error",
        setSettings: store.setPianoSettings,
        player: pianoSf2Player,
        trackResolver: (state) => getPianoTrack(state),
        arrangementKind: "note",
        label: "Piano"
      };
    }
    return {
      sf2PathKey: "bassSf2Path",
      sf2StatusKey: "bassSf2Status",
      sf2ErrorKey: "bassSf2Error",
      setSettings: store.setBassSettings,
      player: bassSf2Player,
      trackResolver: (state) => getTrackByType(state, "bass"),
      arrangementKind: "note",
      label: "Bass"
    };
  }

  function buildEngineWarning(state, kind) {
    const config = getEngineConfig(kind);
    const reasons = [];
    if (state.ui[config.sf2StatusKey] !== "ready") {
      reasons.push("SF2 not ready");
    }
    if (!hasAnyCellsByKind(state, config.trackResolver(state), config.arrangementKind)) {
      reasons.push("no bars placed");
    }
    return reasons.length ? `${config.label} caution: ${reasons.join("; ")}.` : "";
  }

  function setExportProgress(progressPercent, detailText) {
    exportUi.progress = clamp(Number(progressPercent) || 0, 0, 100);
    exportUi.detail = String(detailText || `${Math.round(exportUi.progress)}%`);
  }

  function renderTrackInspector(state) {
    const selectedTrackId = state.ui.dawSelection?.trackId || state.tracks[0]?.id || "";
    const track = state.tracks.find((item) => item.id === selectedTrackId);
    if (!track) {
      return '<div class="inline-warning">No track selected.</div>';
    }
    const settings = state.trackSettings?.[track.id] || {};
    if (isDrumTrack(track)) {
      return `<div class="inline-status">Drum clips are edited per-cell from the arrangement grid.</div>`;
    }

    const harmonyMode = settings.harmonyMode || "triad";
    const scale = settings.scale || "major";
    const octave = clamp(Number(settings.octave) || 4, 2, 5);
    const attackMs = clamp(Number(settings.attackMs) || 180, 1, 3000);
    const releaseMs = clamp(Number(settings.releaseMs) || 900, 1, 5000);
    const cutoff = clamp(Number(settings.filterCutoffHz) || 2200, 80, 20000);
    const detune = clamp(Number(settings.detuneCents) || 8, 0, 60);
    const reverbSend = clamp(Number(settings.reverbSend) || 0.18, 0, 1);
    const vibratoDepth = clamp(Number(settings.vibratoDepth) || 0, 0, 80);
    const vibratoRate = clamp(Number(settings.vibratoRateHz) || 4, 0.1, 12);
    const humanizeVelocity = Boolean(settings?.humanize?.velocity);
    const humanizeTiming = Boolean(settings?.humanize?.timing);
    const playStyle = settings.playStyle || "block";
    const rhythmPreset = settings.rhythmPreset || "root8ths";

    return `<div class="control-grid" data-track-id="${track.id}">
      <label class="control"><span>Harmony Mode</span><select data-role="track-setting" data-setting="harmonyMode" data-track-id="${track.id}">
        <option value="triad" ${harmonyMode === "triad" ? "selected" : ""}>Triad</option>
        <option value="power" ${harmonyMode === "power" ? "selected" : ""}>Power</option>
        <option value="seventh" ${harmonyMode === "seventh" ? "selected" : ""}>7th</option>
        <option value="sus2" ${harmonyMode === "sus2" ? "selected" : ""}>Sus2</option>
        <option value="sus4" ${harmonyMode === "sus4" ? "selected" : ""}>Sus4</option>
        <option value="single" ${harmonyMode === "single" ? "selected" : ""}>Single</option>
      </select></label>
      <label class="control"><span>Scale</span><select data-role="track-setting" data-setting="scale" data-track-id="${track.id}">
        <option value="major" ${scale === "major" ? "selected" : ""}>Major</option>
        <option value="minor" ${scale === "minor" ? "selected" : ""}>Minor</option>
        <option value="pentatonic" ${scale === "pentatonic" ? "selected" : ""}>Pentatonic</option>
        <option value="blues" ${scale === "blues" ? "selected" : ""}>Blues</option>
      </select></label>
      <label class="control"><span>Octave</span><input data-role="track-setting" data-setting="octave" data-track-id="${track.id}" type="number" min="2" max="5" step="1" value="${octave}" /></label>
      ${isBassTrack(track) ? `<label class="control"><span>Bass Rhythm</span><select data-role="track-setting" data-setting="rhythmPreset" data-track-id="${track.id}">
        <option value="root8ths" ${rhythmPreset === "root8ths" ? "selected" : ""}>Root 8ths</option>
        <option value="rootFifth" ${rhythmPreset === "rootFifth" ? "selected" : ""}>Root + Fifth</option>
        <option value="octave" ${rhythmPreset === "octave" ? "selected" : ""}>Octave</option>
        <option value="walking" ${rhythmPreset === "walking" ? "selected" : ""}>Walking</option>
      </select></label>` : ""}
      ${isPianoTrack(track) ? `<label class="control"><span>Piano Style</span><select data-role="track-setting" data-setting="playStyle" data-track-id="${track.id}">
        <option value="block" ${playStyle === "block" ? "selected" : ""}>Block</option>
        <option value="stabs8" ${playStyle === "stabs8" ? "selected" : ""}>8th Stabs</option>
        <option value="arpUp" ${playStyle === "arpUp" ? "selected" : ""}>Arp Up</option>
        <option value="arpDown" ${playStyle === "arpDown" ? "selected" : ""}>Arp Down</option>
        <option value="arpUpDown" ${playStyle === "arpUpDown" ? "selected" : ""}>Arp Up/Down</option>
      </select></label>` : ""}
      <label class="control"><span>Attack ms</span><input data-role="track-setting" data-setting="attackMs" data-track-id="${track.id}" type="number" min="1" max="3000" step="1" value="${attackMs}" /></label>
      <label class="control"><span>Release ms</span><input data-role="track-setting" data-setting="releaseMs" data-track-id="${track.id}" type="number" min="1" max="5000" step="1" value="${releaseMs}" /></label>
      <label class="control"><span>Filter Cutoff Hz</span><input data-role="track-setting" data-setting="filterCutoffHz" data-track-id="${track.id}" type="number" min="80" max="20000" step="10" value="${cutoff}" /></label>
      <label class="control"><span>Detune Cents</span><input data-role="track-setting" data-setting="detuneCents" data-track-id="${track.id}" type="number" min="0" max="60" step="1" value="${detune}" /></label>
      <label class="control"><span>Reverb Send</span><input data-role="track-setting" data-setting="reverbSend" data-track-id="${track.id}" type="range" min="0" max="1" step="0.01" value="${reverbSend}" /></label>
      <label class="control"><span>Vibrato Depth</span><input data-role="track-setting" data-setting="vibratoDepth" data-track-id="${track.id}" type="number" min="0" max="80" step="1" value="${vibratoDepth}" /></label>
      <label class="control"><span>Vibrato Rate Hz</span><input data-role="track-setting" data-setting="vibratoRateHz" data-track-id="${track.id}" type="number" min="0.1" max="12" step="0.1" value="${vibratoRate}" /></label>
      <label class="control checkbox"><input data-role="track-setting-checkbox" data-setting="humanize.velocity" data-track-id="${track.id}" type="checkbox" ${humanizeVelocity ? "checked" : ""} /><span>Humanize Velocity</span></label>
      <label class="control checkbox"><input data-role="track-setting-checkbox" data-setting="humanize.timing" data-track-id="${track.id}" type="checkbox" ${humanizeTiming ? "checked" : ""} /><span>Humanize Timing</span></label>
    </div>`;
  }

  function render() {
    const state = store.getState();
    const tracks = getVisibleTracks(state);
    const generatedRange = getGeneratedArrangementRange(state);
    const barSeconds = (60 / clamp(Number(state.transport.bpm) || 110, 30, 300)) * 4;
    const generatedMinutes = generatedRange ? (generatedRange.bars * barSeconds) / 60 : 0;
    controls.bpmNumber.value = String(Math.round(state.transport.bpm));
    controls.swing.value = String(Math.round(state.transport.swingPercent));
    controls.trackMinutes.value = String(state.transport.trackMinutes);
    controls.exportMinutes.value = generatedRange
      ? `${generatedRange.bars} bar(s) (${generatedMinutes.toFixed(2)} min)`
      : "No bars placed";
    controls.arrangementBars.value = String(state.transport.arrangementBars);
    controls.loopEnabled.checked = Boolean(state.transport.loopRange.enabled);
    controls.loopStart.value = String(state.transport.loopRange.startBar + 1);
    controls.loopEnd.value = String(state.transport.loopRange.endBar + 1);
    controls.loopStart.max = String(state.transport.arrangementBars);
    controls.loopEnd.max = String(state.transport.arrangementBars);
    controls.loopStart.disabled = !state.transport.loopRange.enabled;
    controls.loopEnd.disabled = !state.transport.loopRange.enabled;
    controls.play.disabled = Boolean(state.transport.isPlaying) || exportUi.isExporting;
    controls.stop.disabled = !Boolean(state.transport.isPlaying) || exportUi.isExporting;
    controls.exportWav.disabled =
      Boolean(state.transport.isPlaying) || exportUi.isExporting || !generatedRange;
    controls.exportMp3.disabled =
      Boolean(state.transport.isPlaying) || exportUi.isExporting || !generatedRange;
    controls.exportStatus.textContent = exportUi.status;
    controls.exportProgressFill.style.width = `${exportUi.progress}%`;
    controls.exportProgressText.textContent = exportUi.detail;

    controls.bassRhythm.value = state.bassSettings.rhythmPreset;
    controls.bassHumanizeVelocity.checked = Boolean(state.bassSettings.humanize.velocity);
    controls.bassHumanizeTiming.checked = Boolean(state.bassSettings.humanize.timing);
    controls.bassSf2Path.value = state.ui.bassSf2Path;

    controls.pianoStyle.value = state.pianoSettings.playStyle;
    controls.pianoHumanizeVelocity.checked = Boolean(state.pianoSettings.humanize.velocity);
    controls.pianoHumanizeTiming.checked = Boolean(state.pianoSettings.humanize.timing);
    controls.pianoSf2Choice.value = getPianoSf2ChoiceValue(state.ui.pianoSf2Path);
    controls.pianoSf2Path.value = state.ui.pianoSf2Path;

    const bassStatus = statusLabel(state.ui.bassSf2Status, state.ui.bassSf2Error);
    controls.bassSf2Status.textContent = engineUi.bass.transientStatus
      ? `${bassStatus} | ${engineUi.bass.transientStatus}`
      : bassStatus;
    controls.bassSf2Load.disabled = engineUi.bass.loadInFlight || state.ui.bassSf2Status === "loading";
    controls.bassSf2Test.disabled = engineUi.bass.loadInFlight || state.ui.bassSf2Status === "loading";

    const pianoStatus = statusLabel(state.ui.pianoSf2Status, state.ui.pianoSf2Error);
    controls.pianoSf2Status.textContent = engineUi.piano.transientStatus
      ? `${pianoStatus} | ${engineUi.piano.transientStatus}`
      : pianoStatus;
    controls.pianoSf2Load.disabled =
      engineUi.piano.loadInFlight || state.ui.pianoSf2Status === "loading";
    controls.pianoSf2Test.disabled =
      engineUi.piano.loadInFlight || state.ui.pianoSf2Status === "loading";

    controls.bassWarning.textContent = buildEngineWarning(state, "bass");
    controls.pianoWarning.textContent = buildEngineWarning(state, "piano");

    const hasDrum = state.tracks.some((track) => track.engine === "drum_clip");
    const hasBass = state.tracks.some((track) => track.engine === "bass_sf2");
    const hasPiano = state.tracks.some((track) => track.engine === "piano_sf2");
    for (const option of controls.addTrackType.options) {
      if (option.value === "drum_clip") {
        option.disabled = hasDrum;
      } else if (option.value === "bass_sf2") {
        option.disabled = hasBass;
      } else if (option.value === "piano_sf2") {
        option.disabled = hasPiano;
      } else {
        option.disabled = false;
      }
    }

    controls.trackList.innerHTML = renderTrackListRows(tracks, state.ui.dawSelection?.trackId || "");
    controls.barHead.innerHTML = renderHeaders(state.transport.arrangementBars, state);
    controls.gridRows.innerHTML = renderGridRows(state, tracks);
    controls.trackInspector.innerHTML = renderTrackInspector(state);
  }

  function getSelectedCellState() {
    const state = store.getState();
    const selection = state.ui.dawSelection;
    if (!selection) {
      return null;
    }
    const track = state.tracks.find((item) => item.id === selection.trackId);
    if (!track) {
      return null;
    }
    return {
      state,
      track,
      selection,
      cell: getArrangementCell(state, selection.trackId, selection.barIndex)
    };
  }

  function handleCopy() {
    const selected = getSelectedCellState();
    if (selected?.cell) {
      store.setDawClipboard(selected.cell);
    }
  }

  function handlePaste() {
    const selected = getSelectedCellState();
    if (!selected) {
      return;
    }
    const clipboard = selected.state.ui.dawClipboard;
    if (!clipboard) {
      return;
    }
    if (isDrumTrack(selected.track) && (clipboard.type === "drum" || clipboard.kind === "drum")) {
      store.setArrangementCell(selected.track.id, selected.selection.barIndex, cloneCell(clipboard));
      return;
    }
    if (!isDrumTrack(selected.track) && (clipboard.type === "note" || clipboard.kind === "note" || clipboard.kind === "chord")) {
      store.setArrangementCell(selected.track.id, selected.selection.barIndex, cloneCell(clipboard));
    }
  }

  function handleDelete() {
    const selected = getSelectedCellState();
    if (selected) {
      store.clearArrangementCell(selected.track.id, selected.selection.barIndex);
    }
  }

  async function loadEngineSf2(kind) {
    const config = getEngineConfig(kind);
    if (engineUi[kind].loadPromise) {
      return engineUi[kind].loadPromise;
    }
    const state = store.getState();
    const path = state.ui[config.sf2PathKey];
    if (!path) {
      store.setUi({
        [config.sf2StatusKey]: "error",
        [config.sf2ErrorKey]: "Missing SF2 path"
      });
      render();
      return false;
    }
    engineUi[kind].loadPromise = (async () => {
      engineUi[kind].loadInFlight = true;
      store.setUi({
        [config.sf2StatusKey]: "loading",
        [config.sf2ErrorKey]: ""
      });
      render();

      let ok = false;
      let error = "";
      try {
        ok = await config.player.load({ sf2Url: path });
        const status = config.player.getStatus();
        if (!ok) {
          error = status.error || "Failed to load SF2";
          engineUi[kind].transientStatus = "";
        } else {
          engineUi[kind].transientStatus = status.presetName
            ? `Preset: ${status.presetName}`
            : "Loaded";
        }
      } catch (loadError) {
        ok = false;
        error = loadError instanceof Error ? loadError.message : "Failed to load SF2";
        engineUi[kind].transientStatus = "";
      } finally {
        store.setUi({
          [config.sf2StatusKey]: ok ? "ready" : "error",
          [config.sf2ErrorKey]: ok ? "" : error
        });
        engineUi[kind].loadInFlight = false;
        engineUi[kind].loadPromise = null;
        render();
      }

      return ok;
    })();
    return engineUi[kind].loadPromise;
  }

  async function ensureDawEnginesReadyForPlayback() {
    const state = store.getState();
    const pendingLoads = [];

    for (const kind of ["bass", "piano"]) {
      const config = getEngineConfig(kind);
      const track = config.trackResolver(state);
      if (!track || !hasAnyCellsByKind(state, track, config.arrangementKind)) {
        continue;
      }
      if (state.ui[config.sf2StatusKey] === "ready" && config.player.isReady()) {
        continue;
      }
      pendingLoads.push(loadEngineSf2(kind));
    }

    if (!pendingLoads.length) {
      return true;
    }

    const results = await Promise.all(pendingLoads);
    return results.every(Boolean);
  }

  async function testEngine(kind) {
    const config = getEngineConfig(kind);
    await resumeAudioContext();
    if (!config.player.isReady()) {
      engineUi[kind].transientStatus = "Test failed: SF2 not ready";
      render();
      return;
    }
    config.player.playTestNote();
    engineUi[kind].transientStatus = "Test note triggered";
    render();
    setTimeout(() => {
      if (engineUi[kind].transientStatus === "Test note triggered") {
        engineUi[kind].transientStatus = "";
        render();
      }
    }, 1600);
  }

  async function runArrangementExport(format) {
    if (exportUi.isExporting) {
      return;
    }

    const initialState = store.getState();
    if (initialState.transport.isPlaying) {
      exportUi.status = "Stop playback first";
      setExportProgress(0, "Stop playback before export.");
      render();
      return;
    }

    const generatedRange = getGeneratedArrangementRange(initialState);
    if (!generatedRange) {
      exportUi.status = "Export blocked";
      setExportProgress(0, "No bars placed in arrangement.");
      render();
      return;
    }

    const ready = await ensureDawEnginesReadyForPlayback();
    if (!ready) {
      exportUi.status = "Export blocked";
      setExportProgress(0, "Load missing SF2 engines before export.");
      render();
      return;
    }

    const bpm = clamp(Number(initialState.transport.bpm) || 110, 30, 300);
    const barSeconds = (60 / bpm) * 4;
    const durationSeconds = generatedRange.bars * barSeconds;
    const durationMinutes = durationSeconds / 60;
    if (durationMinutes > 30) {
      exportUi.status = "Export blocked";
      setExportProgress(0, "Generated arrangement exceeds 30-minute export limit.");
      render();
      return;
    }

    await resumeAudioContext();
    const previousTrackMinutes = Number(initialState.transport.trackMinutes) || 4;
    const previousLoopRange = {
      enabled: Boolean(initialState.transport.loopRange?.enabled),
      startBar: Number(initialState.transport.loopRange?.startBar) || 0,
      endBar: Number(initialState.transport.loopRange?.endBar) || 0
    };
    const exportTrackMinutes = Math.max(1, durationMinutes + 0.05);

    exportUi.isExporting = true;
    exportUi.status = `Exporting ${format.toUpperCase()}...`;
    setExportProgress(1, "Preparing export...");
    render();

    try {
      store.setTransport({
        trackMinutes: exportTrackMinutes,
        loopRange: {
          enabled: true,
          startBar: generatedRange.startBar,
          endBar: generatedRange.endBar
        }
      });

      setExportProgress(4, "Starting DAW playback...");
      render();
      await trackManager.start({ context: "daw" });

      const { audioContext, masterGain } = getAudioNodes();
      let lastProgressUiAt = 0;
      const renderedBuffer = await captureNodeOutputToAudioBuffer({
        audioContext,
        sourceNode: masterGain,
        durationSeconds,
        channels: 2,
        onProgress(progress01) {
          const now = performance.now();
          if (now - lastProgressUiAt < 140) {
            return;
          }
          lastProgressUiAt = now;
          setExportProgress(5 + progress01 * 55, "Recording arrangement...");
          render();
        }
      });

      setExportProgress(63, "Encoding...");
      render();

      const dateTag = new Date().toISOString().replace(/[:.]/g, "-");
      const baseName = `daw-arrangement-${generatedRange.bars}bars-${dateTag}`;
      if (format === "wav") {
        const wavBlob = audioBufferToWavBlob(renderedBuffer);
        setExportProgress(92, "Preparing WAV download...");
        render();
        await downloadBlob(wavBlob, `${baseName}.wav`);
      } else {
        const mp3Blob = await audioBufferToMp3Blob(renderedBuffer, 192, (progress01) => {
          setExportProgress(65 + progress01 * 30, "Encoding MP3...");
          render();
        });
        setExportProgress(94, "Preparing MP3 download...");
        render();
        await downloadBlob(mp3Blob, `${baseName}.mp3`);
      }

      exportUi.status = `${format.toUpperCase()} exported`;
      setExportProgress(100, "Download started.");
      render();
    } catch (error) {
      exportUi.status = "Export failed";
      setExportProgress(0, `Export failed: ${String(error?.message || error)}`);
      render();
    } finally {
      trackManager.stop();
      store.setTransport({
        trackMinutes: previousTrackMinutes,
        loopRange: previousLoopRange
      });
      exportUi.isExporting = false;
      render();
    }
  }

  controls.bpmNumber.addEventListener("input", (event) => {
    store.setTransport({ bpm: clamp(Number(event.target.value) || 110, 30, 300) });
  });
  controls.swing.addEventListener("input", (event) => {
    store.setTransport({ swingPercent: clamp(Number(event.target.value) || 0, 0, 60) });
  });
  controls.trackMinutes.addEventListener("input", (event) => {
    store.setTransport({ trackMinutes: clamp(Number(event.target.value) || 4, 1, 30) });
  });
  controls.arrangementBars.addEventListener("change", (event) => {
    store.setTransport({ arrangementBars: clamp(Number(event.target.value) || 64, 8, 256) });
  });
  controls.loopEnabled.addEventListener("change", (event) => {
    store.setTransport({ loopRange: { enabled: Boolean(event.target.checked) } });
  });
  controls.loopStart.addEventListener("input", (event) => {
    const bars = store.getState().transport.arrangementBars;
    store.setTransport({
      loopRange: { startBar: clamp(Math.round(Number(event.target.value) || 1) - 1, 0, bars - 1) }
    });
  });
  controls.loopEnd.addEventListener("input", (event) => {
    const bars = store.getState().transport.arrangementBars;
    store.setTransport({
      loopRange: { endBar: clamp(Math.round(Number(event.target.value) || bars) - 1, 0, bars - 1) }
    });
  });
  controls.play.addEventListener("click", async () => {
    const ready = await ensureDawEnginesReadyForPlayback();
    if (!ready) {
      return;
    }
    await trackManager.start({ context: "daw" });
  });
  controls.stop.addEventListener("click", () => {
    trackManager.stop();
  });
  controls.exportWav.addEventListener("click", async () => {
    await runArrangementExport("wav");
  });
  controls.exportMp3.addEventListener("click", async () => {
    await runArrangementExport("mp3");
  });
  controls.addTrack.addEventListener("click", () => {
    const engine = String(controls.addTrackType.value || "pad_synth");
    const added = store.addTrack({ engine });
    if (added) {
      store.setDawSelection({ trackId: added.id, barIndex: 0 });
    }
  });

  controls.bassRhythm.addEventListener("change", (event) => {
    store.setBassSettings({ rhythmPreset: String(event.target.value || "root8ths") });
  });
  controls.bassHumanizeVelocity.addEventListener("change", (event) => {
    store.setBassSettings({ humanize: { velocity: Boolean(event.target.checked) } });
  });
  controls.bassHumanizeTiming.addEventListener("change", (event) => {
    store.setBassSettings({ humanize: { timing: Boolean(event.target.checked) } });
  });
  controls.pianoStyle.addEventListener("change", (event) => {
    store.setPianoSettings({ playStyle: String(event.target.value || "block") });
  });
  controls.pianoHumanizeVelocity.addEventListener("change", (event) => {
    store.setPianoSettings({ humanize: { velocity: Boolean(event.target.checked) } });
  });
  controls.pianoHumanizeTiming.addEventListener("change", (event) => {
    store.setPianoSettings({ humanize: { timing: Boolean(event.target.checked) } });
  });

  controls.bassSf2Path.addEventListener("change", (event) => {
    store.setUi({
      bassSf2Path: String(event.target.value || "").trim() || "/instruments/acoustic_bass.sf2"
    });
  });
  controls.pianoSf2Choice.addEventListener("change", (event) => {
    const selected = String(event.target.value || "").trim();
    if (!selected || selected === "custom") {
      return;
    }
    store.setUi({
      pianoSf2Path: selected
    });
  });
  controls.pianoSf2Path.addEventListener("change", (event) => {
    store.setUi({
      pianoSf2Path:
        String(event.target.value || "").trim() || "/instruments/1115_Korg_IS50_Marimboyd.sf2"
    });
  });
  controls.bassSf2Load.addEventListener("click", async () => {
    await loadEngineSf2("bass");
  });
  controls.pianoSf2Load.addEventListener("click", async () => {
    await loadEngineSf2("piano");
  });
  controls.bassSf2Test.addEventListener("click", async () => {
    await testEngine("bass");
  });
  controls.pianoSf2Test.addEventListener("click", async () => {
    await testEngine("piano");
  });

  rootElement.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.dataset.role === "track-volume") {
      const trackId = target.dataset.trackId;
      if (!trackId) {
        return;
      }
      store.setTrackMix(trackId, { volume: clamp(Number(target.value) || 0, 0, 1) });
      return;
    }
    if (target.dataset.role === "track-setting") {
      const trackId = String(target.dataset.trackId || "");
      const setting = String(target.dataset.setting || "");
      if (!trackId || !setting) {
        return;
      }
      store.setTrackSettings(trackId, {
        [setting]: Number.isFinite(Number(target.value)) && target.type !== "select-one"
          ? Number(target.value)
          : String(target.value || "")
      });
    }
  });
  rootElement.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.dataset.role === "track-mute") {
      const trackId = target.dataset.trackId;
      if (trackId) {
        store.setTrackMix(trackId, { mute: Boolean(target.checked) });
      }
      return;
    }
    if (target.dataset.role === "track-solo") {
      const trackId = target.dataset.trackId;
      if (trackId) {
        store.setTrackMix(trackId, { solo: Boolean(target.checked) });
      }
      return;
    }
    if (target.dataset.role === "track-setting") {
      const trackId = String(target.dataset.trackId || "");
      const setting = String(target.dataset.setting || "");
      if (!trackId || !setting) {
        return;
      }
      store.setTrackSettings(trackId, {
        [setting]: Number.isFinite(Number(target.value)) && target.type !== "select-one"
          ? Number(target.value)
          : String(target.value || "")
      });
      return;
    }
    if (target.dataset.role === "track-setting-checkbox") {
      const trackId = String(target.dataset.trackId || "");
      const setting = String(target.dataset.setting || "");
      if (!trackId || !setting) {
        return;
      }
      if (setting === "humanize.velocity") {
        store.setTrackSettings(trackId, { humanize: { velocity: Boolean(target.checked) } });
      } else if (setting === "humanize.timing") {
        store.setTrackSettings(trackId, { humanize: { timing: Boolean(target.checked) } });
      }
    }
  });

  rootElement.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.dataset.role === "remove-track") {
      const trackId = String(target.dataset.trackId || "");
      if (!trackId) {
        return;
      }
      store.removeTrack(trackId);
      return;
    }
    const cellButton = target.closest("[data-role='grid-cell']");
    if (!cellButton) {
      return;
    }
    const trackId = cellButton.getAttribute("data-track-id") || "";
    const barIndex = Number(cellButton.getAttribute("data-bar-index"));
    if (!trackId || Number.isNaN(barIndex)) {
      return;
    }
    const state = store.getState();
    const track = state.tracks.find((item) => item.id === trackId);
    if (!track) {
      return;
    }
    store.setDawSelection({ trackId, barIndex });
    if (isDrumTrack(track)) {
      openDrumEditor(trackId, track.name, barIndex);
      return;
    }
    openNoteEditor(trackId, track.name, barIndex);
  });

  controls.editorMode.addEventListener("change", (event) => {
    setEditorMode(String(event.target.value || "full"));
    applyNoteEditorSelection();
  });
  controls.editorFullNote.addEventListener("change", (event) => {
    editorState.fullNote = normalizeNoteName(event.target.value || "C", "C");
    applyNoteEditorSelection({ closeAfterApply: true });
  });
  controls.editorFirstNote.addEventListener("change", (event) => {
    editorState.firstHalf = normalizeNoteName(event.target.value || "C", "C");
    applyNoteEditorSelection();
  });
  controls.editorSecondNote.addEventListener("change", (event) => {
    editorState.secondHalf = normalizeNoteName(event.target.value || "G", "G");
    applyNoteEditorSelection();
  });
  controls.editorSave.addEventListener("click", () => {
    applyNoteEditorSelection({ closeAfterApply: true });
  });
  controls.editorClear.addEventListener("click", () => {
    if (!editorState.open) {
      return;
    }
    store.clearArrangementCell(editorState.trackId, editorState.barIndex);
    closeNoteEditor();
  });
  controls.editorCancel.addEventListener("click", () => {
    closeNoteEditor();
  });
  controls.chordEditorMode.addEventListener("change", (event) => {
    setChordEditorMode(String(event.target.value || "full"));
    refreshChordEditorSymbols();
    applyChordEditorSelection();
  });
  for (const control of [
    controls.chordFullRoot,
    controls.chordFullQuality,
    controls.chordFullBass,
    controls.chordFirstRoot,
    controls.chordFirstQuality,
    controls.chordFirstBass,
    controls.chordSecondRoot,
    controls.chordSecondQuality,
    controls.chordSecondBass
  ]) {
    control.addEventListener("change", () => {
      refreshChordEditorSymbols();
      applyChordEditorSelection();
    });
  }
  controls.chordEditorSave.addEventListener("click", () => {
    applyChordEditorSelection({ closeAfterApply: true });
  });
  controls.chordEditorClear.addEventListener("click", () => {
    if (!chordEditorState.open) {
      return;
    }
    store.clearArrangementCell(chordEditorState.trackId, chordEditorState.barIndex);
    closeChordEditor();
  });
  controls.chordEditorCancel.addEventListener("click", () => {
    closeChordEditor();
  });
  controls.drumEditorClip.addEventListener("change", (event) => {
    drumEditorState.clipRef = String(event.target.value || SHARED_DRUM_CLIP_REF);
    applyDrumEditorSelection({ closeAfterApply: true });
  });
  controls.drumEditorSave.addEventListener("click", () => {
    applyDrumEditorSelection({ closeAfterApply: true });
  });
  controls.drumEditorClear.addEventListener("click", () => {
    if (!drumEditorState.open) {
      return;
    }
    store.clearArrangementCell(drumEditorState.trackId, drumEditorState.barIndex);
    closeDrumEditor();
  });
  controls.drumEditorCancel.addEventListener("click", () => {
    closeDrumEditor();
  });

  window.addEventListener("keydown", (event) => {
    const state = store.getState();
    if (state.ui.activeTab !== "daw") {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      handleCopy();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      handlePaste();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      handleDelete();
    }
  });

  store.subscribe(() => {
    render();
  });
  render();

  async function onTabActivated() {
    // Keep tab activation lightweight to avoid heavy SF2 loads on UI navigation.
    return;
  }

  return {
    onTabActivated
  };
}
