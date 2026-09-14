export const DEFAULT_OPTIONS = Object.freeze({
  thresholdDb: -45,
  minHz: 65,
  maxHz: 1200,
  minNoteMs: 90,
  tempo: 120,
  quantize: 16,
  targetSampleRate: 12000,
  frameSize: 2048,
  hopSize: 512,
});

export function mixAudioBufferToMono(buffer) {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      mono[i] += data[i] / buffer.numberOfChannels;
    }
  }
  return mono;
}

export function downsample(input, fromRate, toRate) {
  if (fromRate <= toRate) return { samples: input, sampleRate: fromRate };
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return { samples: output, sampleRate: toRate };
}

export function detectPitch(frame, sampleRate, options = {}) {
  const { minHz, maxHz, thresholdDb } = { ...DEFAULT_OPTIONS, ...options };
  let mean = 0;
  for (const value of frame) mean += value;
  mean /= frame.length;

  let energy = 0;
  for (const value of frame) energy += (value - mean) ** 2;
  const rms = Math.sqrt(energy / frame.length);
  const db = 20 * Math.log10(rms + 1e-12);
  if (db < thresholdDb) return { hz: null, rms, correlation: 0 };

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / minHz));
  const correlations = new Float32Array(maxLag + 1);
  let bestLag = -1;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    const count = frame.length - lag;
    for (let i = 0; i < count; i += 1) {
      const left = frame[i] - mean;
      const right = frame[i + lag] - mean;
      sum += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const correlation = sum / Math.sqrt(leftEnergy * rightEnergy + 1e-12);
    correlations[lag] = correlation;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestCorrelation < 0.62) {
    return { hz: null, rms, correlation: bestCorrelation };
  }

  const strongPeak = Math.max(0.62, bestCorrelation * 0.9);
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (
      correlations[lag] >= strongPeak &&
      correlations[lag] > correlations[lag - 1] &&
      correlations[lag] >= correlations[lag + 1]
    ) {
      bestLag = lag;
      bestCorrelation = correlations[lag];
      break;
    }
  }

  const before = correlations[bestLag - 1] || bestCorrelation;
  const after = correlations[bestLag + 1] || bestCorrelation;
  const denominator = before - 2 * bestCorrelation + after;
  const offset = Math.abs(denominator) > 1e-8
    ? Math.max(-0.5, Math.min(0.5, 0.5 * (before - after) / denominator))
    : 0;

  return { hz: sampleRate / (bestLag + offset), rms, correlation: bestCorrelation };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function analyzeSamples(samples, sampleRate, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const reduced = downsample(samples, sampleRate, config.targetSampleRate);
  const frames = [];

  for (let start = 0; start + config.frameSize <= reduced.samples.length; start += config.hopSize) {
    const result = detectPitch(
      reduced.samples.subarray(start, start + config.frameSize),
      reduced.sampleRate,
      config,
    );
    const midi = result.hz
      ? Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(result.hz / 440))))
      : null;
    frames.push({ time: start / reduced.sampleRate, midi, rms: result.rms });
  }

  const smoothed = frames.map((frame, index) => {
    if (frame.midi === null) return frame;
    const neighbors = frames
      .slice(Math.max(0, index - 2), index + 3)
      .map((item) => item.midi)
      .filter(Number.isFinite);
    return { ...frame, midi: neighbors.length >= 3 ? median(neighbors) : frame.midi };
  });

  const notes = [];
  let active = null;
  const frameDuration = config.hopSize / reduced.sampleRate;
  const closeActive = (endTime) => {
    if (!active) return;
    active.end = endTime;
    if ((active.end - active.start) * 1000 >= config.minNoteMs) notes.push(active);
    active = null;
  };

  for (const frame of smoothed) {
    if (frame.midi === null) {
      closeActive(frame.time);
    } else if (!active) {
      active = { start: frame.time, end: frame.time + frameDuration, midi: frame.midi, rmsValues: [frame.rms] };
    } else if (frame.midi === active.midi) {
      active.end = frame.time + frameDuration;
      active.rmsValues.push(frame.rms);
    } else {
      closeActive(frame.time);
      active = { start: frame.time, end: frame.time + frameDuration, midi: frame.midi, rmsValues: [frame.rms] };
    }
  }
  closeActive(samples.length / sampleRate);

  return notes.map((note) => {
    const averageRms = note.rmsValues.reduce((sum, value) => sum + value, 0) / note.rmsValues.length;
    return {
      start: note.start,
      end: note.end,
      midi: note.midi,
      velocity: Math.max(35, Math.min(118, Math.round(42 + averageRms * 430))),
    };
  });
}

export function analyzeAudioBuffer(buffer, options = {}) {
  return analyzeSamples(mixAudioBufferToMono(buffer), buffer.sampleRate, options);
}

function variableLength(value) {
  const bytes = [value & 0x7f];
  while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

const uint32 = (value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const uint16 = (value) => [(value >>> 8) & 255, value & 255];
const ascii = (text) => [...text].map((character) => character.charCodeAt(0) & 255);

export function createMidiFile(notes, options = {}) {
  const { tempo, quantize } = { ...DEFAULT_OPTIONS, ...options };
  const ticksPerQuarter = 480;
  const ticksPerSecond = ticksPerQuarter / (60 / tempo);
  const gridTicks = quantize ? Math.round((ticksPerQuarter * 4) / quantize) : 1;
  const snap = (ticks) => Math.round(ticks / gridTicks) * gridTicks;
  const events = [];

  for (const note of notes) {
    const startTick = Math.max(0, snap(note.start * ticksPerSecond));
    const endTick = Math.max(startTick + Math.max(1, gridTicks), snap(note.end * ticksPerSecond));
    events.push({ tick: startTick, order: 1, bytes: [0x90, note.midi, note.velocity] });
    events.push({ tick: endTick, order: 0, bytes: [0x80, note.midi, 0] });
  }
  events.sort((left, right) => left.tick - right.tick || left.order - right.order);

  const microseconds = Math.round(60000000 / tempo);
  const track = [
    0x00, 0xff, 0x51, 0x03,
    (microseconds >>> 16) & 255,
    (microseconds >>> 8) & 255,
    microseconds & 255,
    0x00, 0xff, 0x03, 0x0b, ...ascii('MP3 to MIDI'),
  ];
  let previousTick = 0;
  for (const event of events) {
    track.push(...variableLength(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  return new Uint8Array([
    ...ascii('MThd'), ...uint32(6), ...uint16(0), ...uint16(1), ...uint16(ticksPerQuarter),
    ...ascii('MTrk'), ...uint32(track.length), ...track,
  ]);
}
