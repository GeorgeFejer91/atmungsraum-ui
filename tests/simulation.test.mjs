import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LiveEcgDisplay } from '../live-ecg-display.js';
import { mainStudy } from '../assets/audio/main-study-timeline.js';
import { breathVolumeAt, ecgPacket, elapsedRun, sceneBreathingAt } from '../simulation.js';
import { createMockRecordings } from '../mock-recordings.js';
import { completedMainQuestionnaire } from '../vendor/atmungsraum/data-logging.js';

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
    '4bae0727c67637d2cf49d93e4bf4295406ded4550c31148f9deeda55c9417cc8');
  for (const { cue } of JSON.parse(upstream).phases) {
    const wav = readFileSync(new URL(`../${cue.path}`, import.meta.url));
    assert.equal(wav.length, cue.bytes);
    assert.equal(createHash('sha256').update(wav).digest('hex'), cue.sha256);
  }
});

test('the mixed inhale and exhale cues match the main project audio bytes', () => {
  const mixes = {
    inhale: '203fecc48da9d940f9c492255067e01f620de5a1d1399e70816fdf05641188e3',
    exhale: '9667387cb026264c8a2b041fa6de11cf25ef6304c1fa4b07ef86f688cd33a720',
  };
  for (const [phase, hash] of Object.entries(mixes)) {
    const wav = readFileSync(new URL(`../assets/audio/box-breathing/de/soft-v2/${phase}_breath.wav`, import.meta.url));
    assert.equal(createHash('sha256').update(wav).digest('hex'), hash);
  }
});

test('the preview audio matches the catalog of the three canonical Zen cues', () => {
  const catalog = JSON.parse(readFileSync(new URL('../assets/audio/main-study-cues.json', import.meta.url)));
  const bank = readFileSync(new URL('../assets/audio/main-study-cues.flac', import.meta.url));
  assert.equal(createHash('sha256').update(bank).digest('hex'), catalog.sha256);
  assert.equal(catalog.cue_seconds, 4);
  const takes = Object.values(catalog.pools).flat();
  assert.deepEqual(takes.map(take => take.id), ['zen-inhale', 'zen-exhale', 'zen-hold']);
  assert.deepEqual(Object.values(catalog.pools).map(pool => pool.length), [1, 1, 1]);
  assert.deepEqual(takes.map(take => take.offset), [0, 4, 8]);
});

test('Haupt-Runde matches control durations and switches from opening to ten minutes of guided breathing', () => {
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
  assert.equal(opening[0].frames, opening[1].frames);
  assert.equal(cycleStartFrame, 300 * sampleRate);
  assert.equal(sceneBreathingAt(299999, 'haupt-15').phase, 'natural');
  assert.equal(sceneBreathingAt(300000, 'haupt-15').phase, 'inhale');
  assert.equal(cycles, 37);
  assert.equal(closing.startFrame - cycleStartFrame, 600 * sampleRate);
  const endMs = closing.startFrame * 1000 / sampleRate;
  assert.equal(sceneBreathingAt(endMs - 9000, 'haupt-15').phase, 'hold');
  assert.equal(sceneBreathingAt(endMs - 6000, 'haupt-15').phase, 'inhale');
  assert.equal(sceneBreathingAt(endMs - 2000, 'haupt-15').phase, 'exhale');
  assert.equal(sceneBreathingAt(endMs, 'haupt-15').phase, 'natural');
  assert.ok(sceneBreathingAt(endMs - 500, 'haupt-15').radiusM < sceneBreathingAt(endMs - 3500, 'haupt-15').radiusM);
  assert.equal(closing.startFrame, durationFrames);
  assert.ok(closing.frames > 0);
  assert.equal(durationFrames, 900 * sampleRate);
  const narration = readFileSync(new URL('../assets/audio/main-study-narration.flac', import.meta.url));
  assert.equal(createHash('sha256').update(narration).digest('hex'), sha256);
});

test('box cue and accelerated run clock stay deterministic', () => {
  assert.deepEqual([0, 2000, 4000, 8000, 10000, 12000, 16000].map(breathVolumeAt), [0, .5, 1, 1, .5, 0, 0]);
  const run = { duration: 900, elapsed: 24, speed: 60, started: 1000 };
  assert.equal(elapsedRun(run, 2000), 84);
  assert.equal(elapsedRun(run, 100000), 900);
  assert.equal(elapsedRun({ ...run, started: null }, 100000), 24);
});

test('the mock publishes a questionnaire-eligible CSV only at natural main completion', async () => {
  const recordings = createMockRecordings({ device: 'fixture', serial: 'fixture' },
    { samples, rate: 8, prepare: async () => {} });
  for (const [scenario, seconds, completed] of [
    ['haupt-15', 90, false], ['probe-5', 318, true], ['haupt-15', 900, true],
  ]) {
    await recordings.begin(scenario, 'condition-a');
    const prefix = await recordings.read({ query: 'live-describe' }, 4);
    await recordings.finish(seconds, completed);
    const { manifest } = await recordings.read({ query: 'describe', id: prefix.id });
    const csv = manifest.participant_csv;
    const { data } = await recordings.read({ query: 'read', manifest_id: manifest.manifest_id, file: csv.name,
      offset: csv.size - 512, length: 512 });
    const tail = Buffer.from(data, 'base64');
    assert.equal(csv.session_id, prefix.session_id);
    assert.equal(tail.toString().trimEnd().split('\n').at(-1).split(',')[21], completed ? 'completed' : 'aborted');
    const questionnaire = completedMainQuestionnaire(csv, tail);
    if (scenario === 'haupt-15' && completed) {
      assert.deepEqual(questionnaire, { participant_id: 'Dem_30_O', session_id: csv.session_id, recording_filename: csv.name });
    } else assert.equal(questionnaire, null);
  }
});
