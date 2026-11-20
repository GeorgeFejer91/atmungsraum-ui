export const defaultAudioMix = Object.freeze({ music: 30, instructions: 90 });
const storageKey = 'atmungsraum.audio-mix.v1';

export function scenarioBackground(scenario) {
  return Boolean(scenario) && scenario !== 'free-exploration';
}

export function cueVolume(cueId) {
  return cueId === 'free-exploration-music' ? 'music' : 'instructions';
}

export function readAudioMix(storage) {
  let saved;
  try { saved = JSON.parse(storage.getItem(storageKey)); } catch { /* Use defaults. */ }
  const level = name => Number.isInteger(saved?.[name]) && saved[name] >= 0 && saved[name] <= 100
    ? saved[name] : defaultAudioMix[name];
  return { music: level('music'), instructions: level('instructions') };
}

export function saveAudioMix(storage, mix) {
  try { storage.setItem(storageKey, JSON.stringify(mix)); } catch { /* Keep the in-page selection. */ }
}

export function mountAudioMix(onChange) {
  const storage = {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  };
  const form = document.getElementById('audio-mix');
  const mix = readAudioMix(storage);
  const channels = Object.entries(mix).map(([name]) => {
    const input = form.querySelector('[name="' + name + '"]');
    const output = form.querySelector('output[for="' + input.id + '"]');
    function paint() {
      input.value = mix[name];
      output.value = mix[name] + ' %';
      input.setAttribute('aria-valuetext', output.value);
    }
    input.addEventListener('input', () => {
      mix[name] = input.valueAsNumber;
      paint();
      saveAudioMix(storage, mix);
      onChange(mix);
    });
    paint();
    return paint;
  });
  document.getElementById('audio-mix-reset').addEventListener('click', () => {
    Object.assign(mix, defaultAudioMix);
    channels.forEach(paint => paint());
    saveAudioMix(storage, mix);
    onChange(mix);
  });
  return mix;
}
