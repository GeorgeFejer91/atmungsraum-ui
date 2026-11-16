export const ecgRate = 130;
const packetLength = ecgRate * 2;
const clockHz = 1_000_000_000;

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

export const runLengths = {
  'probe-anleitung': 68,
  'probe-5': 300,
  'probe-10': 600,
  'probe-15': 900,
  'haupt-15': 900,
  'box-20': 1200,
};

export function elapsedRun(run, now) {
  return Math.min(run.duration, run.elapsed + (run.started === null ? 0 : Math.max(0, now - run.started) * run.speed / 1000));
}

export function demoCsv(samples, rate) {
  const rows = ['source,sample_index,time_s,ecg_mock_uv'];
  for (let index = 0; index < rate * 5; index++) {
    rows.push(['mock-neurokit2', index, (index / rate).toFixed(6), Math.round(samples[index] * 1000)].join(','));
  }
  return rows.join('\n') + '\n';
}
