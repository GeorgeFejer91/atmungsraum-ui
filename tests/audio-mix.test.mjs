import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scenarioBackground, cueVolume, readAudioMix, saveAudioMix } from '../audio-mix.js';

test('only actual non-exploration rounds use the looping background track', () => {
  assert.equal(scenarioBackground('probe-5'), true);
  assert.equal(scenarioBackground('haupt-15'), true);
  assert.equal(scenarioBackground('free-exploration'), false);
  assert.equal(scenarioBackground(undefined), false);
  assert.equal(cueVolume('free-exploration-music'), 'music');
  assert.equal(cueVolume('free-exploration-instructions'), 'instructions');
});

test('audio preferences preserve mute and restore defaults for invalid values', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.deepEqual(readAudioMix(storage), { music: 30, instructions: 90 });
  saveAudioMix(storage, { music: 0, instructions: 72 });
  assert.deepEqual(readAudioMix(storage), { music: 0, instructions: 72 });
  saveAudioMix(storage, { music: 101, instructions: null });
  assert.deepEqual(readAudioMix(storage), { music: 30, instructions: 90 });
});
