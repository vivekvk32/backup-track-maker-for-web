import { createRootNoteTrack } from "./createRootNoteTrack";

const MIN_RELIABLE_BASS_MIDI = 38;

export function createBassTrack({ sf2Player, store }) {
  return createRootNoteTrack({
    sf2Player,
    store,
    trackType: "bass",
    settingsKey: "bassSettings",
    baseOctave: 2,
    minReliableMidi: MIN_RELIABLE_BASS_MIDI
  });
}
