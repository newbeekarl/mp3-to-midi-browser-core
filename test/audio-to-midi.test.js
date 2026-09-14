import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples, createMidiFile, detectPitch } from '../src/audio-to-midi.js';

function sine(frequency, seconds, sampleRate = 12000, amplitude = 0.5) {
  return Float32Array.from(
    { length: Math.floor(seconds * sampleRate) },
    (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate),
  );
}

test('detectPitch finds an A4 sine wave', () => {
  const result = detectPitch(sine(440, 2048 / 12000), 12000);
  assert.ok(result.hz !== null);
  assert.ok(Math.abs(result.hz - 440) < 3, `detected ${result.hz} Hz`);
});

test('analyzeSamples turns a sustained A4 into MIDI note 69', () => {
  const notes = analyzeSamples(sine(440, 1), 12000, { minNoteMs: 40 });
  assert.ok(notes.length >= 1);
  assert.equal(notes[0].midi, 69);
});

test('createMidiFile writes MIDI header and track chunks', () => {
  const bytes = createMidiFile([{ start: 0, end: 0.5, midi: 69, velocity: 90 }]);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'MThd');
  assert.equal(new TextDecoder().decode(bytes.slice(14, 18)), 'MTrk');
});
