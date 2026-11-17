async function fetchAudioAsset(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response;
}

async function loadBreathingLoop(context) {
  const plan = await (await fetchAudioAsset('./assets/audio/box-loop.json')).json();
  const rate = context.sampleRate;
  const samples = await Promise.all(plan.phases.map(async ({ cue }) => {
    const bytes = await (await fetchAudioAsset(cue.path)).arrayBuffer();
    return context.decodeAudioData(bytes);
  }));
  const buffer = context.createBuffer(1, plan.cycle_frames * rate / plan.sample_rate, rate);
  plan.phases.forEach(({ offset_frames, duration_frames }, i) => {
    if (samples[i].length !== duration_frames * rate / plan.sample_rate) throw new Error('Unexpected breathing cue length');
    buffer.copyToChannel(samples[i].getChannelData(0), 0, offset_frames * rate / plan.sample_rate);
  });
  return buffer;
}

export function mountBreathingAudio(readPlayback) {
  let context, buffer, source, playingKey, loading, failed;

  function stop() {
    if (!source) return;
    source.stop();
    source.disconnect();
    source = undefined;
  }

  function audioFailed(error) {
    failed = true;
    console.warn('Playground breathing audio unavailable.', error);
  }

  function update() {
    const playback = document.hidden ? null : readPlayback();
    if (!playback || context?.state !== 'running') { stop(); return; }
    if (!buffer) {
      if (!loading && !failed) {
        loading = loadBreathingLoop(context).then(loop => { buffer = loop; update(); })
          .catch(audioFailed).finally(() => { loading = undefined; });
      }
      return;
    }
    if (source && playingKey === playback.key) return;
    stop();
    source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(context.destination);
    source.start(0, playback.seconds % buffer.duration);
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
