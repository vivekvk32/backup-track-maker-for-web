import { createRootNoteTrack } from "./createRootNoteTrack";
import { TRACK_IDS } from "../daw/transportStore";

export function createPianoTrack({ sf2Player, store }) {
  return createRootNoteTrack({
    sf2Player,
    store,
    trackType: "instrument",
    trackId: TRACK_IDS.PIANO,
    settingsKey: "pianoSettings",
    baseOctave: 4,
    minReliableMidi: null
  });
}
