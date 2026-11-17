import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LiveEcgDisplay } from '../live-ecg-display.js';
import { mainStudy } from '../assets/audio/main-study-timeline.js';
import { breathVolumeAt, demoCsv, ecgPacket, elapsedRun, sceneBreathingAt } from '../simulation.js';

const manifest = JSON.parse(readFileSync(new URL('../assets/ecg/mock-ecg.json', import.meta.url)));
const bytes = readFileSync(new URL('../assets/ecg/mock-ecg.f32', import.meta.url));
const samples = Float32Array.from({ length: manifest.samples }, (_, index) => bytes.readFloatLE(index * 4));
const rate = manifest.settings.sampling_rate;

test('the NeuroKit ECG matches its pinned manifest and replays deterministically', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.equal(samples.length, rate * manifest.settings.duration);
  assert.ok(samples.every(Number.isFinite));
  const first = ecgPacket(samples, rate, 0);
  assert.equal(first.points.length, 260);
  assert.ok(first.points.every(point => Number.isSafeInteger(point.value)));
  assert.ok(new Set(first.points.map(point => point.value)).size > 100);
  assert.deepEqual(first.points.map(point => point.value),
    ecgPacket(samples, rate, manifest.settings.duration * 1000).points.map(point => point.value));
});

test('the fixture produces a visible packet gap in the production ECG renderer', () => {
  const display = new LiveEcgDisplay();
  const now = 2850;
  const packet = ecgPacket(samples, rate, now, true);
  assert.ok(packet.points.length < 260);
  assert.equal(display.push(packet, now), true);
  assert.ok(display.frame(now).path.split('M').length > 2);
  assert.equal(display.frame(now + packet.ttl), null);
});

test('the Quest breathing loop fixture matches the original manifest and WAV bytes', () => {
  const upstream = readFileSync(new URL('../assets/audio/box-loop.json', import.meta.url));
  assert.equal(createHash('sha256').update(upstream).digest('hex'),
    'b50ce8853b9d097b904cc90043e580a75ce17662e1ff2c985bb08b7df45a9ece');
  for (const { cue } of JSON.parse(upstream).phases) {
    const wav = readFileSync(new URL(`../${cue.path}`, import.meta.url));
    assert.equal(wav.length, cue.bytes);
    assert.equal(createHash('sha256').update(wav).digest('hex'), cue.sha256);
  }
});

test('the mixed inhale and exhale cues match the main project audio bytes', () => {
  const mixes = {
    inhale: 'b68c51bf393d6974e304ad52838020c4d02ea4396af779e527d28b1dc72a7281',
    exhale: '3a8650778a528656a4a1cc4f601d43236606eaa750f8b294f43a23bbd0aa31f8',
  };
  for (const [phase, hash] of Object.entries(mixes)) {
    const wav = readFileSync(new URL(`../assets/audio/box-breathing/de/soft-v2/${phase}_breath.wav`, import.meta.url));
    assert.equal(createHash('sha256').update(wav).digest('hex'), hash);
  }
});

test('the preview audio matches the catalog of all 18 main-study takes', () => {
  const catalog = JSON.parse(readFileSync(new URL('../assets/audio/main-study-cues.json', import.meta.url)));
  const bank = readFileSync(new URL('../assets/audio/main-study-cues.flac', import.meta.url));
  assert.equal(createHash('sha256').update(bank).digest('hex'), catalog.sha256);
  assert.equal(catalog.cue_seconds, 4);
  const takes = Object.values(catalog.pools).flat();
  assert.equal(new Set(takes.map(take => take.id)).size, 18);
  assert.deepEqual(Object.values(catalog.pools).map(pool => pool.length), [7, 9, 2]);
  assert.deepEqual(takes.map(take => take.offset), Array.from({ length: 18 }, (_, i) => i * 4));
});

test('Haupt-Runde guides breathing for exactly ten minutes and returns to free breathing on an exhale', () => {
  const { opening, sampleRate, cycleStartFrame, cycles, closing, durationFrames, sha256 } = mainStudy;
  assert.deepEqual(opening.map(cue => cue.id), [
    'atem-lauschen-augen-geschlossen', 'atem-lauschen-augen-offen', 'main-study-instructions',
  ]);
  let nextFrame = 0;
  for (const cue of opening) {
    assert.equal(cue.startFrame, nextFrame);
    nextFrame += cue.frames;
  }
  assert.equal(nextFrame, cycleStartFrame);
  assert.equal(opening[2].frames, 1998720);
  assert.equal(sceneBreathingAt(163000, 'haupt-15').phase, 'natural');
  assert.equal(sceneBreathingAt(165000, 'haupt-15').phase, 'inhale');
  assert.equal(cycles, 37);
  assert.equal(closing.startFrame - cycleStartFrame, 600 * sampleRate);
  const endMs = closing.startFrame * 1000 / sampleRate;
  assert.equal(sceneBreathingAt(endMs - 9000, 'haupt-15').phase, 'hold');
  assert.equal(sceneBreathingAt(endMs - 6000, 'haupt-15').phase, 'inhale');
  assert.equal(sceneBreathingAt(endMs - 2000, 'haupt-15').phase, 'exhale');
  assert.equal(sceneBreathingAt(endMs, 'haupt-15').phase, 'natural');
  assert.ok(sceneBreathingAt(endMs - 500, 'haupt-15').radiusM < sceneBreathingAt(endMs - 3500, 'haupt-15').radiusM);
  assert.ok(closing.startFrame + closing.frames < durationFrames);
  assert.equal(durationFrames, 900 * sampleRate);
  const narration = readFileSync(new URL('../assets/audio/main-study-narration.flac', import.meta.url));
  assert.equal(createHash('sha256').update(narration).digest('hex'), sha256);
});

test('box cue, accelerated run clock and mock download stay deterministic', () => {
  assert.deepEqual([0, 2000, 4000, 8000, 10000, 12000, 16000].map(breathVolumeAt), [0, .5, 1, 1, .5, 0, 0]);
  const run = { duration: 900, elapsed: 24, speed: 60, started: 1000 };
  assert.equal(elapsedRun(run, 2000), 84);
  assert.equal(elapsedRun(run, 100000), 900);
  assert.equal(elapsedRun({ ...run, started: null }, 100000), 24);
  const csv = demoCsv(samples, rate);
  assert.match(csv, /^source,sample_index,time_s,ecg_mock_uv\nmock-neurokit2,0,0\.000000,-?\d+/);
  assert.equal(csv.trim().split('\n').length, rate * 5 + 1);
});
