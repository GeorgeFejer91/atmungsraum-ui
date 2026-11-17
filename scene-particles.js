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

export function mountSceneParticles(preview, readBreathing) {
  const canvas = preview.querySelector('canvas');
  const caption = preview.querySelector('#scene-breath-phase');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const { width, height } = canvas;
  const pixelsPerMeter = Math.min(width, height) * .22;
  let state, timer, lastFrame, context, points, drawnRadius;

  function stop() {
    clearInterval(timer);
    timer = undefined;
    lastFrame = undefined;
  }

  function render(now, animate = false) {
    const breath = readBreathing(now);
    const label = breath ? phaseLabels[breath.phase] : 'Kein Atemsignal';
    if (caption.textContent !== label) caption.textContent = label;
    const radius = breath ? (motion.matches ? 1.5 : breath.radiusM) * pixelsPerMeter : null;
    if (!animate && radius === drawnRadius) return Boolean(breath);
    context ??= canvas.getContext('2d');
    if (!context) return false;
    context.clearRect(0, 0, width, height);
    drawnRadius = radius;
    if (!breath) return false;

    points ??= particleSphere();
    if (animate && lastFrame !== undefined) advancePhases(points, Math.min(.06, (now - lastFrame) / 1000));
    lastFrame = now;
    context.fillStyle = '#a8ddf7';
    for (const point of points) {
      const depth = (point.z + 1) / 2;
      context.globalAlpha = .2 + depth * .44 + .16 * (1 + Math.sin(point.phase));
      context.beginPath();
      context.arc(width / 2 + point.x * radius, height / 2 + point.y * radius, .75 + depth, 0, 2 * Math.PI);
      context.fill();
    }
    return true;
  }

  function sync() {
    const visible = state === 'RUNNING' || state === 'PAUSED';
    preview.hidden = !visible;
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
