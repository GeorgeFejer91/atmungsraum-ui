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
const cueBytes = cueFrames * 2;
const voicePeak = 32768 * 10 ** (-8 / 20);
const pcm = [];
const pools = {};

function wavePcm(wav, frames = cueFrames) {
  if (wav.length !== frames * 2 + 44 || wav.toString('ascii', 36, 40) !== 'data'
    || wav.readUInt32LE(24) !== rate || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16) {
    throw new Error('Expected a four-second mono PCM cue');
  }
  return wav.subarray(44);
}

for (const [phase, takes] of Object.entries(inventory.pools)) {
  const originalCue = name => readFile(new URL(`box-breathing/de/soft-v2/${name}.wav`, audioRoot)).then(wavePcm);
  const [dry, mixed] = phase === 'hold' ? [] : await Promise.all([originalCue(phase), originalCue(`${phase}_breath`)]);
  pools[phase] = takes.map(id => {
    const staged = plan.audio_assets[id];
    const voice = wavePcm(files.get('assets/audio/scenarios/haupt-15/' + staged.file));
    let peak = 0;
    for (let i = 0; i < cueBytes; i += 2) peak = Math.max(peak, Math.abs(voice.readInt16LE(i)));
    if (!peak) throw new Error('Silent voice cue: ' + id);
    const cue = Buffer.alloc(cueBytes);
    for (let i = 0; i < cueBytes; i += 2) {
      const breath = mixed ? mixed.readInt16LE(i) - dry.readInt16LE(i) : 0;
      const sample = Math.round(voice.readInt16LE(i) * voicePeak / peak + breath);
      if (Math.abs(sample) > 32767) throw new Error('Cue clips: ' + id);
      cue.writeInt16LE(sample, i);
    }
    const offset = pcm.length * cueSeconds;
    pcm.push(cue);
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

// Cuts are in source milliseconds, with eyes closed first and eyes open second.
const listeningBreaks = [
  { after: [14100, 12140], resumeAt: 28000 }, // Settle into natural breathing and listen.
  { after: [25580, 25320], resumeAt: 57000 }, // Notice the sound of inhaling and exhaling.
  { after: [44950, 49850], resumeAt: 93000 }, // Return attention after thoughts wander.
];

function extendControl(samples, control, frames) {
  const clips = [];
  let lastFrame = 0;
  let addedFrames = 0;
  for (const { after, resumeAt } of listeningBreaks) {
    const cut = rate * after[control] / 1000;
    const silence = rate * resumeAt / 1000 - cut - addedFrames;
    const margin = rate / 50;
    if (cut <= lastFrame || cut + margin >= samples.length / 2 || silence <= 0) {
      throw new Error('Invalid listening break');
    }
    for (let frame = cut - margin; frame < cut + margin; frame++) {
      if (Math.abs(samples.readInt16LE(frame * 2)) > 128) throw new Error('Listening break overlaps audible source audio');
    }
    clips.push(samples.subarray(lastFrame * 2, cut * 2), Buffer.alloc(silence * 2));
    addedFrames += silence;
    lastFrame = cut;
  }
  const finalPause = frames - samples.length / 2 - addedFrames;
  if (finalPause <= 0) throw new Error('No time remains for the final listening prompt');
  clips.push(samples.subarray(lastFrame * 2), Buffer.alloc(finalPause * 2));
  return Buffer.concat(clips);
}

const instructionId = 'main-study-instructions';
const instructionFile = fileURLToPath(new URL(instructionId + '.mp3', audioRoot));
const instructions = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', instructionFile,
  '-ar', String(rate), '-ac', '1', '-f', 's16le', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
const cycleStartFrame = 5 * 60 * rate;
const controlFrames = (cycleStartFrame - instructions.length / 2) / 2;
if (!Number.isSafeInteger(controlFrames) || controlFrames <= 0) throw new Error('Controls require equal whole-frame lengths');
const opening = inventory.opening.slice(0, 2).map((id, i) => ({
  id, startFrame: i * controlFrames, frames: controlFrames, offsetFrame: i * controlFrames,
}));
const narration = opening.map(({ id }, i) => {
  const asset = plan.audio_assets[id];
  const samples = wavePcm(files.get('assets/audio/scenarios/haupt-15/' + asset.file), asset.frames);
  return extendControl(samples, i, controlFrames);
});
const instructionStart = 2 * controlFrames;
opening.push({ id: instructionId, startFrame: instructionStart, frames: instructions.length / 2, offsetFrame: instructionStart });
narration.push(instructions);
const guidedFrames = 10 * 60 * rate;
const cycles = Math.floor(guidedFrames / (4 * cueFrames));
const closingStartFrame = cycleStartFrame + guidedFrames;
const outroDirectory = join(sourceRoot, 'assets/audio/box-breathing/de/soft-v2');
const outro = JSON.parse(await readFile(join(outroDirectory, 'outro.json')));
const outroWav = await readFile(join(outroDirectory, outro.file));
if (createHash('sha256').update(outroWav).digest('hex') !== outro.sha256
  || closingStartFrame !== plan.total_frames) {
  throw new Error('Unexpected main-study outro asset');
}
narration.push(wavePcm(outroWav, outro.frames));
const closing = { id: 'outro', startFrame: closingStartFrame, frames: outro.frames, offsetFrame: cycleStartFrame };
const timeline = { sampleRate: rate, durationFrames: plan.total_frames, opening, cycleStartFrame, cycles, closing,
  sha256: await writeFlac('main-study-narration.flac', narration) };
await writeFile(new URL('main-study-timeline.js', audioRoot), `export const mainStudy = ${JSON.stringify(timeline, null, 2)};\n`);
console.log(`Built ${opening.length} opening clips, ${pcm.length} phase cues and the outro for ten minutes of guided breathing.`);
