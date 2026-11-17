import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [source] = process.argv.slice(2);
if (!source) throw new Error('Usage: node tools/build-preview-audio.mjs <main project atmungsraum directory>');

const sourceRoot = resolve(source);
const { buildMainStudyScenario, loadStudyInventory } = await import(pathToFileURL(join(sourceRoot, 'quest/main-study-audio.mjs')));
const inventory = await loadStudyInventory(sourceRoot);
const original = JSON.parse(await readFile(join(sourceRoot, 'audio/scenarios/haupt-15.json')));
const { plan, files } = await buildMainStudyScenario(sourceRoot, original);
const audioRoot = new URL('../assets/audio/', import.meta.url);
const rate = plan.sample_rate;
const cueSeconds = 4;
const cueFrames = rate * cueSeconds;
const studyAssets = 'assets/audio/scenarios/' + plan.scenario_id + '/';

function wavePcm(wav, frames) {
  if (wav.length !== frames * 2 + 44 || wav.toString('ascii', 36, 40) !== 'data'
    || wav.readUInt32LE(24) !== rate || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16) {
    throw new Error('Unexpected staged mono PCM cue');
  }
  return wav.subarray(44);
}

function stagedCue(id, frames) {
  return wavePcm(files.get(studyAssets + plan.audio_assets[id].file), frames);
}

const pcm = [];
const pools = {};
for (const [phase, takes] of Object.entries(inventory.pools)) {
  pools[phase] = takes.map(id => {
    const offset = pcm.length * cueSeconds;
    pcm.push(stagedCue(id, cueFrames));
    return { id, offset };
  });
}

async function writeFlac(name, samples) {
  const asset = new URL(name, audioRoot);
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0',
    '-map_metadata', '-1', '-flags:a', '+bitexact', '-y', fileURLToPath(asset)],
  { input: Buffer.concat(samples), windowsHide: true });
  return createHash('sha256').update(await readFile(asset)).digest('hex');
}

const sha256 = await writeFlac('main-study-cues.flac', pcm);
await writeFile(new URL('main-study-cues.json', audioRoot), JSON.stringify({ cue_seconds: cueSeconds, sha256, pools }, null, 2) + '\n');

const opening = plan.events.slice(0, 3).map(event => ({
  id: event.asset, startFrame: event.offset_frames, frames: event.duration_frames, offsetFrame: event.offset_frames,
}));
const narration = opening.map(cue => stagedCue(cue.id, cue.frames));
const cycleStartFrame = plan.events[3].offset_frames;
const outro = plan.post_session_audio;
narration.push(wavePcm(files.get(outro.path), outro.duration_frames));
const closing = { id: 'outro', startFrame: outro.offset_frames, frames: outro.duration_frames, offsetFrame: cycleStartFrame };
const cycles = plan.cycles;
const timeline = { sampleRate: rate, durationFrames: plan.total_frames, opening, cycleStartFrame, cycles, closing,
  sha256: await writeFlac('main-study-narration.flac', narration) };
await writeFile(new URL('main-study-timeline.js', audioRoot), `export const mainStudy = ${JSON.stringify(timeline, null, 2)};\n`);
console.log(`Built ${opening.length} opening clips, ${pcm.length} phase cues and the outro for ten minutes of guided breathing.`);
