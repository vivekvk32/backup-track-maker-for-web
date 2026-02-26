import { normalizeNoteName } from "../bass/rootNoteUtils";
import { LANE_IDS, buildPresetPattern } from "../patterns/presets";
import { normalizeChordData } from "../piano/chordUtils";

const STORAGE_TRANSPORT_V2 = "drum-loop-maker.transport.v2";
const STORAGE_TRANSPORT_V3 = "drum-loop-maker.transport.v3";
const STORAGE_ARRANGEMENT_V3 = "drum-loop-maker.arrangement.v3";
const STORAGE_ARRANGEMENT_V2 = "drum-loop-maker.arrangement.v2";
const STORAGE_UI_V2 = "drum-loop-maker.ui.v2";
const STORAGE_MIXER = "drum-loop-maker.mixer.v1";

const LEGACY_TRANSPORT = "drum-loop-maker.transport.v1";
const LEGACY_BASS = "drum-loop-maker.bass.v1";
const METRONOME_SUBDIVISION_VALUES = new Set(["half", "quarter", "eighth", "sixteenth"]);

const FALLBACK_LANES = ["kick", "snare", "closed_hat"];
export const SHARED_DRUM_CLIP_REF = "shared-main";

export const TRACK_IDS = {
  DRUMS: "track-drums",
  BASS: "track-bass",
  PIANO: "track-piano"
};

const DEFAULT_TRACKS = [
  {
    id: TRACK_IDS.DRUMS,
    type: "drum",
    name: "Drums",
    volume: 0.9,
    mute: false,
    solo: false
  },
  {
    id: TRACK_IDS.BASS,
    type: "bass",
    name: "Bass",
    volume: 1,
    mute: false,
    solo: false
  },
  {
    id: TRACK_IDS.PIANO,
    type: "instrument",
    name: "Piano",
    volume: 0.9,
    mute: false,
    solo: false
  }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value, min, max) {
  return clamp(Math.round(Number(value) || 0), min, max);
}

function normalizeArrangementBars(value) {
  const raw = clampInt(value, 8, 256);
  return clampInt(Math.round(raw / 4) * 4, 8, 256);
}

function normalizeLoopBars(value) {
  return [1, 2, 4].includes(Number(value)) ? Number(value) : 1;
}

function normalizePlayContext(value) {
  return value === "daw" ? "daw" : "drums";
}

function normalizeLoopRange(loopRange, arrangementBars) {
  const maxBar = Math.max(0, Number(arrangementBars) - 1);
  const source = loopRange && typeof loopRange === "object" ? loopRange : {};
  const startBar = clampInt(source.startBar ?? 0, 0, maxBar);
  const endBar = clampInt(source.endBar ?? maxBar, 0, maxBar);

  return {
    enabled: Boolean(source.enabled),
    startBar,
    endBar: endBar < startBar ? startBar : endBar
  };
}

function normalizeMetronomeSubdivision(value, fallback = "quarter") {
  const requested = String(value || "").toLowerCase();
  if (METRONOME_SUBDIVISION_VALUES.has(requested)) {
    return requested;
  }

  const fallbackValue = String(fallback || "quarter").toLowerCase();
  return METRONOME_SUBDIVISION_VALUES.has(fallbackValue) ? fallbackValue : "quarter";
}

function cloneBooleanSteps(steps, totalSteps) {
  const result = Array.from({ length: totalSteps }, () => false);
  if (!Array.isArray(steps)) {
    return result;
  }
  const limit = Math.min(steps.length, totalSteps);
  for (let index = 0; index < limit; index += 1) {
    result[index] = Boolean(steps[index]);
  }
  return result;
}

function createOneBarLaneSnapshot(lanes) {
  const source = lanes && typeof lanes === "object" ? lanes : {};
  return Object.fromEntries(
    LANE_IDS.map((laneId) => [laneId, cloneBooleanSteps(source[laneId], 16)])
  );
}

function normalizeDrumClip(clip, fallbackName) {
  if (!clip || typeof clip !== "object") {
    return null;
  }
  const name = String(clip.name || fallbackName || "Clip").trim() || String(fallbackName || "Clip");
  return {
    name,
    lanes: createOneBarLaneSnapshot(clip.lanes)
  };
}

function normalizeDrumClips(drumClips, fallbackPatternLanes) {
  const source = drumClips && typeof drumClips === "object" ? drumClips : {};
  const next = {};

  for (const [clipRef, clip] of Object.entries(source)) {
    const safeRef = String(clipRef || "").trim();
    if (!safeRef) {
      continue;
    }
    const normalized = normalizeDrumClip(clip, safeRef);
    if (!normalized) {
      continue;
    }
    next[safeRef] = normalized;
  }

  next[SHARED_DRUM_CLIP_REF] = {
    name: "Shared Main",
    lanes: createOneBarLaneSnapshot(fallbackPatternLanes)
  };

  return next;
}

function syncSharedDrumClipFromPattern(targetState) {
  targetState.drumClips = normalizeDrumClips(
    targetState.drumClips,
    targetState.drumPattern?.lanes
  );
}

function createEmptyArrangement(tracks) {
  const next = {};
  for (const track of tracks) {
    next[track.id] = {};
  }
  return next;
}

function sanitizeTrack(track, index) {
  const type = ["drum", "bass", "instrument"].includes(track?.type)
    ? track.type
    : "instrument";

  const fallback = DEFAULT_TRACKS.find((item) => item.type === type) || DEFAULT_TRACKS[0];
  return {
    id: String(track?.id || `${type}-${index + 1}`),
    type,
    name: String(track?.name || fallback.name),
    volume: clamp(Number(track?.volume ?? fallback.volume) || fallback.volume, 0, 1),
    mute: Boolean(track?.mute),
    solo: Boolean(track?.solo)
  };
}

function ensureCoreTracks(tracks) {
  const next = Array.isArray(tracks) ? tracks.map(sanitizeTrack) : [];

  if (!next.some((track) => track.type === "drum")) {
    next.unshift({ ...DEFAULT_TRACKS[0] });
  }
  if (!next.some((track) => track.type === "bass")) {
    next.push({ ...DEFAULT_TRACKS[1] });
  }

  if (!next.some((track) => track.type === "instrument")) {
    next.push({ ...DEFAULT_TRACKS[2] });
  }

  if (!next.some((track) => track.id === TRACK_IDS.PIANO)) {
    const instrumentIndex = next.findIndex((track) => track.type === "instrument");
    if (instrumentIndex >= 0) {
      next[instrumentIndex] = {
        ...next[instrumentIndex],
        id: TRACK_IDS.PIANO,
        name: "Piano"
      };
    } else {
      next.push({ ...DEFAULT_TRACKS[2] });
    }
  }

  return next;
}

function normalizeNoteCell(cellData) {
  const source = cellData && typeof cellData === "object" ? cellData : {};

  if (source.type === "split") {
    return {
      type: "split",
      firstHalf: normalizeNoteName(source.firstHalf || "C", "C"),
      secondHalf: normalizeNoteName(source.secondHalf || "G", "G")
    };
  }

  return {
    type: "full",
    note: normalizeNoteName(source.note || "C", "C")
  };
}

function migrateLegacyNoteBarToChordBar(cellData) {
  const noteBar = normalizeNoteCell(cellData);
  if (noteBar.type === "split") {
    return {
      type: "split",
      firstHalf: normalizeChordData(
        {
          root: noteBar.firstHalf,
          quality: "maj"
        },
        noteBar.firstHalf
      ),
      secondHalf: normalizeChordData(
        {
          root: noteBar.secondHalf,
          quality: "maj"
        },
        noteBar.secondHalf
      )
    };
  }

  return {
    type: "full",
    chord: normalizeChordData(
      {
        root: noteBar.note,
        quality: "maj"
      },
      noteBar.note
    )
  };
}

function normalizeChordBarCell(cellData) {
  const source = cellData && typeof cellData === "object" ? cellData : {};
  if (source.type === "split") {
    return {
      type: "split",
      firstHalf: normalizeChordData(source.firstHalf, "C"),
      secondHalf: normalizeChordData(source.secondHalf, "G")
    };
  }
  return {
    type: "full",
    chord: normalizeChordData(source.chord, "C")
  };
}

function normalizeArrangementCell(trackType, cell) {
  if (!cell || typeof cell !== "object") {
    return null;
  }

  if (trackType === "drum") {
    if (cell.kind !== "drum") {
      return null;
    }
    return {
      kind: "drum",
      data: {
        clipRef: String(cell?.data?.clipRef || SHARED_DRUM_CLIP_REF)
      }
    };
  }

  if (trackType === "bass") {
    if (cell.kind !== "note") {
      return null;
    }
    return {
      kind: "note",
      data: normalizeNoteCell(cell.data)
    };
  }

  if (trackType === "instrument") {
    if (cell.kind === "chord") {
      return {
        kind: "chord",
        data: normalizeChordBarCell(cell.data)
      };
    }
    if (cell.kind === "note") {
      return {
        kind: "chord",
        data: migrateLegacyNoteBarToChordBar(cell.data)
      };
    }
    return null;
  }

  return null;
}

function sanitizeArrangementForTracks(arrangement, tracks, arrangementBars) {
  const next = createEmptyArrangement(tracks);
  const source = arrangement && typeof arrangement === "object" ? arrangement : {};

  for (const track of tracks) {
    const trackCells = source[track.id];
    if (!trackCells || typeof trackCells !== "object") {
      continue;
    }

    for (const [barKey, cell] of Object.entries(trackCells)) {
      const barIndex = Number(barKey);
      if (!Number.isInteger(barIndex) || barIndex < 0 || barIndex >= arrangementBars) {
        continue;
      }
      const normalized = normalizeArrangementCell(track.type, cell);
      if (!normalized) {
        continue;
      }
      next[track.id][barIndex] = normalized;
    }
  }

  return next;
}

function normalizeBassSettings(settings, fallback) {
  const source = settings && typeof settings === "object" ? settings : {};
  const preset = ["root8ths", "rootFifth", "octave", "walking"].includes(source.rhythmPreset)
    ? source.rhythmPreset
    : fallback.rhythmPreset;
  const velocity =
    source?.humanize?.velocity !== undefined
      ? Boolean(source.humanize.velocity)
      : Boolean(fallback.humanize.velocity);
  const timing =
    source?.humanize?.timing !== undefined
      ? Boolean(source.humanize.timing)
      : Boolean(fallback.humanize.timing);

  return {
    rhythmPreset: preset,
    humanize: {
      velocity,
      timing
    }
  };
}

function normalizePianoSettings(settings, fallback) {
  const source = settings && typeof settings === "object" ? settings : {};
  const fallbackStyle = ["block", "stabs8", "arpUp", "arpDown", "arpUpDown"].includes(
    fallback?.playStyle
  )
    ? fallback.playStyle
    : "block";
  const style = ["block", "stabs8", "arpUp", "arpDown", "arpUpDown"].includes(source.playStyle)
    ? source.playStyle
    : fallbackStyle;
  const velocity =
    source?.humanize?.velocity !== undefined
      ? Boolean(source.humanize.velocity)
      : Boolean(fallback.humanize.velocity);
  const timing =
    source?.humanize?.timing !== undefined
      ? Boolean(source.humanize.timing)
      : Boolean(fallback.humanize.timing);

  return {
    playStyle: style,
    humanize: {
      velocity,
      timing
    }
  };
}

function normalizeTransport(transport, fallback) {
  const source = transport && typeof transport === "object" ? transport : {};
  const arrangementBars = normalizeArrangementBars(
    Number(source.arrangementBars ?? fallback.arrangementBars) || fallback.arrangementBars
  );

  return {
    bpm: clamp(Number(source.bpm) || fallback.bpm, 30, 300),
    swingPercent: clamp(Number(source.swingPercent) || fallback.swingPercent, 0, 60),
    loopBars: normalizeLoopBars(source.loopBars ?? fallback.loopBars),
    arrangementBars,
    loopRange: normalizeLoopRange(source.loopRange ?? fallback.loopRange, arrangementBars),
    trackMinutes: clamp(Number(source.trackMinutes) || fallback.trackMinutes, 1, 30),
    isPlaying: Boolean(source.isPlaying),
    playContext: normalizePlayContext(source.playContext ?? fallback.playContext),
    metronome: {
      enabled: Boolean(source?.metronome?.enabled ?? fallback.metronome.enabled),
      volume: clamp(
        Number(source?.metronome?.volume ?? fallback.metronome.volume) || fallback.metronome.volume,
        0,
        1
      ),
      accentBeatOne: Boolean(source?.metronome?.accentBeatOne ?? fallback.metronome.accentBeatOne),
      subdivision: normalizeMetronomeSubdivision(
        source?.metronome?.subdivision,
        fallback?.metronome?.subdivision
      )
    }
  };
}

function normalizePatternsForLoopBars(sourceState, loopBars) {
  const totalSteps = loopBars * 16;
  const nextState = sourceState;

  const resizedSharedLanes = {};
  for (const laneId of LANE_IDS) {
    resizedSharedLanes[laneId] = cloneBooleanSteps(nextState.drumPattern.lanes[laneId], totalSteps);
  }

  const resizedFallbackLanes = {};
  for (const laneId of FALLBACK_LANES) {
    resizedFallbackLanes[laneId] = cloneBooleanSteps(
      nextState.drumPattern.fallback.lanes[laneId],
      totalSteps
    );
  }

  nextState.drumPattern = {
    ...nextState.drumPattern,
    lanes: resizedSharedLanes,
    fallback: {
      ...nextState.drumPattern.fallback,
      lanes: resizedFallbackLanes
    }
  };
}

function readStorage(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function defaultDrumPattern() {
  const lanes = buildPresetPattern("Rock", 1);
  const laneGains = Object.fromEntries(LANE_IDS.map((laneId) => [laneId, 1]));
  const selectedSamples = Object.fromEntries(LANE_IDS.map((laneId) => [laneId, ""]));
  const fallback = {
    presetName: "Rock",
    lanes: {
      kick: [...(lanes.kick || [])],
      snare: [...(lanes.snare || [])],
      closed_hat: [...(lanes.closed_hat || [])]
    }
  };

  return {
    sourceMode: "shared",
    lanes,
    laneGains,
    selectedSamples,
    fallback
  };
}

function defaultState() {
  const tracks = ensureCoreTracks(DEFAULT_TRACKS);
  const drumPattern = defaultDrumPattern();
  return {
    ui: {
      activeTab: "drums",
      bassSf2Path: "/instruments/acoustic_bass.sf2",
      bassSf2Status: "idle",
      bassSf2Error: "",
      pianoSf2Path: "/instruments/1115_Korg_IS50_Marimboyd.sf2",
      pianoSf2Status: "idle",
      pianoSf2Error: "",
      playheadStep: -1,
      dawPlayhead: {
        barIndex: -1,
        stepInBar: -1,
        activeHalf: null
      },
      dawSelection: null,
      dawClipboard: null
    },
    transport: {
      bpm: 110,
      swingPercent: 0,
      loopBars: 1,
      arrangementBars: 64,
      loopRange: {
        enabled: false,
        startBar: 0,
        endBar: 63
      },
      trackMinutes: 4,
      isPlaying: false,
      playContext: "drums",
      metronome: {
        enabled: true,
        volume: 0.5,
        accentBeatOne: true,
        subdivision: "quarter"
      }
    },
    mixer: {
      masterGain: 0.8,
      drumGain: 0.9,
      bassGain: 1,
      pianoGain: 0.9,
      drumMute: false,
      bassMute: false,
      pianoMute: false,
      drumSolo: false,
      bassSolo: false,
      pianoSolo: false
    },
    tracks,
    arrangement: createEmptyArrangement(tracks),
    drumClips: normalizeDrumClips(null, drumPattern.lanes),
    bassSettings: {
      rhythmPreset: "root8ths",
      humanize: {
        velocity: true,
        timing: true
      }
    },
    pianoSettings: {
      playStyle: "block",
      humanize: {
        velocity: true,
        timing: true
      }
    },
    drumPattern
  };
}

function getTrackByType(tracks, type) {
  return tracks.find((track) => track.type === type) || null;
}

function syncTracksFromMixer(tracks, mixer) {
  return tracks.map((track) => {
    if (track.type === "drum") {
      return {
        ...track,
        volume: clamp(Number(mixer.drumGain) || track.volume, 0, 1),
        mute: Boolean(mixer.drumMute),
        solo: Boolean(mixer.drumSolo)
      };
    }

    if (track.type === "bass") {
      return {
        ...track,
        volume: clamp(Number(mixer.bassGain) || track.volume, 0, 1),
        mute: Boolean(mixer.bassMute),
        solo: Boolean(mixer.bassSolo)
      };
    }

    if (track.type === "instrument") {
      return {
        ...track,
        volume: clamp(Number(mixer.pianoGain) || track.volume, 0, 1),
        mute: Boolean(mixer.pianoMute),
        solo: Boolean(mixer.pianoSolo)
      };
    }

    return track;
  });
}

function syncMixerFromTracks(mixer, tracks) {
  const drumTrack = getTrackByType(tracks, "drum");
  const bassTrack = getTrackByType(tracks, "bass");
  const instrumentTrack = tracks.find((track) => track.id === TRACK_IDS.PIANO) || getTrackByType(tracks, "instrument");

  return {
    ...mixer,
    drumGain: drumTrack ? clamp(Number(drumTrack.volume) || mixer.drumGain, 0, 1) : mixer.drumGain,
    bassGain: bassTrack ? clamp(Number(bassTrack.volume) || mixer.bassGain, 0, 2) : mixer.bassGain,
    pianoGain: instrumentTrack
      ? clamp(Number(instrumentTrack.volume) || mixer.pianoGain, 0, 2)
      : mixer.pianoGain,
    drumMute: drumTrack ? Boolean(drumTrack.mute) : mixer.drumMute,
    bassMute: bassTrack ? Boolean(bassTrack.mute) : mixer.bassMute,
    pianoMute: instrumentTrack ? Boolean(instrumentTrack.mute) : mixer.pianoMute,
    drumSolo: drumTrack ? Boolean(drumTrack.solo) : mixer.drumSolo,
    bassSolo: bassTrack ? Boolean(bassTrack.solo) : mixer.bassSolo,
    pianoSolo: instrumentTrack ? Boolean(instrumentTrack.solo) : mixer.pianoSolo
  };
}

function cloneCell(cell) {
  if (!cell || typeof cell !== "object") {
    return null;
  }
  if (cell.kind === "drum") {
    return {
      kind: "drum",
      data: {
        clipRef: String(cell?.data?.clipRef || SHARED_DRUM_CLIP_REF)
      }
    };
  }
  if (cell.kind === "chord") {
    return {
      kind: "chord",
      data: normalizeChordBarCell(cell.data)
    };
  }
  return {
    kind: "note",
    data: normalizeNoteCell(cell.data)
  };
}

function normalizeStoreState(inputState = {}) {
  const defaults = defaultState();
  const source = inputState && typeof inputState === "object" ? inputState : {};
  const merged = {
    ...defaults,
    ...source
  };

  merged.ui = {
    ...defaults.ui,
    ...(merged.ui && typeof merged.ui === "object" ? merged.ui : {}),
    bassSf2Status: "idle",
    bassSf2Error: "",
    pianoSf2Status: "idle",
    pianoSf2Error: "",
    playheadStep: -1,
    dawPlayhead: {
      barIndex: -1,
      stepInBar: -1,
      activeHalf: null
    },
    dawSelection: null,
    dawClipboard: null
  };

  merged.transport = normalizeTransport(
    {
      ...defaults.transport,
      ...(merged.transport && typeof merged.transport === "object" ? merged.transport : {}),
      isPlaying: false
    },
    defaults.transport
  );
  merged.transport.isPlaying = false;
  merged.transport.playContext = normalizePlayContext(merged.transport.playContext);

  merged.drumPattern = {
    ...defaults.drumPattern,
    ...(merged.drumPattern && typeof merged.drumPattern === "object" ? merged.drumPattern : {}),
    lanes: {
      ...defaults.drumPattern.lanes,
      ...(merged?.drumPattern?.lanes || {})
    },
    laneGains: {
      ...defaults.drumPattern.laneGains,
      ...(merged?.drumPattern?.laneGains || {})
    },
    selectedSamples: {
      ...defaults.drumPattern.selectedSamples,
      ...(merged?.drumPattern?.selectedSamples || {})
    },
    fallback: {
      ...defaults.drumPattern.fallback,
      ...(merged?.drumPattern?.fallback || {}),
      lanes: {
        ...defaults.drumPattern.fallback.lanes,
        ...(merged?.drumPattern?.fallback?.lanes || {})
      }
    }
  };
  merged.drumPattern.sourceMode = merged.drumPattern.sourceMode === "fallback" ? "fallback" : "shared";

  merged.tracks = ensureCoreTracks(merged.tracks);
  merged.arrangement = sanitizeArrangementForTracks(
    merged.arrangement,
    merged.tracks,
    merged.transport.arrangementBars
  );
  merged.bassSettings = normalizeBassSettings(merged.bassSettings, defaults.bassSettings);
  merged.pianoSettings = normalizePianoSettings(merged.pianoSettings, defaults.pianoSettings);

  merged.mixer = syncMixerFromTracks(
    {
      ...defaults.mixer,
      ...(merged.mixer && typeof merged.mixer === "object" ? merged.mixer : {})
    },
    merged.tracks
  );

  normalizePatternsForLoopBars(merged, merged.transport.loopBars);
  merged.drumClips = normalizeDrumClips(merged.drumClips, merged.drumPattern?.lanes);
  syncSharedDrumClipFromPattern(merged);

  return merged;
}

export function createTransportStore(initialState = {}) {
  let state = normalizeStoreState(initialState);
  const listeners = new Set();

  function emit() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function persistSettings() {
    const transportPayload = {
      bpm: state.transport.bpm,
      swingPercent: state.transport.swingPercent,
      loopBars: state.transport.loopBars,
      arrangementBars: state.transport.arrangementBars,
      loopRange: state.transport.loopRange,
      trackMinutes: state.transport.trackMinutes,
      playContext: state.transport.playContext,
      metronome: state.transport.metronome
    };

    const arrangementPayload = {
      tracks: state.tracks,
      arrangement: state.arrangement,
      drumClips: state.drumClips,
      bassSettings: state.bassSettings,
      pianoSettings: state.pianoSettings
    };

    const mixerPayload = {
      ...state.mixer,
      drumSourceMode: state.drumPattern.sourceMode
    };

    writeStorage(STORAGE_TRANSPORT_V2, transportPayload);
    writeStorage(STORAGE_TRANSPORT_V3, transportPayload);
    writeStorage(STORAGE_ARRANGEMENT_V3, arrangementPayload);
    writeStorage(STORAGE_MIXER, mixerPayload);
    writeStorage(STORAGE_UI_V2, {
      bassSf2Path: state.ui.bassSf2Path,
      pianoSf2Path: state.ui.pianoSf2Path
    });
  }

  function loadPersistedSettings() {
    const defaultSnapshot = defaultState();

    const transportSaved =
      readStorage(STORAGE_TRANSPORT_V3) ||
      readStorage(STORAGE_TRANSPORT_V2) ||
      readStorage(LEGACY_TRANSPORT);
    if (transportSaved && typeof transportSaved === "object") {
      state.transport = normalizeTransport(transportSaved, state.transport);
    }

    const mixerSaved = readStorage(STORAGE_MIXER);
    if (mixerSaved && typeof mixerSaved === "object") {
      state.mixer = {
        ...state.mixer,
        masterGain: clamp(Number(mixerSaved.masterGain) || state.mixer.masterGain, 0, 1),
        drumGain: clamp(Number(mixerSaved.drumGain) || state.mixer.drumGain, 0, 1),
        bassGain: clamp(Number(mixerSaved.bassGain) || state.mixer.bassGain, 0, 2),
        pianoGain: clamp(Number(mixerSaved.pianoGain) || state.mixer.pianoGain, 0, 2),
        drumMute: Boolean(mixerSaved.drumMute),
        bassMute: Boolean(mixerSaved.bassMute),
        pianoMute: Boolean(mixerSaved.pianoMute),
        drumSolo: Boolean(mixerSaved.drumSolo),
        bassSolo: Boolean(mixerSaved.bassSolo),
        pianoSolo: Boolean(mixerSaved.pianoSolo)
      };
      state.drumPattern = {
        ...state.drumPattern,
        sourceMode: mixerSaved.drumSourceMode === "fallback" ? "fallback" : "shared"
      };
    }

    const arrangementSaved =
      readStorage(STORAGE_ARRANGEMENT_V3) || readStorage(STORAGE_ARRANGEMENT_V2);
    const hasArrangementSaved = arrangementSaved && typeof arrangementSaved === "object";
    if (hasArrangementSaved) {
      state.tracks = ensureCoreTracks(arrangementSaved.tracks);
      state.arrangement = sanitizeArrangementForTracks(
        arrangementSaved.arrangement,
        state.tracks,
        state.transport.arrangementBars
      );
      state.drumClips = normalizeDrumClips(arrangementSaved.drumClips, state.drumPattern?.lanes);
      state.bassSettings = normalizeBassSettings(arrangementSaved.bassSettings, state.bassSettings);
      state.pianoSettings = normalizePianoSettings(
        arrangementSaved.pianoSettings,
        state.pianoSettings
      );
    } else {
      state.tracks = ensureCoreTracks(state.tracks);
      state.arrangement = sanitizeArrangementForTracks(
        state.arrangement,
        state.tracks,
        state.transport.arrangementBars
      );
      state.drumClips = normalizeDrumClips(state.drumClips, state.drumPattern?.lanes);
      state.bassSettings = normalizeBassSettings(state.bassSettings, defaultSnapshot.bassSettings);
      state.pianoSettings = normalizePianoSettings(
        state.pianoSettings,
        defaultSnapshot.pianoSettings
      );
    }

    const uiSaved = readStorage(STORAGE_UI_V2) || readStorage(LEGACY_BASS);
    if (uiSaved && typeof uiSaved === "object") {
      state.ui = {
        ...state.ui,
        bassSf2Path: String(uiSaved.bassSf2Path || uiSaved.sf2Path || state.ui.bassSf2Path),
        pianoSf2Path: String(uiSaved.pianoSf2Path || state.ui.pianoSf2Path)
      };
    }

    if (hasArrangementSaved) {
      state.mixer = syncMixerFromTracks(state.mixer, state.tracks);
    } else {
      state.tracks = syncTracksFromMixer(state.tracks, state.mixer);
    }
    normalizePatternsForLoopBars(state, state.transport.loopBars);
    syncSharedDrumClipFromPattern(state);

    emit();
  }

  function getState() {
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function setTransport(patch) {
    const merged = {
      ...state.transport,
      ...(patch || {}),
      metronome: {
        ...state.transport.metronome,
        ...((patch && patch.metronome) || {})
      },
      loopRange: {
        ...state.transport.loopRange,
        ...((patch && patch.loopRange) || {})
      }
    };

    const nextTransport = normalizeTransport(merged, state.transport);
    const nextArrangement = sanitizeArrangementForTracks(
      state.arrangement,
      state.tracks,
      nextTransport.arrangementBars
    );
    const currentSelection = state.ui.dawSelection;
    const selectionValid =
      currentSelection &&
      state.tracks.some((track) => track.id === currentSelection.trackId) &&
      Number.isInteger(Number(currentSelection.barIndex)) &&
      Number(currentSelection.barIndex) >= 0 &&
      Number(currentSelection.barIndex) < nextTransport.arrangementBars;

    state = {
      ...state,
      transport: nextTransport,
      arrangement: nextArrangement,
      ui: {
        ...state.ui,
        dawSelection: selectionValid
          ? {
              trackId: currentSelection.trackId,
              barIndex: Number(currentSelection.barIndex)
            }
          : null
      }
    };
    normalizePatternsForLoopBars(state, nextTransport.loopBars);
    syncSharedDrumClipFromPattern(state);
    persistSettings();
    emit();
  }

  function setDrumPattern(patch) {
    const nextDrumPattern = {
      ...state.drumPattern,
      ...(patch || {})
    };

    if (patch?.lanes) {
      nextDrumPattern.lanes = {
        ...state.drumPattern.lanes,
        ...patch.lanes
      };
    }

    if (patch?.selectedSamples) {
      nextDrumPattern.selectedSamples = {
        ...state.drumPattern.selectedSamples,
        ...patch.selectedSamples
      };
    }

    if (patch?.laneGains) {
      nextDrumPattern.laneGains = {
        ...state.drumPattern.laneGains,
        ...patch.laneGains
      };
    }

    if (patch?.fallback) {
      nextDrumPattern.fallback = {
        ...state.drumPattern.fallback,
        ...patch.fallback,
        lanes: {
          ...state.drumPattern.fallback.lanes,
          ...(patch.fallback.lanes || {})
        }
      };
    }

    nextDrumPattern.sourceMode = patch?.sourceMode === "fallback" ? "fallback" : nextDrumPattern.sourceMode;

    state = {
      ...state,
      drumPattern: nextDrumPattern
    };
    normalizePatternsForLoopBars(state, state.transport.loopBars);
    syncSharedDrumClipFromPattern(state);
    persistSettings();
    emit();
  }

  function setDrumClip(clipRef, clipPatch) {
    const safeRef = String(clipRef || "").trim();
    if (!safeRef) {
      return;
    }

    const normalizedClip = normalizeDrumClip(clipPatch, safeRef);
    if (!normalizedClip) {
      return;
    }

    const nextClip = {
      ...normalizedClip,
      name:
        safeRef === SHARED_DRUM_CLIP_REF
          ? "Shared Main"
          : normalizedClip.name
    };

    state = {
      ...state,
      drumClips: {
        ...state.drumClips,
        [safeRef]: nextClip
      }
    };
    syncSharedDrumClipFromPattern(state);
    persistSettings();
    emit();
  }

  function deleteDrumClip(clipRef) {
    const safeRef = String(clipRef || "").trim();
    if (!safeRef || safeRef === SHARED_DRUM_CLIP_REF || !state.drumClips[safeRef]) {
      return;
    }

    const nextDrumClips = {
      ...state.drumClips
    };
    delete nextDrumClips[safeRef];

    const nextArrangement = {};
    for (const track of state.tracks) {
      const currentTrackCells = state.arrangement?.[track.id] || {};
      const updatedTrackCells = {};
      for (const [barKey, cell] of Object.entries(currentTrackCells)) {
        if (
          track.type === "drum" &&
          cell?.kind === "drum" &&
          String(cell?.data?.clipRef || "") === safeRef
        ) {
          updatedTrackCells[barKey] = {
            kind: "drum",
            data: {
              clipRef: SHARED_DRUM_CLIP_REF
            }
          };
        } else {
          updatedTrackCells[barKey] = cloneCell(cell);
        }
      }
      nextArrangement[track.id] = updatedTrackCells;
    }

    state = {
      ...state,
      drumClips: nextDrumClips,
      arrangement: nextArrangement
    };
    syncSharedDrumClipFromPattern(state);
    persistSettings();
    emit();
  }

  function setBassSettings(patch) {
    const merged = {
      ...state.bassSettings,
      ...(patch || {}),
      humanize: {
        ...state.bassSettings.humanize,
        ...((patch && patch.humanize) || {})
      }
    };

    state = {
      ...state,
      bassSettings: normalizeBassSettings(merged, state.bassSettings)
    };
    persistSettings();
    emit();
  }

  function setPianoSettings(patch) {
    const merged = {
      ...state.pianoSettings,
      ...(patch || {}),
      humanize: {
        ...state.pianoSettings.humanize,
        ...((patch && patch.humanize) || {})
      }
    };

    state = {
      ...state,
      pianoSettings: normalizePianoSettings(merged, state.pianoSettings)
    };
    persistSettings();
    emit();
  }

  function setMixer(patch) {
    const nextMixer = {
      ...state.mixer,
      ...(patch || {}),
      masterGain: clamp(Number(patch?.masterGain ?? state.mixer.masterGain), 0, 1),
      drumGain: clamp(Number(patch?.drumGain ?? state.mixer.drumGain), 0, 1),
      bassGain: clamp(Number(patch?.bassGain ?? state.mixer.bassGain), 0, 2),
      pianoGain: clamp(Number(patch?.pianoGain ?? state.mixer.pianoGain), 0, 2)
    };

    state = {
      ...state,
      mixer: nextMixer,
      tracks: syncTracksFromMixer(state.tracks, nextMixer)
    };

    persistSettings();
    emit();
  }

  function setTrackMix(trackId, patch) {
    const targetId = String(trackId || "");
    if (!targetId) {
      return;
    }

    let updated = false;
    const nextTracks = state.tracks.map((track) => {
      if (track.id !== targetId) {
        return track;
      }
      updated = true;
      return {
        ...track,
        name: patch?.name !== undefined ? String(patch.name) : track.name,
        volume: patch?.volume !== undefined ? clamp(Number(patch.volume) || 0, 0, 1) : track.volume,
        mute: patch?.mute !== undefined ? Boolean(patch.mute) : track.mute,
        solo: patch?.solo !== undefined ? Boolean(patch.solo) : track.solo
      };
    });

    if (!updated) {
      return;
    }

    state = {
      ...state,
      tracks: nextTracks,
      mixer: syncMixerFromTracks(state.mixer, nextTracks)
    };

    persistSettings();
    emit();
  }

  function setArrangementCell(trackId, barIndex, cellOrNull) {
    const safeTrackId = String(trackId || "");
    const track = state.tracks.find((item) => item.id === safeTrackId);
    const safeBarIndex = Number(barIndex);

    if (!track || !Number.isInteger(safeBarIndex)) {
      return;
    }

    if (safeBarIndex < 0 || safeBarIndex >= state.transport.arrangementBars) {
      return;
    }

    const normalizedCell = cellOrNull ? normalizeArrangementCell(track.type, cellOrNull) : null;
    const nextTrackCells = {
      ...(state.arrangement[safeTrackId] || {})
    };

    if (normalizedCell) {
      nextTrackCells[safeBarIndex] = normalizedCell;
    } else {
      delete nextTrackCells[safeBarIndex];
    }

    state = {
      ...state,
      arrangement: {
        ...state.arrangement,
        [safeTrackId]: nextTrackCells
      }
    };

    persistSettings();
    emit();
  }

  function clearArrangementCell(trackId, barIndex) {
    setArrangementCell(trackId, barIndex, null);
  }

  function setDawSelection(selection) {
    if (!selection || typeof selection !== "object") {
      state = {
        ...state,
        ui: {
          ...state.ui,
          dawSelection: null
        }
      };
      emit();
      return;
    }

    const trackId = String(selection.trackId || "");
    const barIndex = Number(selection.barIndex);
    const hasTrack = state.tracks.some((track) => track.id === trackId);

    state = {
      ...state,
      ui: {
        ...state.ui,
        dawSelection:
          hasTrack && Number.isInteger(barIndex) && barIndex >= 0 && barIndex < state.transport.arrangementBars
            ? { trackId, barIndex }
            : null
      }
    };
    emit();
  }

  function setDawClipboard(cell) {
    state = {
      ...state,
      ui: {
        ...state.ui,
        dawClipboard: cloneCell(cell)
      }
    };
    emit();
  }

  function setUi(patch) {
    state = {
      ...state,
      ui: {
        ...state.ui,
        ...patch
      }
    };
    if (
      Object.prototype.hasOwnProperty.call(patch || {}, "bassSf2Path") ||
      Object.prototype.hasOwnProperty.call(patch || {}, "pianoSf2Path") ||
      Object.prototype.hasOwnProperty.call(patch || {}, "sf2Path")
    ) {
      persistSettings();
    }
    emit();
  }

  function importSessionSnapshot(snapshot) {
    state = normalizeStoreState(snapshot);
    persistSettings();
    emit();
  }

  function resetSession() {
    state = normalizeStoreState();
    persistSettings();
    emit();
  }

  return {
    getState,
    subscribe,
    setTransport,
    setDrumPattern,
    setDrumClip,
    deleteDrumClip,
    setBassSettings,
    setPianoSettings,
    setMixer,
    setTrackMix,
    setArrangementCell,
    clearArrangementCell,
    setDawSelection,
    setDawClipboard,
    setUi,
    importSessionSnapshot,
    resetSession,
    loadPersistedSettings,
    persistSettings
  };
}





