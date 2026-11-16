import { LiveBreathDisplay } from './live-breath-display.js';
import { LiveEcgDisplay } from './live-ecg-display.js';
import { MockECG } from './mock-ecg.js';
import { participantIdentity } from './participant-id.js';
import { breathVolumeAt, demoCsv, ecgPacket, ecgRate, elapsedRun, runLengths } from './simulation.js';

const $ = id => document.getElementById(id);
const show = (id, value) => { $(id).toggleAttribute("hidden", !value); };
const text = (id, value) => setText($(id), value);
const label = (id, value) => setText($(id).firstElementChild, value);
const click = (id, action) => $(id).addEventListener('click', action);

function place(id, host) {
  const child = $(id);
  const parent = $(host);
  if (child.parentElement !== parent) parent.append(child);
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

const inputLabels = {
  automatic: 'Automatisch',
  personal: 'Persönlich eingerichteter Polar tilt',
  fixed: 'Polar tilt STATE · feste Achse',
  adaptive: 'Polar tilt STATE · dynamische Achse',
  controller: 'Controller State',
};

const initial = () => ({
  screen: 'connection', fixture: 'normal', speed: 1,
  owner: false, polar: false, input: 'automatic', setupAt: null, calibrationAt: null,
  generation: 1, run: null, kioskRecovered: false, drive: false,
});

export function mountPlayground() {
  const mock = new MockECG();
  const ecg = new LiveEcgDisplay();
  const breath = new LiveBreathDisplay();
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const form = $('patient-form');
  const dialog = $('simulation-dialog');
  let state = initial();
  let epoch = performance.now(), ecgLast = -Infinity, breathLast = -Infinity, frameId = 0;
  let loading = false, signalError = false, downloadUrl, observation = 0;

  function openScreen(screen, shortcut = false) {
    state.screen = screen;
    if (shortcut) {
      state.owner = !['connection', 'pairing', 'history'].includes(screen);
      state.polar = ['breathing', 'session', 'archive'].includes(screen);
      if (screen === 'breathing' && state.setupAt === null) state.setupAt = performance.now();
      if (screen === 'archive' || screen === 'session') $('quest-scenario').value = 'haupt-15';
    }
    $('simulation-screen').value = screen;
    $('quest-participant').open = screen === 'participant';
    if (['breathing', 'archive', 'history'].includes(screen) || state.polar) void prepareSignal();
    paint();
    window.scrollTo(0, 0);
    if (!dialog.open) focusScreen();
  }

  function focusScreen() {
    const title = { breathing: 'preview-title', history: 'data-title' }[state.screen] ?? 'quest-title';
    $(title).focus({ preventScroll: true });
  }

  function participant() {
    try { return participantIdentity(Object.fromEntries(new FormData(form))).id; }
    catch { return ''; }
  }

  function paintParticipant() {
    const id = participant();
    text('patient-id', id || '—');
    $('patient-next').disabled = !id;
  }

  async function prepareSignal() {
    if (mock.samples || loading) return;
    loading = true;
    signalError = false;
    try {
      await mock.prepare();
      downloadUrl = URL.createObjectURL(new Blob([demoCsv(mock.samples, mock.rate)], { type: 'text/csv' }));
      const link = $('quest-export-download');
      link.href = downloadUrl;
      link.download = 'SIM_Dem_30_O_EKG.csv';
      const saved = document.createElement('a');
      saved.href = downloadUrl;
      saved.download = link.download;
      saved.textContent = link.download;
      saved.dataset.measure = '';
      const item = document.createElement('li');
      item.append(saved);
      $('data-files').replaceChildren(item);
    } catch {
      signalError = true;
    } finally {
      loading = false;
      paint();
    }
  }

  function paintPolar() {
    const lost = state.fixture === 'signal-loss';
    text('quest-polar-status', !state.polar ? 'Polar H10 ist getrennt.'
      : lost ? 'EKG-Signal verloren · Verbindung wird erneut gesucht.'
        : 'Polar H10 verbunden · EKG und Bewegung bereit.');
    label('quest-polar-connect', state.polar && !lost && !signalError ? 'Polar H10 trennen' : 'Polar H10 verbinden');
    text('quest-ecg-status', lost ? 'Warte auf aktuelle EKG-Daten.'
      : signalError ? 'Testsignal konnte nicht geladen werden. Erneut verbinden.'
        : state.polar ? 'Simuliertes EKG · NeuroKit2' : 'EKG nach Verbindung verfügbar.');
    if (!state.polar || lost) {
      ecg.reset();
      ecgLast = -Infinity;
      show('quest-ecg', false);
      show('quest-ecg-scale', false);
    }
  }

  function paint() {
    const { screen, owner, fixture, run } = state;
    const preview = screen === 'breathing';
    const history = screen === 'history';
    const paired = !['connection', 'pairing', 'history'].includes(screen);
    const session = screen === 'session';
    const archive = screen === 'archive';
    const polarView = ['polar', 'session', 'archive'].includes(screen);
    show('quest', !preview && !history);
    show('breathing-preview', preview);
    show('daten', history);
    show('recenter-vr', paired);
    $('recenter-vr').setAttribute('aria-disabled', String(!owner));
    text('quest-status', screen === 'connection' ? 'Suche nach einer Quest starten.'
      : screen === 'pairing' ? 'Quest 2 gefunden · Kopplung bestätigen.'
        : run && run.started !== null ? 'Versuch läuft.'
          : run ? 'Versuch pausiert.'
            : 'Quest 2 · simulierte Verbindung aktiv.');
    show('quest-find', screen === 'connection');
    show('quest-pairing', screen === 'pairing');
    text('quest-pairing-code', '481 620');
    place('quest-control-access', preview ? 'preview-control-host' : 'quest-control-host');
    show('quest-control-host', paired && !preview);
    show('preview-control-host', preview);
    show('quest-control-access', paired);
    show('quest-control-claim', paired && !owner);
    show('quest-control-release', paired && owner);
    text('quest-control-status', owner ? 'Dieses Smartphone steuert die Quest.' : 'Steuerung ist verfügbar.');
    show('quest-participant', paired && !preview);
    $('patient-fields').disabled = !owner;
    if (owner) paintParticipant();
    else $('patient-next').disabled = true;
    show('quest-polar', polarView);
    show('quest-data', polarView);
    show('quest-disconnect', paired && !preview);
    show('quest-condition-label', session && !run);
    show('quest-scenario-label', session && !run);
    show('quest-clock', session && Boolean(run));
    show('quest-play', owner && (screen === 'polar' && state.polar || session));
    $('quest-play').disabled = screen === 'polar' && fixture === 'signal-loss';
    label('quest-play', screen === 'polar' ? 'Atmung einrichten' : run ? (run.started === null ? 'Fortsetzen' : 'Pause') : 'Starten');
    show('quest-finish', session && Boolean(run));
    show('quest-export-status', archive);
    show('quest-export-retry', archive);
    show('quest-archives-label', archive);
    show('quest-export-download', archive && Boolean(downloadUrl));
    show('quest-drive', paired);
    show('quest-drive-status', state.drive);
    text('quest-drive-status', 'Google Drive · simuliert verbunden.');
    text('quest-export-status', signalError ? 'Testaufnahme konnte nicht geladen werden.' : 'Synthetische Testaufnahme zum Download.');
    text('data-status', signalError ? 'Testaufnahme konnte nicht geladen werden.' : 'Synthetische CSV-Datei zum Herunterladen auswählen.');
    place('quest-version', preview ? 'preview-version-host' : 'quest-version-host');
    place('quest-settings', preview ? 'preview-settings-host' : 'quest-settings-host');
    show('quest-version', paired);
    text('apk-update-status', fixture === 'old-apk' ? 'Quest-App aktualisieren.' : 'Quest-App ist aktuell.');
    text('apk-installed', fixture === 'old-apk' ? 'Installiert: 0.2.9-dev · Code 10 (Demo)' : 'Installiert: 0.2.10-dev · Code 11 (Demo)');
    text('apk-required', 'Benötigt: Code 11');
    text('apk-full-identity', 'org.viscereality.atmungsraum.developer · UI-Demo');
    show('quest-settings', paired);
    const kioskError = fixture === 'kiosk-error' && !state.kioskRecovered;
    text('kiosk-summary', kioskError ? 'Kiosk-Dienst unterbrochen.' : 'Kiosk-Schutz aktiv.');
    text('kiosk-prerequisites', kioskError ? 'Der Bedienungshilfedienst muss wieder verbunden werden.' : 'Quest im Fernmodus · Schutz bereit.');
    text('kiosk-detail', 'Simulierter Status der Quest-App.');
    show('kiosk-retry', kioskError);
    paintPolar();
    paintPreview();
    trackVisibility();
  }

  function paintPreview() {
    const { input, owner, calibrationAt, fixture, setupAt } = state;
    const ready = input !== 'automatic' && calibrationAt === null;
    const error = fixture === 'setup-error';
    const previousApk = fixture === 'old-apk';
    text('preview-title', input === 'controller' ? 'Controller testen' : 'Atmung einrichten');
    text('preview-input-label', 'Bestätigte Eingabe: ' + inputLabels[input]);
    text('preview-polar-status', fixture === 'signal-loss' ? 'Polar H10 · Signal verloren' : 'Polar H10 · EKG und Bewegung bereit');
    text('preview-detail', error ? 'Atemschleife wartet auf erneute Bestätigung.'
      : calibrationAt !== null ? 'Zwei vollständige Atemzyklen werden ausgewertet.'
        : ready ? 'Bereit für die Auswahl.' : 'Wähle eine Eingabe für die Atemschleife.');
    show('preview-recovery', error);
    show('preview-acknowledge', error);
    text('preview-recovery-title', 'Atemschleife unterbrochen');
    text('preview-recovery-detail', 'Frage den aktuellen Zustand ab oder starte die Einrichtung erneut.');
    show('preview-start', setupAt === null);
    show('preview-progress-group', calibrationAt !== null);
    show('preview-modes-compatibility', previousApk);
    show('preview-controller', input !== 'controller');
    show('preview-personal-return', ['fixed', 'adaptive'].includes(input));
    show('preview-calibrate', !['fixed', 'adaptive'].includes(input));
    label('preview-calibrate', input === 'controller' ? 'Zu Polar wechseln und einrichten'
      : input === 'personal' || error ? 'Einrichtung erneut starten' : 'Atmung persönlich einrichten');
    for (const mode of ['fixed', 'adaptive']) {
      const button = $('preview-polar-' + mode);
      button.hidden = previousApk;
      button.setAttribute('aria-pressed', String(input === mode));
    }
    for (const id of ['preview-start', 'preview-calibrate', 'preview-personal-return', 'preview-controller',
      'preview-polar-fixed', 'preview-polar-adaptive', 'preview-acknowledge']) $(id).disabled = !owner;
    $('preview-continue').disabled = !owner || !ready || error;
  }

  function animate(now) {
    if (['polar', 'session', 'archive'].includes(state.screen) && state.polar && state.fixture !== 'signal-loss' && mock.samples) {
      if (now - ecgLast >= 250) {
        ecg.push(ecgPacket(mock.samples, mock.rate, now - epoch, state.fixture === 'signal-gap'), now);
        ecgLast = now;
      }
      const trace = ecg.frame(reduceMotion.matches ? ecgLast : now);
      show('quest-ecg', Boolean(trace));
      show('quest-ecg-scale', Boolean(trace));
      $('quest-ecg-trace').setAttribute('d', trace?.path ?? '');
      if (trace) text('quest-ecg-scale', '2 s · ' + ecgRate + ' Hz · ±' + trace.range + ' µV (simuliert)');
    }
    if (state.screen === 'breathing') animateBreathing(now);
    if (state.screen === 'session' && state.run) {
      const elapsed = elapsedRun(state.run, now);
      paintClock(elapsed);
      if (elapsed >= state.run.duration) finish();
    }
    if (needsAnimation()) frameId = requestAnimationFrame(animate);
  }

  function animateBreathing(now) {
    const { setupAt, generation, calibrationAt, input, fixture } = state;
    const active = setupAt !== null && fixture !== 'setup-error';
    const time = active ? Math.max(0, now - setupAt) : 0;
    const progress = calibrationAt === null ? 0 : Math.max(0, Math.min(2, (now - calibrationAt) / 16000));
    if (progress >= 2) {
      state.calibrationAt = null;
      state.input = 'personal';
      paintPreview();
    }
    if (now - breathLast >= 200) {
      const desired = breathVolumeAt(time);
      const actual = active ? Math.min(1, breathVolumeAt(time - 520) * .94 + .03) : 0;
      breath.update({
        available: true, acceptance: 'simulation', progress: { value: progress }, inputVolume: desired,
        setup: { g: generation, attempt: generation, audio_generation: generation, cycle_frames: 16000,
          position_frames: Math.round(time), playing: active, audio_state: active ? 'playing' : 'idle', input },
        renderer: active && fixture !== 'old-apk' ? { progress01: actual, radius_m: 1 + actual,
          age_ns: 0, frame: observation, render_generation: generation, settings_revision: 1 } : null,
      }, { i: String(observation++), a: 0 }, now);
      breathLast = now;
    }
    const current = breath.frame(now, reduceMotion.matches);
    if (!current) return;
    $('preview-circle').style.transform = 'scale(' + current.radius + ')';
    show('preview-actual-circle', current.actualRadius !== null);
    show('preview-actual-volume', current.actualRadius !== null);
    if (current.actualRadius !== null) {
      $('preview-actual-circle').style.transform = 'scale(' + current.actualRadius + ')';
      text('preview-actual-volume', Math.round(current.actualProgress * 100) + ' %');
    }
    text('preview-actual-status', current.actualRadius === null ? 'IST-Radius nicht verfügbar.' : 'IST-Radius · aktuell: ');
    text('preview-status', active ? 'Atemtakt: ' + current.phaseLabel : 'Atemschleife wartet.');
    $('preview-progress').value = current.progress;
    $('preview-progress-fill').style.transform = 'scaleX(' + current.progress / 2 + ')';
    text('preview-progress-text', Math.floor(current.progress) + ' von 2 Atemzyklen');
  }

  function chooseInput(input) {
    state.setupAt ??= performance.now();
    state.calibrationAt = null;
    state.input = input;
    state.generation++;
    if (state.fixture === 'setup-error') setFixture('normal');
    paint();
  }

  function setFixture(fixture) {
    state.fixture = fixture;
    if (fixture === 'setup-error') state.calibrationAt = null;
    if (fixture === 'old-apk' && ['fixed', 'adaptive'].includes(state.input)) state.input = 'automatic';
    $('simulation-state').value = fixture;
    state.kioskRecovered = false;
    ecg.reset();
    breath.reset();
    ecgLast = breathLast = -Infinity;
    paint();
  }

  function paintClock(elapsed) {
    const whole = Math.floor(elapsed);
    const time = [Math.floor(whole / 60), whole % 60];
    text('quest-clock', time.map(value => String(value).padStart(2, '0')).join(':'));
  }

  function play() {
    if (state.screen === 'polar') {
      openScreen('breathing');
      return;
    }
    const now = performance.now();
    if (!state.run) {
      state.run = { started: now, elapsed: 0, speed: state.speed, duration: runLengths[$('quest-scenario').value] };
    } else if (state.run.started === null) {
      state.run.started = now;
    } else {
      state.run.elapsed = elapsedRun(state.run, now);
      state.run.started = null;
      paintClock(state.run.elapsed);
    }
    paint();
  }

  function finish() {
    state.run = null;
    openScreen('archive');
  }

  function reset() {
    state = initial();
    epoch = performance.now();
    form.reset();
    $('quest-drive-form').reset();
    $('simulation-speed').value = '1';
    setFixture('normal');
    openScreen('connection');
  }

  function needsAnimation() {
    return !document.hidden && (
      state.screen === 'breathing' ||
      (['polar', 'session', 'archive'].includes(state.screen) && state.polar && state.fixture !== 'signal-loss' && mock.samples) ||
      (state.screen === 'session' && state.run && state.run.started !== null)
    );
  }

  function trackVisibility() {
    cancelAnimationFrame(frameId);
    if (needsAnimation()) frameId = requestAnimationFrame(animate);
  }

  function enterShortcut() {
    state.run = null;
    openScreen($('simulation-screen').value, true);
    dialog.close('navigated');
  }

  click('simulation-open', () => {
    dialog.returnValue = '';
    dialog.showModal();
    $('simulation-open').setAttribute('aria-expanded', 'true');
  });
  click('simulation-close', () => dialog.close());
  click('simulation-reset', () => { reset(); dialog.close('navigated'); });
  dialog.addEventListener('close', () => {
    $('simulation-open').setAttribute('aria-expanded', 'false');
    if (dialog.returnValue === 'navigated') focusScreen();
    else $('simulation-open').focus({ preventScroll: true });
  });
  $('simulation-screen').addEventListener('change', enterShortcut);
  $('simulation-state').addEventListener('change', event => setFixture(event.target.value));
  $('simulation-speed').addEventListener('change', event => { state.speed = Number(event.target.value); });
  click('quest-find', () => openScreen('pairing'));
  click('quest-pairing-confirm', () => openScreen('participant'));
  click('quest-pairing-cancel', () => openScreen('connection'));
  click('quest-control-claim', () => { state.owner = true; paint(); });
  click('quest-control-release', () => { state.owner = false; paint(); });
  form.addEventListener('input', paintParticipant);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (state.owner && participant()) openScreen('polar');
  });
  click('quest-polar-connect', () => {
    state.polar = !state.polar || state.fixture === 'signal-loss' || signalError;
    if (state.fixture === 'signal-loss') setFixture('normal');
    if (state.polar) void prepareSignal();
    paint();
  });
  click('quest-play', play);
  click('quest-finish', finish);
  click('quest-disconnect', reset);
  click('recenter-vr', () => {
    if (state.owner) text(state.screen === 'breathing' ? 'preview-detail' : 'quest-status', 'VR-Zentrierung simuliert.');
  });
  click('preview-start', () => chooseInput('automatic'));
  for (const id of ['preview-calibrate', 'preview-personal-return']) click(id, () => {
    chooseInput('automatic');
    const now = performance.now();
    state.calibrationAt = state.setupAt + Math.ceil((now - state.setupAt) / 16000) * 16000;
    paintPreview();
  });
  for (const mode of ['fixed', 'adaptive', 'controller']) {
    const id = mode === 'controller' ? 'preview-controller' : 'preview-polar-' + mode;
    click(id, () => chooseInput(mode));
  }
  click('preview-acknowledge', () => setFixture('normal'));
  click('preview-continue', () => { state.run = null; openScreen('session'); });
  click('kiosk-retry', () => { state.kioskRecovered = true; paint(); });
  click('quest-export-retry', () => { void prepareSignal(); paint(); });
  $('quest-drive-client').placeholder = 'demo.apps.example.invalid';
  $('quest-drive-account').placeholder = 'demo@example.invalid';
  $('quest-drive-form').addEventListener('input', event => { $('quest-drive-connect').disabled = !event.currentTarget.checkValidity(); });
  $('quest-drive-form').addEventListener('submit', event => {
    event.preventDefault();
    state.drive = true;
    event.currentTarget.reset();
    $('quest-drive-connect').disabled = true;
    paint();
  });
  $('quest-archives').add(new Option('SIM_Dem_30_O_EKG.csv', 'synthetic-ecg'));
  document.addEventListener('visibilitychange', trackVisibility);
  openScreen(location.hash === '#daten' ? 'history' : 'connection');
  trackVisibility();
}
