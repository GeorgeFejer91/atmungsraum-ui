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

function wavePcm(wav) {
  if (wav.length !== cueBytes + 44 || wav.toString('ascii', 36, 40) !== 'data'
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

const asset = new URL('main-study-cues.flac', audioRoot);
execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0',
  '-map_metadata', '-1', '-flags:a', '+bitexact', '-y', fileURLToPath(asset)], { input: Buffer.concat(pcm), windowsHide: true });
const audio = await readFile(asset);
const sha256 = createHash('sha256').update(audio).digest('hex');
await writeFile(new URL('main-study-cues.json', audioRoot), JSON.stringify({ cue_seconds: cueSeconds, sha256, pools }, null, 2) + '\n');
console.log(`Mixed ${pcm.length} cues into ${audio.length} bytes`);
