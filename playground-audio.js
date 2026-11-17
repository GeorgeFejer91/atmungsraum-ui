import { mainStudy } from './assets/audio/main-study-timeline.js?v=study-instructions';

export function playCalibrationPrelude(media, signal) {
  return new Promise(resolve => {
    let settled = false;
    function finish(played) {
      if (settled) return;
      settled = true;
      media.removeEventListener('ended', ended);
      media.removeEventListener('error', cancel);
      signal.removeEventListener('abort', cancel);
      if (!played) media.pause();
      resolve(played);
    }
    const ended = () => finish(true);
    const cancel = () => finish(false);
    if (signal.aborted) { cancel(); return; }
    media.addEventListener('ended', ended);
    media.addEventListener('error', cancel);
    signal.addEventListener('abort', cancel);
    if (media.error) media.load();
    if (media.currentTime) media.currentTime = 0;
    void media.play().catch(cancel);
  });
}

async function fetchAudioAsset(path) {
  const response = await fetch(new URL(path, import.meta.url), { signal: AbortSignal.timeout(45000) });
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
const rate = mainStudy.sampleRate;

async function loadNarration(context) {
  const bytes = await (await fetchAudioAsset('./assets/audio/main-study-narration.flac?v=' + mainStudy.sha256)).arrayBuffer();
  const buffer = await context.decodeAudioData(bytes);
  if (buffer.duration !== (mainStudy.cycleStartFrame + mainStudy.closing.frames) / rate) {
    throw new Error('Unexpected main-study narration length');
  }
  return buffer;
}

function cueAt(cues, narration, frame) {
  const cycleStart = narration ? mainStudy.cycleStartFrame : 0;
  if (narration && frame < cycleStart) {
    const cue = mainStudy.opening.find(item => frame < item.startFrame + item.frames);
    return { ...cue, buffer: narration };
  }
  if (narration && frame >= mainStudy.closing.startFrame) {
    return frame < mainStudy.durationFrames ? { ...mainStudy.closing, buffer: narration } : null;
  }
  const frames = cues.plan.cue_seconds * rate;
  const phase = Math.floor((frame - cycleStart) / frames);
  const cycle = Math.floor(phase / phasePools.length);
  const slot = phase % phasePools.length;
  const pool = cues.plan.pools[phasePools[slot]];
  const cue = pool[(cycle + Number(slot === 3)) % pool.length];
  return { startFrame: cycleStart + phase * frames, frames, offsetFrame: cue.offset * rate, buffer: cues.buffer };
}

function playCues(context, cues, narration, playback) {
  const origin = context.currentTime - playback.seconds;
  let nextFrame = 0;
  const sources = new Set();

  function schedule() {
    const now = context.currentTime;
    const cue = cueAt(cues, narration, Math.max(nextFrame, Math.floor((now - origin) * rate)));
    if (!cue) return;
    const boundary = origin + cue.startFrame / rate;
    if (boundary > now + 0.5) return;
    nextFrame = cue.startFrame + cue.frames;
    const start = Math.max(now, boundary);
    const elapsed = start - boundary;
    const remaining = cue.frames / rate - elapsed;
    if (remaining <= 0) return;
    const source = context.createBufferSource();
    source.buffer = cue.buffer;
    source.connect(context.destination);
    source.onended = () => { sources.delete(source); source.disconnect(); };
    sources.add(source);
    source.start(start, cue.offsetFrame / rate + elapsed, remaining);
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
  let context, cues, narration, stopPlayback, playingKey, cueLoading, narrationLoading, failed;

  function stop() {
    stopPlayback?.();
    stopPlayback = undefined;
  }

  function audioFailed(error) {
    failed = true;
    console.warn('Playground breathing audio unavailable.', error);
  }

  function prepareCues() {
    return cueLoading ??= loadBreathingCues(context).then(bank => { cues = bank; })
      .catch(error => { cueLoading = undefined; throw error; });
  }

  async function prepareMainStudy(signal) {
    if (signal.aborted) return false;
    if (!context) return true;
    narrationLoading ??= loadNarration(context).then(bank => { narration = bank; })
      .catch(error => { narrationLoading = undefined; throw error; });
    let cancel;
    const interrupted = new Promise(resolve => {
      cancel = () => resolve(false);
      signal.addEventListener('abort', cancel, { once: true });
    });
    try {
      const ready = Promise.all([prepareCues(), narrationLoading]).then(() => true);
      return await Promise.race([ready, interrupted]);
    } catch (error) {
      audioFailed(error);
      return false;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  function update() {
    const playback = document.hidden ? null : readPlayback();
    if (!playback || context?.state !== 'running') { stop(); return; }
    if (!cues) {
      if (!cueLoading && !failed) void prepareCues().then(update).catch(audioFailed);
      return;
    }
    if (playback.mainStudy && !narration) return;
    if (stopPlayback && playingKey === playback.key) return;
    stop();
    stopPlayback = playCues(context, cues, playback.mainStudy ? narration : null, playback);
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
  return { unlock, update, prepareMainStudy };
}
