const particleCount = 72;
const frameInterval = Math.ceil(1000 / 24);
const phaseLabels = { inhale: 'Einatmen', hold: 'Halten', exhale: 'Ausatmen', natural: 'Freie Atmung' };

function particleSphere() {
  const step = Math.PI * (3 - Math.sqrt(5));
  const points = Array.from({ length: particleCount }, (_, i) => {
    const y = 1 - 2 * (i + .5) / particleCount;
    const ring = Math.sqrt(1 - y * y);
    return { x: ring * Math.cos(i * step), y, z: ring * Math.sin(i * step),
      phase: i * step, speed: 1.4 + .35 * Math.sin(i) };
  }).sort((a, b) => a.z - b.z);

  for (const point of points) {
    point.neighbors = points.filter(other => other !== point)
      .map(other => ({ other, distance: (point.x - other.x) ** 2 + (point.y - other.y) ** 2 + (point.z - other.z) ** 2 }))
      .sort((a, b) => a.distance - b.distance).slice(0, 3).map(({ other }) => other);
  }
  return points;
}

function advancePhases(points, seconds) {
  for (const point of points) {
    let pull = 0;
    for (const neighbor of point.neighbors) pull += Math.sin(neighbor.phase - point.phase);
    point.nextPhase = point.phase + seconds * (point.speed + pull / point.neighbors.length);
  }
  for (const point of points) point.phase = point.nextPhase;
}

function canvasParticles(canvas) {
  const { width, height } = canvas;
  const pixelsPerMeter = Math.min(width, height) * .22;
  let context, points;

  return {
    draw(progress, seconds) {
      context ??= canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, width, height);
      if (progress === null) return;

      const radius = (1 + progress) * pixelsPerMeter;
      points ??= particleSphere();
      if (seconds) advancePhases(points, seconds);
      context.fillStyle = '#a8ddf7';
      for (const point of points) {
        const depth = (point.z + 1) / 2;
        context.globalAlpha = .2 + depth * .44 + .16 * (1 + Math.sin(point.phase));
        context.beginPath();
        context.arc(width / 2 + point.x * radius, height / 2 + point.y * radius, .75 + depth, 0, 2 * Math.PI);
        context.fill();
      }
    },
  };
}

export function mountSceneParticles(preview, readBreathing) {
  const canvas = preview.querySelector('canvas');
  const caption = preview.querySelector('#scene-breath-phase');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const fallback = canvasParticles(canvas);
  let renderer = fallback;
  let state, timer, lastFrame, drawnProgress;

  function stop() {
    clearInterval(timer);
    timer = undefined;
    lastFrame = undefined;
  }

  function render(now, animate = false) {
    const breath = readBreathing(now);
    const label = breath ? phaseLabels[breath.phase] : 'Kein Atemsignal';
    if (caption.textContent !== label) caption.textContent = label;
    const progress = breath ? (motion.matches ? .5 : Math.max(0, Math.min(1, breath.radiusM - 1))) : null;
    if (!animate && progress === drawnProgress) return Boolean(breath);
    const seconds = animate && lastFrame !== undefined ? Math.min(.06, (now - lastFrame) / 1000) : 0;
    renderer.draw(progress, seconds);
    drawnProgress = progress;
    lastFrame = now;
    return Boolean(breath);
  }

  const localPreview = location.hostname === '127.0.0.1' && navigator.gpu &&
    new URLSearchParams(location.search).get('particle-preview') === 'local';
  let localRequested = false;

  async function loadLocalRenderer() {
    const gpuCanvas = canvas.cloneNode();
    let failed = false;
    function useFallback(error) {
      if (failed) return;
      failed = true;
      console.warn('Local particle preview unavailable:', error.message);
      if (renderer === fallback) return;
      gpuCanvas.replaceWith(canvas);
      renderer = fallback;
      drawnProgress = undefined;
      sync();
    }
    try {
      const { createRenderer } = await import('/local-particles/renderer.mjs');
      const local = await createRenderer(gpuCanvas, useFallback);
      if (failed) return;
      renderer = {
        reset: local.reset,
        draw(progress, seconds) {
          try {
            local.draw(progress, seconds);
          } catch (error) {
            useFallback(error);
            fallback.draw(progress, seconds);
          }
        },
      };
      gpuCanvas.dataset.particleRenderer = 'local';
      canvas.replaceWith(gpuCanvas);
      drawnProgress = undefined;
      if (!preview.hidden && !document.hidden) render(performance.now());
    } catch (error) {
      useFallback(error);
    }
  }

  function sync() {
    const visible = state === 'RUNNING' || state === 'PAUSED';
    if (!visible && !preview.hidden) {
      renderer.reset?.();
      drawnProgress = undefined;
    }
    preview.hidden = !visible;
    if (visible && !document.hidden && localPreview && !localRequested) {
      localRequested = true;
      void loadLocalRenderer();
    }
    const animate = visible && state === 'RUNNING' && !document.hidden && !motion.matches;
    if (!animate) stop();
    if (!visible || document.hidden || timer !== undefined) return;
    if (render(performance.now()) && animate) {
      timer = setInterval(() => { if (!render(performance.now(), true)) stop(); }, frameInterval);
    }
  }

  motion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', stop);
  return { update(next) { state = next; sync(); } };
}
