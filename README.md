# MP3 to MIDI Browser Core

A small, dependency-free JavaScript reference implementation for detecting a clear monophonic melody in browser-decoded audio and writing the detected notes as a Standard MIDI File.

The code is extracted from the working browser tool at [MP3 to MIDI Tool](https://mp3tomiditool.com/). Audio stays inside the visitor's browser; this package does not upload files or call an API.

## What is included

- Autocorrelation-based pitch detection
- Stereo-to-mono mixing and optional downsampling
- Short-fragment filtering
- MIDI note velocity derived from frame energy
- Optional timing quantization
- Standard MIDI File generation
- A browser demo and a machine-readable control reference

## Important limitation

This implementation is designed for clear, single-note melodies. Chords, dense mixes, drums, heavy reverb, and overlapping instruments can produce missing or incorrect notes. The project makes no accuracy guarantee.

## Run the tests

```sh
npm test
```

## Open the demo

Serve the repository with any static file server and open `examples/index.html`. The demo accepts MP3 and WAV files through the Web Audio API and downloads a `.mid` file without sending the source audio anywhere.

## Basic use

```js
import { analyzeAudioBuffer, createMidiFile } from './src/audio-to-midi.js';

const notes = analyzeAudioBuffer(audioBuffer, {
  thresholdDb: -45,
  minHz: 65,
  maxHz: 1200,
  minNoteMs: 90,
});

const midiBytes = createMidiFile(notes, {
  tempo: 120,
  quantize: 16,
});
```

## Control reference

[`data/control-reference.csv`](data/control-reference.csv) records the ranges and defaults used by the live browser tool. They are starting points rather than performance claims.

## License

MIT
