# Drum + DAW Groove Builder

Local-first Vite web app with two tabs:
- `Drums`: existing drum loop sequencer and export workflow.
- `DAW`: shared transport with Drum track + SF2 Acoustic Bass track.

Everything runs in-browser with static assets from `public/`.

## Folder setup

### Drum samples
Sample audio is not bundled in this repository. Download these packs online and place them under:

```text
public/
  samples/
    Drum Samples I/
    Drum Samples II/
    Real Drums Vol. 1/
```

Search and download the packs by name (`Drum Samples I`, `Drum Samples II`, `Real Drums Vol. 1`), then extract them into `public/samples/`.

### Acoustic bass SF2
The DAW tab expects this file:

```text
public/instruments/acoustic_bass.sf2
```

SF2 files are not bundled here. Download an acoustic bass SF2 online and place it at that path, for example:

```powershell
New-Item -ItemType Directory -Force public/instruments | Out-Null
Copy-Item -Force "$HOME/Downloads/your-acoustic-bass.sf2" "public/instruments/acoustic_bass.sf2"
```

You can change the path later from the DAW tab (`SF2 Path` + `Load SF2`).

## Run locally

```bash
npm install
npm run gen:samples
npm run dev
```

Optional one-command start:

```bash
npm start
```

Build for static hosting:

```bash
npm run build
```

## Notes
- Runtime uses no external network calls.
- SF2 playback uses bundled npm package `sf2-synth-audio-worklet` (no CDN at runtime).
- Shared transport drives drums, bass, and metronome from one scheduler clock.
- Transport/mixer/bass settings persist in localStorage; decoded audio buffers are not persisted.
- Export currently renders drum engine output (WAV/MP3) from the Drums tab flow.
