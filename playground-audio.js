import { breathPhaseSlot, scenarioTimelines } from './simulation.js?v=free-exploration-audio';

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
  const plan = await (await fetchAudioAsset('./assets/audio/main-study-cues.json?v=zen')).json();
  const bytes = await (await fetchAudioAsset('./assets/audio/main-study-cues.flac?v=' + plan.sha256)).arrayBuffer();
  const buffer = await context.decodeAudioData(bytes);
  const cueCount = Object.values(plan.pools).reduce((total, pool) => total + pool.length, 0);
  if (buffer.duration !== cueCount * plan.cue_seconds) throw new Error('Unexpected breathing cue bank length');
  return { plan, buffer };
}

const phasePools = ['inhale', 'hold', 'exhale', 'hold'];
const rate = scenarioTimelines['haupt-15'].sampleRate;
const trackFiles = {
  'haupt-15': 'main-study-narration.flac',
  'probe-5': 'probe-narration.flac',
  'free-exploration': 'free-exploration.mp3',
};

function needsBreathingCues(scenario) {
  const timeline = scenarioTimelines[scenario];
  return !timeline || timeline.cycleStartFrame < timeline.durationFrames;
}

async function loadScenarioTrack(context, scenario) {
  const timeline = scenarioTimelines[scenario];
  const file = trackFiles[scenario];
  const path = './assets/audio/' + file + '?v=' + timeline.sha256;
  const bytes = await (await fetchAudioAsset(path)).arrayBuffer();
  const buffer = await context.decodeAudioData(bytes);
  const expectedDuration = (timeline.cycleStartFrame + (timeline.closing?.frames ?? 0)) / rate;
  const padding = file.endsWith('.mp3') ? 0.05 : 1 / buffer.sampleRate;
  if (Math.abs(buffer.duration - expectedDuration) > padding) {
    throw new Error('Unexpected scenario audio length');
  }
  return buffer;
}

function cueAt(cues, track, timeline, frame) {
  const cycleStart = timeline?.cycleStartFrame ?? 0;
  if (frame < cycleStart) {
    const cue = timeline.opening.find(item => frame < item.startFrame + item.frames);
    return { ...cue, buffer: track };
  }
  if (timeline && frame >= timeline.durationFrames) {
    const closing = timeline.closing;
    return closing && frame < closing.startFrame + closing.frames ? { ...closing, buffer: track } : null;
  }
  const frames = cues.plan.cue_seconds * rate;
  const phase = Math.floor((frame - cycleStart) / frames);
  const slot = breathPhaseSlot(phase, timeline?.cycles);
  const [cue] = cues.plan.pools[phasePools[slot]];
  return { startFrame: cycleStart + phase * frames, frames, offsetFrame: cue.offset * rate, buffer: cues.buffer };
}

function playCues(context, cues, track, playback) {
  const timeline = scenarioTimelines[playback.scenario];
  const origin = context.currentTime - playback.seconds;
  let nextFrame = 0;
  const sources = new Set();

  function schedule() {
    const now = context.currentTime;
    const cue = cueAt(cues, track, timeline, Math.max(nextFrame, Math.floor((now - origin) * rate)));
    if (!cue) { clearInterval(timer); return; }
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

  const timer = setInterval(schedule, 150);
  schedule();
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
  let context, cues, stopPlayback, playingKey, cueLoading, failed;
  const tracks = new Map();
  const trackLoads = new Map();

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

  async function prepareScenario(scenario, signal) {
    if (signal.aborted) return false;
    if (!context) return true;
    if (!trackLoads.has(scenario)) {
      trackLoads.set(scenario, loadScenarioTrack(context, scenario)
        .then(track => { tracks.set(scenario, track); })
        .catch(error => { trackLoads.delete(scenario); throw error; }));
    }
    let cancel;
    const interrupted = new Promise(resolve => {
      cancel = () => resolve(false);
      signal.addEventListener('abort', cancel, { once: true });
    });
    try {
      const ready = Promise.all([
        needsBreathingCues(scenario) ? prepareCues() : null, trackLoads.get(scenario),
      ]).then(() => true);
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
    if (!cues && needsBreathingCues(playback.scenario)) {
      if (!cueLoading && !failed) void prepareCues().then(update).catch(audioFailed);
      return;
    }
    const track = tracks.get(playback.scenario);
    if (playback.scenario && !track) return;
    if (stopPlayback && playingKey === playback.key) return;
    stop();
    stopPlayback = playCues(context, cues, track, playback);
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
  return { unlock, update, prepareScenario };
}
