import { mainStudy } from './assets/audio/main-study-timeline.js?v=matched-controls';
import { probeStudy } from './assets/audio/probe-timeline.js?v=probe-instructions';
import { freeExploration } from './assets/audio/free-exploration-timeline.js';

export const ecgRate = 130;
export const scenarioTimelines = {
  'haupt-15': mainStudy, 'probe-5': probeStudy, 'free-exploration': freeExploration,
};
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
  const timeline = scenarioTimelines[scenario];
  if (timeline) {
    const cycleStart = timeline.cycleStartFrame * 1000 / timeline.sampleRate;
    const closingStart = timeline.durationFrames * 1000 / timeline.sampleRate;
    if (timeMs < cycleStart || timeMs >= closingStart) {
      const naturalTime = timeMs < cycleStart ? timeMs - cycleStart : timeMs - closingStart;
      return { phase: 'natural', radiusM: 1 + (1 - Math.cos(2 * Math.PI * naturalTime / 12000)) / 2 };
    }
    timeMs -= cycleStart;
    completeCycles = timeline.cycles;
  }
  const slot = breathPhaseSlot(Math.floor(timeMs / 4000), completeCycles);
  const volume = (1 - Math.cos(Math.PI * breathVolumeAt(slot * 4000 + timeMs % 4000))) / 2;
  return { phase: scenePhases[slot], radiusM: 1 + volume };
}

export const runLengths = {
  'probe-5': probeStudy.durationFrames / probeStudy.sampleRate,
  'free-exploration': freeExploration.durationFrames / freeExploration.sampleRate,
  'haupt-15': mainStudy.durationFrames / mainStudy.sampleRate,
};
export const mainStudyOutroSeconds = mainStudy.closing.frames / mainStudy.sampleRate;

export function elapsedRun(run, now) {
  return Math.min(run.duration, run.elapsed + (run.started === null ? 0 : Math.max(0, now - run.started) * run.speed / 1000));
}
