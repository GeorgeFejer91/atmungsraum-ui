import { mainStudy } from './assets/audio/main-study-timeline.js?v=matched-controls';

export const ecgRate = 130;
const packetLength = ecgRate * 2;
const clockHz = 1_000_000_000;
const scenePhases = ['inhale', 'hold', 'exhale', 'hold'];

export function ecgPacket(samples, sourceRate, timeMs, gaps = false) {
  const last = Math.floor(timeMs * ecgRate / 1000);
  const points = [];
  for (let i = last - packetLength + 1; i <= last; i++) {
    const slot = ((i % (4 * ecgRate)) + 4 * ecgRate) % (4 * ecgRate);
    if (gaps && slot >= ecgRate && slot < 1.4 * ecgRate) continue;
    const source = 2 * sourceRate + i * sourceRate / ecgRate;
    const first = Math.floor(source) % samples.length;
    const fraction = source - Math.floor(source);
    const next = (first + 1) % samples.length;
    points.push({
      timestamp: BigInt(clockHz * 4 + Math.round(i * clockHz / ecgRate)),
      value: Math.round(1000 * (samples[first] + fraction * (samples[next] - samples[first]))),
      gap: false,
    });
  }
  return { points, ttl: 1600 };
}

export function breathVolumeAt(timeMs) {
  const phaseTime = Math.max(0, timeMs) % 16000;
  if (phaseTime < 4000) return phaseTime / 4000;
  if (phaseTime < 8000) return 1;
  if (phaseTime < 12000) return 1 - (phaseTime - 8000) / 4000;
  return 0;
}

export function breathPhaseSlot(phase, completeCycles = Infinity) {
  // The final eight seconds are one inhale and one exhale.
  return phase === completeCycles * 4 + 1 ? 2 : phase % 4;
}

export function sceneBreathingAt(timeMs, scenario) {
  let completeCycles;
  if (scenario === 'haupt-15') {
    const cycleStart = mainStudy.cycleStartFrame * 1000 / mainStudy.sampleRate;
    const closingStart = mainStudy.closing.startFrame * 1000 / mainStudy.sampleRate;
    if (timeMs < cycleStart || timeMs >= closingStart) {
      const naturalTime = timeMs < cycleStart ? timeMs - cycleStart : timeMs - closingStart;
      return { phase: 'natural', radiusM: 1 + (1 - Math.cos(2 * Math.PI * naturalTime / 12000)) / 2 };
    }
    timeMs -= cycleStart;
    completeCycles = mainStudy.cycles;
  }
  const slot = breathPhaseSlot(Math.floor(timeMs / 4000), completeCycles);
  const volume = (1 - Math.cos(Math.PI * breathVolumeAt(slot * 4000 + timeMs % 4000))) / 2;
  return { phase: scenePhases[slot], radiusM: 1 + volume };
}

export const runLengths = {
  'probe-5': 300,
  'free-exploration': Infinity,
  'haupt-15': mainStudy.durationFrames / mainStudy.sampleRate,
};
export const mainStudyOutroSeconds = mainStudy.closing.frames / mainStudy.sampleRate;

export function elapsedRun(run, now) {
  return Math.min(run.duration, run.elapsed + (run.started === null ? 0 : Math.max(0, now - run.started) * run.speed / 1000));
}

export function demoCsv(samples, rate, seconds = 5) {
  const rows = ['source,sample_index,time_s,ecg_mock_uv'];
  for (let index = 0; index < rate * seconds; index++) {
    rows.push(['mock-neurokit2', index, (index / rate).toFixed(6), Math.round(samples[index % samples.length] * 1000)].join(','));
  }
  return rows.join('\n') + '\n';
}
