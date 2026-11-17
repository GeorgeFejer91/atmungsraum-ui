import { createMockDrive, mockDriveAccount } from './mock-drive.js';
import { createMockQuest } from './mock-quest.js?v=audio-start';
import { openDialog } from './dialogs.js';
import { mountBreathingAudio, playCalibrationPrelude } from './playground-audio.js?v=audio-start';
import { mountSceneParticles } from './scene-particles.js?v=main-study-sequence';
import { participantIdentity } from './vendor/atmungsraum/data-logging.js';
import { mountQuestRehearsal } from './vendor/atmungsraum/quest-ui.js?v=audio-start';
import { showBluetooth, showOfflineChecks } from './connectivity.js?v=header-actions';

const byId = id => document.getElementById(id);
const reviewViews = ['connection', 'participant', 'calibration', 'scenarios', 'session'];

export function mountPlayground() {
  const url = new URL(location.href);
  const view = byId('simulation-screen');
  const requested = url.searchParams.get('view');
  const entry = url.hash === '#daten' ? 'history' : url.searchParams.has('pairing') ? 'pairing'
    : reviewViews.includes(requested) ? requested : 'connection';
  view.value = entry;

  function navigate(next) {
    const target = new URL(location.href);
    target.hash = next === 'history' ? 'daten' : '';
    target.searchParams.delete('view');
    target.searchParams.delete('pairing');
    if (next === 'pairing') target.searchParams.set('pairing', '1');
    else if (reviewViews.includes(next) && next !== 'connection') target.searchParams.set('view', next);
    // A hash-only change needs a full reload too, to start a fresh mock device.
    history.replaceState(null, '', target);
    location.reload();
  }

  byId('simulation-reset').addEventListener('click', () => navigate('connection'));
  view.addEventListener('change', () => navigate(view.value));

  if (entry === 'history') {
    byId('quest').hidden = true;
    byId('daten').hidden = false;
    showOfflineChecks();
    for (const id of ['control-open', 'recordings-open', 'ecg-open', 'drive-open']) byId(id).disabled = true;
    byId('data-status').textContent = 'Keine früheren Browser-Aufnahmen vorhanden.';
    byId('simulation-state').disabled = byId('simulation-speed').disabled = true;
    byId('data-title').focus({ preventScroll: true });
    return;
  }

  const preview = byId('breathing-preview');
  const quest = createMockQuest(entry);
  const particles = mountSceneParticles(byId('scene-particles'), quest.sceneBreathing);
  let calibrationRequested = false, questAvailable = false;
  const audio = mountBreathingAudio(() => questAvailable ? quest.audioPlayback(calibrationRequested) : null);
  async function playPrelude(signal) {
    const played = await playCalibrationPrelude(byId('preview-instruction-audio'), signal);
    if (played && !signal.aborted) calibrationRequested = true;
    return played;
  }
  for (const id of ['preview-calibrate', 'preview-restart', 'preview-controller', 'quest-play']) {
    const button = byId(id);
    button.addEventListener('click', () => {
      if (button.hidden || button.disabled) return;
      if (id === 'preview-restart' || id === 'preview-controller') calibrationRequested = true;
      audio.unlock();
    });
  }
  let focusReview = true;
  function onPaint({ status, unknown }) {
    questAvailable = Boolean(status) && !unknown;
    particles.update(questAvailable ? status.p : null);
    if (preview.hidden) calibrationRequested = false;
    audio.update();
    if (!focusReview || !questAvailable) return;
    const participant = byId('quest-participant');
    if (entry === 'participant' && !participant.hidden && !byId('patient-fields').disabled) {
      focusReview = false;
      openDialog(byId('participant-dialog'), participant);
    } else if (entry === 'scenarios' && !byId('session-choices').hidden) {
      focusReview = false;
      byId('quest-scenario').querySelector('input:checked')?.focus({ preventScroll: true });
    } else if (entry === 'session' && !byId('quest-playback').hidden && !byId('quest-play').disabled) {
      focusReview = false;
      byId('quest-play').focus({ preventScroll: true });
    }
  }
  async function checkBluetooth() {
    if (document.hidden) return;
    const result = await quest.services.rediscoverQuest();
    showBluetooth(result.state === 'ready');
  }
  void checkBluetooth();
  setInterval(checkBluetooth, 1000);
  document.addEventListener('visibilitychange', checkBluetooth);
  const journal = new Map();
  const storage = {
    getItem: key => journal.get(key) ?? null,
    setItem: (key, value) => journal.set(key, value),
    removeItem: key => journal.delete(key),
  };
  for (const [id, value] of [['quest-drive-client', mockDriveAccount.clientId], ['quest-drive-account', mockDriveAccount.email]]) {
    const field = byId(id);
    field.value = value;
    field.readOnly = true;
  }
  const page = mountQuestRehearsal(participantIdentity, entry === 'pairing' ? undefined : quest.savedPair,
    { ...quest.services, storage, driveOptions: createMockDrive(), review: entry, onPaint,
      playCalibrationPrelude: playPrelude,
      preparePlayback: (scenario, signal) => quest.needsMainStudyAudio(scenario) ? audio.prepareMainStudy(signal) : null });
  byId('simulation-state').addEventListener('change', event => {
    quest.setFixture(event.target.value);
    void checkBluetooth();
    void page.refresh();
  });
  byId('simulation-speed').addEventListener('change', event => quest.setSpeed(Number(event.target.value)));
}
