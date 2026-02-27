import { normalizeNoteName } from "../bass/rootNoteUtils";
import { LANE_IDS, buildPresetPattern } from "../patterns/presets";
import { normalizeChordData } from "../piano/chordUtils";

const STORAGE_TRANSPORT_V2 = "drum-loop-maker.transport.v2";
const STORAGE_TRANSPORT_V3 = "drum-loop-maker.transport.v3";
const STORAGE_TRANSPORT_V4 = "drum-loop-maker.transport.v4";
const STORAGE_ARRANGEMENT_V4 = "drum-loop-maker.arrangement.v4";
const STORAGE_ARRANGEMENT_V3 = "drum-loop-maker.arrangement.v3";
const STORAGE_ARRANGEMENT_V2 = "drum-loop-maker.arrangement.v2";
const STORAGE_UI_V2 = "drum-loop-maker.ui.v2";
const STORAGE_MIXER = "drum-loop-maker.mixer.v1";
const STORAGE_DRUM_PATTERN_V1 = "drum-loop-maker.drum-pattern.v1";

const LEGACY_TRANSPORT = "drum-loop-maker.transport.v1";
const LEGACY_BASS = "drum-loop-maker.bass.v1";
const METRONOME_SUBDIVISION_VALUES = new Set(["half", "quarter", "eighth", "sixteenth"]);
const TRACK_ENGINES = new Set(["drum_clip", "bass_sf2", "piano_sf2", "pad_synth"]);
const HARMONY_MODES = new Set(["triad", "power", "seventh", "sus2", "sus4", "single"]);
const SCALE_MODES = new Set(["major", "minor", "pentatonic", "blues"]);
const PIANO_PLAY_STYLES = new Set(["block", "stabs8", "arpUp", "arpDown", "arpUpDown"]);
const BASS_RHYTHM_PRESETS = new Set(["root8ths", "rootFifth", "octave", "walking"]);

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
    engine: "drum_clip",
    name: "Drums",
    volume: 0.9,
    mute: false,
    solo: false
  },
  {
    id: TRACK_IDS.BASS,
    type: "bass",
    engine: "bass_sf2",
    name: "Bass",
    volume: 1,
    mute: false,
    solo: false
  },
  {
    id: TRACK_IDS.PIANO,
    type: "instrument",
    engine: "piano_sf2",
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

function createSelectedSampleSnapshot(selectedSamples, fallbackSelectedSamples = {}) {
  const source = selectedSamples && typeof selectedSamples === "object" ? selectedSamples : {};
  const fallback =
    fallbackSelectedSamples && typeof fallbackSelectedSamples === "object"
      ? fallbackSelectedSamples
      : {};
  return Object.fromEntries(
    LANE_IDS.map((laneId) => [laneId, String(source[laneId] ?? fallback[laneId] ?? "")])
  );
}

function createLaneGainSnapshot(laneGains, fallbackLaneGains = {}) {
  const source = laneGains && typeof laneGains === "object" ? laneGains : {};
  const fallback =
    fallbackLaneGains && typeof fallbackLaneGains === "object" ? fallbackLaneGains : {};
  return Object.fromEntries(
    LANE_IDS.map((laneId) => [laneId, clamp(Number(source[laneId] ?? fallback[laneId] ?? 1), 0, 1)])
  );
}

function normalizeDrumClip(clip, fallbackName, fallbackSelectedSamples, fallbackLaneGains) {
  if (!clip || typeof clip !== "object") {
    return null;
  }
  const name = String(clip.name || fallbackName || "Clip").trim() || String(fallbackName || "Clip");
  return {
    name,
    lanes: createOneBarLaneSnapshot(clip.lanes),
    selectedSamples: createSelectedSampleSnapshot(clip.selectedSamples, fallbackSelectedSamples),
    laneGains: createLaneGainSnapshot(clip.laneGains, fallbackLaneGains)
  };
}

function normalizeDrumClips(drumClips, fallbackPatternLanes, fallbackSelectedSamples, fallbackLaneGains) {
  const source = drumClips && typeof drumClips === "object" ? drumClips : {};
  const next = {};

  for (const [clipRef, clip] of Object.entries(source)) {
    const safeRef = String(clipRef || "").trim();
    if (!safeRef) {
      continue;
    }
    const normalized = normalizeDrumClip(
      clip,
      safeRef,
      fallbackSelectedSamples,
      fallbackLaneGains
    );
    if (!normalized) {
      continue;
    }
    next[safeRef] = normalized;
  }

  next[SHARED_DRUM_CLIP_REF] = {
    name: "Shared Main",
    lanes: createOneBarLaneSnapshot(fallbackPatternLanes),
    selectedSamples: createSelectedSampleSnapshot(fallbackSelectedSamples),
    laneGains: createLaneGainSnapshot(fallbackLaneGains)
  };

  return next;
}

function syncSharedDrumClipFromPattern(targetState) {
  targetState.drumClips = normalizeDrumClips(
    targetState.drumClips,
    targetState.drumPattern?.lanes,
    targetState.drumPattern?.selectedSamples,
    targetState.drumPattern?.laneGains
  );
}

function createEmptyArrangement(tracks) {
  const next = {};
  for (const track of tracks) {
    next[track.id] = {};
  }
  return next;
}

function inferTrackEngine(track, type) {
  const requested = String(track?.engine || "").trim();
  if (TRACK_ENGINES.has(requested)) {
    return requested;
  }

  const safeId = String(track?.id || "").trim();
  if (safeId === TRACK_IDS.DRUMS || type === "drum") {
    return "drum_clip";
  }
  if (safeId === TRACK_IDS.BASS || type === "bass") {
    return "bass_sf2";
  }
  if (safeId === TRACK_IDS.PIANO) {
    return "piano_sf2";
  }

  return "pad_synth";
}

function defaultNameForEngine(engine) {
  if (engine === "drum_clip") {
    return "Drums";
  }
  if (engine === "bass_sf2") {
    return "Bass";
  }
  if (engine === "piano_sf2") {
    return "Piano";
  }
  return "Pad";
}

function sanitizeTrack(track, index) {
  const type = ["drum", "bass", "instrument"].includes(track?.type)
    ? track.type
    : "instrument";
  const engine = inferTrackEngine(track, type);
  const fallback =
    DEFAULT_TRACKS.find((item) => item.id === track?.id) ||
    DEFAULT_TRACKS.find((item) => item.type === type) ||
    DEFAULT_TRACKS[0];
  return {
    id: String(track?.id || `${type}-${index + 1}`),
    type,
    engine,
    name: String(track?.name || fallback.name || defaultNameForEngine(engine)),
    volume: clamp(Number(track?.volume ?? fallback.volume) || fallback.volume, 0, 1),
    mute: Boolean(track?.mute),
    solo: Boolean(track?.solo)
  };
}

function ensureCoreTracks(tracks) {
  const next = Array.isArray(tracks) ? tracks.map(sanitizeTrack) : [];

  if (!next.some((track) => track.id === TRACK_IDS.DRUMS || track.engine === "drum_clip")) {
    next.unshift({ ...DEFAULT_TRACKS[0] });
  }
  if (!next.some((track) => track.id === TRACK_IDS.BASS || track.engine === "bass_sf2")) {
    next.push({ ...DEFAULT_TRACKS[1] });
  }

  if (!next.some((track) => track.id === TRACK_IDS.PIANO || track.engine === "piano_sf2")) {
    next.push({ ...DEFAULT_TRACKS[2] });
  }

  for (let index = 0; index < next.length; index += 1) {
    if (next[index].id === TRACK_IDS.DRUMS) {
      next[index] = { ...next[index], type: "drum", engine: "drum_clip", name: "Drums" };
    } else if (next[index].id === TRACK_IDS.BASS) {
      next[index] = { ...next[index], type: "bass", engine: "bass_sf2", name: "Bass" };
    } else if (next[index].id === TRACK_IDS.PIANO) {
      next[index] = { ...next[index], type: "instrument", engine: "piano_sf2", name: "Piano" };
    }
  }

  return next;
}

function normalizeNoteCell(cellData) {
  const source = cellData && typeof cellData === "object" ? cellData : {};

  if (Object.prototype.hasOwnProperty.call(source, "root")) {
    const split = Boolean(source.split);
    return {
      root: normalizeNoteName(source.root || "C", "C"),
      split,
      secondRoot: split ? normalizeNoteName(source.secondRoot || source.root || "G", "G") : null
    };
  }

  if (source.type === "split") {
    return {
      root: normalizeNoteName(source.firstHalf || "C", "C"),
      split: true,
      secondRoot: normalizeNoteName(source.secondHalf || "G", "G")
    };
  }

  return {
    root: normalizeNoteName(source.note || "C", "C"),
    split: false,
    secondRoot: null
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

  const isDrumTrack =
    trackType === "drum" ||
    (trackType && typeof trackType === "object" && trackType.engine === "drum_clip");

  if (isDrumTrack) {
    if (cell.type === "drum") {
      return {
        type: "drum",
        clipRef: String(cell?.clipRef || SHARED_DRUM_CLIP_REF)
      };
    }
    if (cell.kind === "drum") {
      return {
        type: "drum",
        clipRef: String(cell?.data?.clipRef || SHARED_DRUM_CLIP_REF)
      };
    }
    return null;
  }

  if (cell.type === "note") {
    return {
      type: "note",
      ...normalizeNoteCell(cell)
    };
  }

  if (cell.kind === "note") {
    return {
      type: "note",
      ...normalizeNoteCell(cell.data)
    };
  }

  if (cell.kind === "chord") {
    const normalizedChord = normalizeChordBarCell(cell.data);
    if (normalizedChord.type === "split") {
      return {
        type: "note",
        root: normalizeNoteName(normalizedChord.firstHalf?.root || "C", "C"),
        split: true,
        secondRoot: normalizeNoteName(normalizedChord.secondHalf?.root || "G", "G")
      };
    }
    return {
      type: "note",
      root: normalizeNoteName(normalizedChord.chord?.root || "C", "C"),
      split: false,
      secondRoot: null
    };
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
      const normalized = normalizeArrangementCell(track, cell);
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
  const preset = BASS_RHYTHM_PRESETS.has(source.rhythmPreset)
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
  const fallbackStyle = PIANO_PLAY_STYLES.has(fallback?.playStyle)
    ? fallback.playStyle
    : "block";
  const style = PIANO_PLAY_STYLES.has(source.playStyle)
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

function defaultTrackSettingsForTrack(track) {
  const base = {
    harmonyMode: "triad",
    scale: "major",
    octave: 4,
    attackMs: 180,
    releaseMs: 900,
    filterCutoffHz: 2200,
    detuneCents: 8,
    reverbSend: 0.18,
    vibratoDepth: 5,
    vibratoRateHz: 4,
    humanize: {
      velocity: true,
      timing: true
    }
  };

  if (track?.engine === "bass_sf2" || track?.id === TRACK_IDS.BASS) {
    return {
      ...base,
      octave: 2,
      attackMs: 120,
      releaseMs: 420,
      filterCutoffHz: 1800,
      detuneCents: 4,
      reverbSend: 0,
      vibratoDepth: 0,
      rhythmPreset: "root8ths"
    };
  }

  if (track?.engine === "piano_sf2" || track?.id === TRACK_IDS.PIANO) {
    return {
      ...base,
      attackMs: 30,
      releaseMs: 220,
      filterCutoffHz: 5200,
      detuneCents: 0,
      reverbSend: 0.1,
      vibratoDepth: 0,
      playStyle: "block"
    };
  }

  return base;
}

function normalizeTrackSettingsEntry(settings, fallback, track) {
  const source = settings && typeof settings === "object" ? settings : {};
  const defaults = fallback || defaultTrackSettingsForTrack(track);

  const next = {
    harmonyMode: HARMONY_MODES.has(source.harmonyMode) ? source.harmonyMode : defaults.harmonyMode,
    scale: SCALE_MODES.has(source.scale) ? source.scale : defaults.scale,
    octave: clampInt(source.octave ?? defaults.octave, 2, 5),
    attackMs: clampInt(source.attackMs ?? defaults.attackMs, 1, 3000),
    releaseMs: clampInt(source.releaseMs ?? defaults.releaseMs, 1, 5000),
    filterCutoffHz: clampInt(source.filterCutoffHz ?? defaults.filterCutoffHz, 80, 20000),
    detuneCents: clamp(Number(source.detuneCents ?? defaults.detuneCents) || defaults.detuneCents, 0, 60),
    reverbSend: clamp(Number(source.reverbSend ?? defaults.reverbSend) || defaults.reverbSend, 0, 1),
    vibratoDepth: clamp(Number(source.vibratoDepth ?? defaults.vibratoDepth) || defaults.vibratoDepth, 0, 80),
    vibratoRateHz: clamp(Number(source.vibratoRateHz ?? defaults.vibratoRateHz) || defaults.vibratoRateHz, 0.1, 12),
    humanize: {
      velocity:
        source?.humanize?.velocity !== undefined
          ? Boolean(source.humanize.velocity)
          : Boolean(defaults?.humanize?.velocity),
      timing:
        source?.humanize?.timing !== undefined
          ? Boolean(source.humanize.timing)
          : Boolean(defaults?.humanize?.timing)
    }
  };

  if (track?.engine === "bass_sf2" || track?.id === TRACK_IDS.BASS) {
    next.rhythmPreset = BASS_RHYTHM_PRESETS.has(source.rhythmPreset)
      ? source.rhythmPreset
      : defaults.rhythmPreset || "root8ths";
  }

  if (track?.engine === "piano_sf2" || track?.id === TRACK_IDS.PIANO) {
    next.playStyle = PIANO_PLAY_STYLES.has(source.playStyle)
      ? source.playStyle
      : defaults.playStyle || "block";
  }

  return next;
}

function normalizeTrackSettingsMap(trackSettings, tracks, legacyBassSettings, legacyPianoSettings) {
  const source = trackSettings && typeof trackSettings === "object" ? trackSettings : {};
  const next = {};

  for (const track of tracks) {
    const defaults = defaultTrackSettingsForTrack(track);
    let fallback = defaults;
    if (track.id === TRACK_IDS.BASS && legacyBassSettings) {
      const bassLegacy = normalizeBassSettings(legacyBassSettings, {
        rhythmPreset: defaults.rhythmPreset || "root8ths",
        humanize: defaults.humanize
      });
      fallback = {
        ...fallback,
        rhythmPreset: bassLegacy.rhythmPreset,
        humanize: bassLegacy.humanize
      };
    }
    if (track.id === TRACK_IDS.PIANO && legacyPianoSettings) {
      const pianoLegacy = normalizePianoSettings(legacyPianoSettings, {
        playStyle: defaults.playStyle || "block",
        humanize: defaults.humanize
      });
      fallback = {
        ...fallback,
        playStyle: pianoLegacy.playStyle,
        humanize: pianoLegacy.humanize
      };
    }

    next[track.id] = normalizeTrackSettingsEntry(source[track.id], fallback, track);
  }

  return next;
}

function legacyBassSettingsFromTrackSettings(trackSettings, fallback) {
  const source = trackSettings || fallback;
  return normalizeBassSettings(
    {
      rhythmPreset: source?.rhythmPreset,
      humanize: source?.humanize
    },
    fallback
  );
}

function legacyPianoSettingsFromTrackSettings(trackSettings, fallback) {
  const source = trackSettings || fallback;
  return normalizePianoSettings(
    {
      playStyle: source?.playStyle,
      humanize: source?.humanize
    },
    fallback
  );
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
  const trackSettings = normalizeTrackSettingsMap({}, tracks, null, null);
  const bassSettings = legacyBassSettingsFromTrackSettings(trackSettings[TRACK_IDS.BASS], {
    rhythmPreset: "root8ths",
    humanize: {
      velocity: true,
      timing: true
    }
  });
  const pianoSettings = legacyPianoSettingsFromTrackSettings(trackSettings[TRACK_IDS.PIANO], {
    playStyle: "block",
    humanize: {
      velocity: true,
      timing: true
    }
  });
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
    drumClips: normalizeDrumClips(
      null,
      drumPattern.lanes,
      drumPattern.selectedSamples,
      drumPattern.laneGains
    ),
    trackSettings,
    bassSettings,
    pianoSettings,
    drumPattern
  };
}

function getTrackByType(tracks, type) {
  return tracks.find((track) => track.type === type) || null;
}

function syncTracksFromMixer(tracks, mixer) {
  return tracks.map((track) => {
    if (track.id === TRACK_IDS.DRUMS) {
      return {
        ...track,
        volume: clamp(Number(mixer.drumGain) || track.volume, 0, 1),
        mute: Boolean(mixer.drumMute),
        solo: Boolean(mixer.drumSolo)
      };
    }

    if (track.id === TRACK_IDS.BASS) {
      return {
        ...track,
        volume: clamp(Number(mixer.bassGain) || track.volume, 0, 1),
        mute: Boolean(mixer.bassMute),
        solo: Boolean(mixer.bassSolo)
      };
    }

    if (track.id === TRACK_IDS.PIANO) {
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
  const drumTrack = tracks.find((track) => track.id === TRACK_IDS.DRUMS) || getTrackByType(tracks, "drum");
  const bassTrack = tracks.find((track) => track.id === TRACK_IDS.BASS) || getTrackByType(tracks, "bass");
  const instrumentTrack = tracks.find((track) => track.id === TRACK_IDS.PIANO);

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
  if (cell.type === "drum" || cell.kind === "drum") {
    return {
      type: "drum",
      clipRef: String(cell?.clipRef || cell?.data?.clipRef || SHARED_DRUM_CLIP_REF)
    };
  }
  return {
    type: "note",
    ...normalizeNoteCell(cell.data || cell)
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
  const nextBassSettings = normalizeBassSettings(merged.bassSettings, defaults.bassSettings);
  const nextPianoSettings = normalizePianoSettings(merged.pianoSettings, defaults.pianoSettings);
  merged.trackSettings = normalizeTrackSettingsMap(
    merged.trackSettings,
    merged.tracks,
    nextBassSettings,
    nextPianoSettings
  );
  merged.bassSettings = legacyBassSettingsFromTrackSettings(
    merged.trackSettings[TRACK_IDS.BASS],
    nextBassSettings
  );
  merged.pianoSettings = legacyPianoSettingsFromTrackSettings(
    merged.trackSettings[TRACK_IDS.PIANO],
    nextPianoSettings
  );

  merged.mixer = syncMixerFromTracks(
    {
      ...defaults.mixer,
      ...(merged.mixer && typeof merged.mixer === "object" ? merged.mixer : {})
    },
    merged.tracks
  );

  normalizePatternsForLoopBars(merged, merged.transport.loopBars);
  merged.drumClips = normalizeDrumClips(
    merged.drumClips,
    merged.drumPattern?.lanes,
    merged.drumPattern?.selectedSamples,
    merged.drumPattern?.laneGains
  );
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
      trackSettings: state.trackSettings,
      bassSettings: state.bassSettings,
      pianoSettings: state.pianoSettings
    };

    const mixerPayload = {
      ...state.mixer,
      drumSourceMode: state.drumPattern.sourceMode
    };

    writeStorage(STORAGE_TRANSPORT_V2, transportPayload);
    writeStorage(STORAGE_TRANSPORT_V3, transportPayload);
    writeStorage(STORAGE_TRANSPORT_V4, transportPayload);
    writeStorage(STORAGE_ARRANGEMENT_V3, arrangementPayload);
    writeStorage(STORAGE_ARRANGEMENT_V4, arrangementPayload);
    writeStorage(STORAGE_MIXER, mixerPayload);
    writeStorage(STORAGE_DRUM_PATTERN_V1, state.drumPattern);
    writeStorage(STORAGE_UI_V2, {
      bassSf2Path: state.ui.bassSf2Path,
      pianoSf2Path: state.ui.pianoSf2Path
    });
  }

  function loadPersistedSettings() {
    const defaultSnapshot = defaultState();

    const transportSaved =
      readStorage(STORAGE_TRANSPORT_V4) ||
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

    const drumPatternSaved = readStorage(STORAGE_DRUM_PATTERN_V1);
    if (drumPatternSaved && typeof drumPatternSaved === "object") {
      state.drumPattern = {
        ...state.drumPattern,
        ...drumPatternSaved,
        lanes: {
          ...state.drumPattern.lanes,
          ...(drumPatternSaved.lanes || {})
        },
        laneGains: {
          ...state.drumPattern.laneGains,
          ...(drumPatternSaved.laneGains || {})
        },
        selectedSamples: {
          ...state.drumPattern.selectedSamples,
          ...(drumPatternSaved.selectedSamples || {})
        },
        fallback: {
          ...state.drumPattern.fallback,
          ...(drumPatternSaved.fallback || {}),
          lanes: {
            ...state.drumPattern.fallback.lanes,
            ...(drumPatternSaved?.fallback?.lanes || {})
          }
        }
      };
      state.drumPattern.sourceMode =
        drumPatternSaved.sourceMode === "fallback" ? "fallback" : "shared";
    }

    const arrangementSaved =
      readStorage(STORAGE_ARRANGEMENT_V4) ||
      readStorage(STORAGE_ARRANGEMENT_V3) || readStorage(STORAGE_ARRANGEMENT_V2);
    const hasArrangementSaved = arrangementSaved && typeof arrangementSaved === "object";
    if (hasArrangementSaved) {
      state.tracks = ensureCoreTracks(arrangementSaved.tracks);
      state.arrangement = sanitizeArrangementForTracks(
        arrangementSaved.arrangement,
        state.tracks,
        state.transport.arrangementBars
      );
      state.drumClips = normalizeDrumClips(
        arrangementSaved.drumClips,
        state.drumPattern?.lanes,
        state.drumPattern?.selectedSamples,
        state.drumPattern?.laneGains
      );
      const nextBass = normalizeBassSettings(arrangementSaved.bassSettings, state.bassSettings);
      const nextPiano = normalizePianoSettings(
        arrangementSaved.pianoSettings,
        state.pianoSettings
      );
      state.trackSettings = normalizeTrackSettingsMap(
        arrangementSaved.trackSettings,
        state.tracks,
        nextBass,
        nextPiano
      );
      state.bassSettings = legacyBassSettingsFromTrackSettings(
        state.trackSettings[TRACK_IDS.BASS],
        nextBass
      );
      state.pianoSettings = legacyPianoSettingsFromTrackSettings(
        state.trackSettings[TRACK_IDS.PIANO],
        nextPiano
      );
    } else {
      state.tracks = ensureCoreTracks(state.tracks);
      state.arrangement = sanitizeArrangementForTracks(
        state.arrangement,
        state.tracks,
        state.transport.arrangementBars
      );
      state.drumClips = normalizeDrumClips(
        state.drumClips,
        state.drumPattern?.lanes,
        state.drumPattern?.selectedSamples,
        state.drumPattern?.laneGains
      );
      const nextBass = normalizeBassSettings(state.bassSettings, defaultSnapshot.bassSettings);
      const nextPiano = normalizePianoSettings(
        state.pianoSettings,
        defaultSnapshot.pianoSettings
      );
      state.trackSettings = normalizeTrackSettingsMap(
        state.trackSettings,
        state.tracks,
        nextBass,
        nextPiano
      );
      state.bassSettings = legacyBassSettingsFromTrackSettings(
        state.trackSettings[TRACK_IDS.BASS],
        nextBass
      );
      state.pianoSettings = legacyPianoSettingsFromTrackSettings(
        state.trackSettings[TRACK_IDS.PIANO],
        nextPiano
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

    const normalizedClip = normalizeDrumClip(
      clipPatch,
      safeRef,
      state.drumPattern?.selectedSamples,
      state.drumPattern?.laneGains
    );
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
          (track.type === "drum" || track.engine === "drum_clip") &&
          (cell?.type === "drum" || cell?.kind === "drum") &&
          String(cell?.clipRef || cell?.data?.clipRef || "") === safeRef
        ) {
          updatedTrackCells[barKey] = {
            type: "drum",
            clipRef: SHARED_DRUM_CLIP_REF
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

    const normalized = normalizeBassSettings(merged, state.bassSettings);
    const bassTrack = state.tracks.find((track) => track.id === TRACK_IDS.BASS);
    const nextTrackSettings = {
      ...state.trackSettings
    };
    if (bassTrack) {
      nextTrackSettings[bassTrack.id] = normalizeTrackSettingsEntry(
        {
          ...nextTrackSettings[bassTrack.id],
          rhythmPreset: normalized.rhythmPreset,
          humanize: normalized.humanize
        },
        nextTrackSettings[bassTrack.id] || defaultTrackSettingsForTrack(bassTrack),
        bassTrack
      );
    }

    state = {
      ...state,
      bassSettings: normalized,
      trackSettings: nextTrackSettings
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

    const normalized = normalizePianoSettings(merged, state.pianoSettings);
    const pianoTrack = state.tracks.find((track) => track.id === TRACK_IDS.PIANO);
    const nextTrackSettings = {
      ...state.trackSettings
    };
    if (pianoTrack) {
      nextTrackSettings[pianoTrack.id] = normalizeTrackSettingsEntry(
        {
          ...nextTrackSettings[pianoTrack.id],
          playStyle: normalized.playStyle,
          humanize: normalized.humanize
        },
        nextTrackSettings[pianoTrack.id] || defaultTrackSettingsForTrack(pianoTrack),
        pianoTrack
      );
    }

    state = {
      ...state,
      pianoSettings: normalized,
      trackSettings: nextTrackSettings
    };
    persistSettings();
    emit();
  }

  function setTrackSettings(trackId, patch) {
    const safeTrackId = String(trackId || "");
    const track = state.tracks.find((item) => item.id === safeTrackId);
    if (!track) {
      return;
    }

    const base = state.trackSettings[safeTrackId] || defaultTrackSettingsForTrack(track);
    const merged = {
      ...base,
      ...(patch || {}),
      humanize: {
        ...base.humanize,
        ...((patch && patch.humanize) || {})
      }
    };

    const normalized = normalizeTrackSettingsEntry(merged, base, track);
    const nextTrackSettings = {
      ...state.trackSettings,
      [safeTrackId]: normalized
    };

    state = {
      ...state,
      trackSettings: nextTrackSettings,
      bassSettings: legacyBassSettingsFromTrackSettings(
        nextTrackSettings[TRACK_IDS.BASS],
        state.bassSettings
      ),
      pianoSettings: legacyPianoSettingsFromTrackSettings(
        nextTrackSettings[TRACK_IDS.PIANO],
        state.pianoSettings
      )
    };
    persistSettings();
    emit();
  }

  function addTrack({ engine } = {}) {
    const safeEngine = TRACK_ENGINES.has(engine) ? engine : "pad_synth";

    if (safeEngine === "drum_clip" && state.tracks.some((track) => track.engine === "drum_clip")) {
      return null;
    }
    if (safeEngine === "bass_sf2" && state.tracks.some((track) => track.engine === "bass_sf2")) {
      return null;
    }
    if (safeEngine === "piano_sf2" && state.tracks.some((track) => track.engine === "piano_sf2")) {
      return null;
    }

    let track;
    if (safeEngine === "drum_clip") {
      track = { ...DEFAULT_TRACKS[0] };
    } else if (safeEngine === "bass_sf2") {
      track = { ...DEFAULT_TRACKS[1] };
    } else if (safeEngine === "piano_sf2") {
      track = { ...DEFAULT_TRACKS[2] };
    } else {
      const padCount = state.tracks.filter((item) => item.engine === "pad_synth").length + 1;
      track = {
        id: `track-pad-${Date.now()}-${padCount}`,
        type: "instrument",
        engine: "pad_synth",
        name: `Pad ${padCount}`,
        volume: 0.85,
        mute: false,
        solo: false
      };
    }

    if (state.tracks.some((item) => item.id === track.id)) {
      return null;
    }

    const nextTracks = [...state.tracks, track];
    const nextTrackSettings = {
      ...state.trackSettings,
      [track.id]: defaultTrackSettingsForTrack(track)
    };

    state = {
      ...state,
      tracks: nextTracks,
      arrangement: {
        ...state.arrangement,
        [track.id]: {}
      },
      trackSettings: nextTrackSettings,
      mixer: syncMixerFromTracks(state.mixer, nextTracks)
    };
    persistSettings();
    emit();
    return track;
  }

  function removeTrack(trackId) {
    const safeTrackId = String(trackId || "");
    if (!safeTrackId) {
      return false;
    }
    if (
      safeTrackId === TRACK_IDS.DRUMS ||
      safeTrackId === TRACK_IDS.BASS ||
      safeTrackId === TRACK_IDS.PIANO
    ) {
      return false;
    }

    if (!state.tracks.some((track) => track.id === safeTrackId)) {
      return false;
    }

    const nextTracks = state.tracks.filter((track) => track.id !== safeTrackId);
    const nextArrangement = {
      ...state.arrangement
    };
    delete nextArrangement[safeTrackId];

    const nextTrackSettings = {
      ...state.trackSettings
    };
    delete nextTrackSettings[safeTrackId];

    const nextSelection =
      state.ui.dawSelection?.trackId === safeTrackId ? null : state.ui.dawSelection;

    state = {
      ...state,
      tracks: nextTracks,
      arrangement: nextArrangement,
      trackSettings: nextTrackSettings,
      mixer: syncMixerFromTracks(state.mixer, nextTracks),
      ui: {
        ...state.ui,
        dawSelection: nextSelection
      }
    };
    persistSettings();
    emit();
    return true;
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

    const normalizedCell = cellOrNull ? normalizeArrangementCell(track, cellOrNull) : null;
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
    setTrackSettings,
    addTrack,
    removeTrack,
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





