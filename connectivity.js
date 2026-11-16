const labels = { bluetooth: 'Bluetooth', bridge: 'WLAN-Brücke', apk: 'Quest-App', polar: 'Polar H10', kiosk: 'Kiosk' };
const byId = id => document.getElementById(id);
const report = (id, value) => {
  const element = byId(id);
  if (element.textContent !== value) element.textContent = value;
};

function check(name, confirmed) {
  const button = byId('check-' + name);
  const state = confirmed === null ? 'checking' : confirmed ? 'ok' : 'unconfirmed';
  if (button.dataset.check === state) return;
  button.dataset.check = state;
  button.disabled = confirmed !== false;
  const label = labels[name] + (confirmed === null ? ': wird geprüft' : confirmed ? ': bestätigt' : ': nicht bestätigt');
  button.title = label;
  button.setAttribute('aria-label', label);
  button.querySelector('.check-symbol').textContent = confirmed === null ? '' : confirmed ? '✓' : '!';
}

export function showBluetooth(confirmed) {
  check('bluetooth', confirmed);
  report('bluetooth-feedback', confirmed
    ? 'Die Quest wurde über die simulierte Bluetooth-Suche gefunden.'
    : 'Quest über Bluetooth nicht gefunden. Prüfe Bluetooth und den Fernmodus.');
}

export function showOfflineChecks() {
  for (const [name, feedback] of [['bluetooth', 'bluetooth-feedback'], ['bridge', 'bridge-feedback'],
    ['apk', 'apk-update-status'], ['polar', 'polar-feedback']]) {
    check(name, false);
    report(feedback, 'In dieser Ansicht besteht keine Verbindung zur Quest.');
  }
  report('apk-required', 'Benötigter APK-Stand nicht geprüft.');
  byId('apk-identity').hidden = true;
}

export function showConnectionChecks({ status, version, polar, kiosk, checking, bridgeFailure }) {
  const bridge = checking && !status ? null : status?.wifi_snapshot === 1;
  check('bridge', bridge);
  report('bridge-feedback', bridge
    ? 'Die WLAN-Brücke liefert bestätigte Quest-Daten.'
    : bridgeFailure || 'Die WLAN-Brücke liefert keine bestätigten Quest-Daten. Prüfe, ob Smartphone und Quest im selben WLAN sind.');
  check('apk', version.state === 'checking' && bridge !== false ? null : Boolean(version.installed && version.compatible));
  check('polar', polar);
  check('kiosk', kiosk);
}
