async function fetchAudioAsset(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response;
}

async function loadBreathingCues(context) {
  const [plan, bytes] = await Promise.all([
    fetchAudioAsset('./assets/audio/main-study-cues.json').then(response => response.json()),
    fetchAudioAsset('./assets/audio/main-study-cues.flac').then(response => response.arrayBuffer()),
  ]);
  const buffer = await context.decodeAudioData(bytes);
  const cueCount = Object.values(plan.pools).reduce((total, pool) => total + pool.length, 0);
  if (buffer.duration !== cueCount * plan.cue_seconds) throw new Error('Unexpected breathing cue bank length');
  return { plan, buffer };
}

const phasePools = ['inhale', 'hold', 'exhale', 'hold'];

function playBreathingCues(context, { plan, buffer }, seconds) {
  const phaseSeconds = plan.cue_seconds;
  const origin = context.currentTime - seconds;
  let phase = Math.floor(seconds / phaseSeconds);
  const sources = new Set();

  function schedule() {
    const now = context.currentTime;
    phase = Math.max(phase, Math.floor((now - origin) / phaseSeconds));
    const boundary = origin + phase * phaseSeconds;
    if (boundary > now + 0.5) return;
    const cycle = Math.floor(phase / phasePools.length);
    const slot = phase % phasePools.length;
    const pool = plan.pools[phasePools[slot]];
    const cue = pool[(cycle + Number(slot === 3)) % pool.length];
    const start = Math.max(now, boundary);
    const elapsed = start - boundary;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => { sources.delete(source); source.disconnect(); };
    sources.add(source);
    source.start(start, cue.offset + elapsed, phaseSeconds - elapsed);
    phase++;
  }

  schedule();
  const timer = setInterval(schedule, 150);
  return () => {
    clearInterval(timer);
    for (const source of sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
  };
}

export function mountBreathingAudio(readPlayback) {
  let context, cues, stopPlayback, playingKey, loading, failed;

  function stop() {
    stopPlayback?.();
    stopPlayback = undefined;
  }

  function audioFailed(error) {
    failed = true;
    console.warn('Playground breathing audio unavailable.', error);
  }

  function update() {
    const playback = document.hidden ? null : readPlayback();
    if (!playback || context?.state !== 'running') { stop(); return; }
    if (!cues) {
      if (!loading && !failed) {
        loading = loadBreathingCues(context).then(loaded => { cues = loaded; update(); })
          .catch(audioFailed).finally(() => { loading = undefined; });
      }
      return;
    }
    if (stopPlayback && playingKey === playback.key) return;
    stop();
    stopPlayback = playBreathingCues(context, cues, playback.seconds);
    playingKey = playback.key;
  }

  function unlock() {
    if (!globalThis.AudioContext) return;
    if (!context) {
      context = new AudioContext();
      context.addEventListener('statechange', update);
    }
    failed = false;
    void context.resume().then(update).catch(audioFailed);
  }

  document.addEventListener('visibilitychange', update);
  window.addEventListener('pagehide', stop);
  return { unlock, update };
}
