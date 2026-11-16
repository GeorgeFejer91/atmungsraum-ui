import { createMockDrive, mockDriveAccount } from './mock-drive.js';
import { createMockQuest } from './mock-quest.js';
import { participantIdentity } from './vendor/atmungsraum/data-logging.js';
import { mountQuestRehearsal } from './vendor/atmungsraum/quest-ui.js';

const byId = id => document.getElementById(id);

export function mountPlayground() {
  const url = new URL(location.href);
  const dialog = byId('simulation-dialog');
  const trigger = byId('simulation-open');
  const view = byId('simulation-screen');
  view.value = url.hash === '#daten' ? 'history' : url.searchParams.has('pairing') ? 'pairing' : 'connected';

  function navigate(next) {
    const target = new URL(location.href);
    target.hash = next === 'history' ? 'daten' : '';
    if (next === 'pairing') target.searchParams.set('pairing', '1');
    else target.searchParams.delete('pairing');
    // Switching the audit entry point starts a new simulated device session.
    history.replaceState(null, '', target);
    location.reload();
  }

  trigger.addEventListener('click', () => {
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
  });
  byId('simulation-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  });
  byId('simulation-reset').addEventListener('click', () => navigate('connected'));
  view.addEventListener('change', () => navigate(view.value));

  if (view.value === 'history') {
    byId('quest').hidden = true;
    byId('daten').hidden = false;
    byId('data-status').textContent = 'Keine früheren Browser-Aufnahmen vorhanden.';
    byId('simulation-state').disabled = byId('simulation-speed').disabled = true;
    byId('data-title').focus({ preventScroll: true });
    return;
  }

  const quest = createMockQuest();
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
  const page = mountQuestRehearsal(participantIdentity, view.value === 'connected' ? quest.savedPair : undefined,
    { ...quest.services, storage, driveOptions: createMockDrive() });
  byId('simulation-state').addEventListener('change', event => {
    quest.setFixture(event.target.value);
    void page.refresh();
  });
  byId('simulation-speed').addEventListener('change', event => quest.setSpeed(Number(event.target.value)));
}
