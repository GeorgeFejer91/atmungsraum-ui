import { mountPlayground } from './playground.js?v=5';
import { mountDialogs } from './dialogs.js';

const root = document.documentElement;
let measureLabels = () => {};
let frame;
function layout() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const height = Math.floor(window.visualViewport?.height ?? window.innerHeight);
    const size = height + 'px';
    if (root.style.getPropertyValue('--usable-height') !== size) root.style.setProperty('--usable-height', size);
    root.toggleAttribute('data-short-viewport', height < 380);
    measureLabels();
  });
}

const observer = new MutationObserver(records => {
  if (records.some(({ target, type, attributeName, oldValue }) => {
    if (type === 'attributes' && target.getAttribute(attributeName) === oldValue) return false;
    return !(target instanceof Element ? target : target.parentElement)?.closest('[data-live-value]');
  })) layout();
});
observer.observe(document.body, { childList: true, characterData: true, subtree: true,
  attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'open'] });
observer.observe(root, { attributes: true, attributeFilter: ['style', 'lang'] });
observer.observe(document.head, { childList: true });
window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);
document.fonts.addEventListener('loadingdone', layout);
mountDialogs();
mountPlayground();
layout();

async function initializeMeasurement() {
  try {
    if (typeof Intl.Segmenter !== 'function' || !document.createElement('canvas').getContext('2d')) {
      throw new Error('Text segmentation or Canvas 2D is unavailable.');
    }
    const { prepareWithSegments, measureLineStats, setLocale } = await import('./vendor/pretext/layout.js');
    await document.fonts.load('16px Arial');
    await document.fonts.ready;
    const cache = new Map();
    let locale;

    measureLabels = () => {
      for (const element of document.querySelectorAll('[data-measure]')) {
        if (!element.getClientRects().length) continue;
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden') continue;
        const value = element.dataset.measureSample ?? element.textContent.trim();
        const font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
        const letterSpacing = parseFloat(style.letterSpacing) || 0;
        const domOnly = (parseFloat(style.wordSpacing) || 0) !== 0 || style.hyphens === 'auto'
          || !['normal', 'pre-wrap'].includes(style.whiteSpace);
        const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        const range = document.createRange();
        range.selectNodeContents(element);
        const box = element.getBoundingClientRect();
        const fitsPaint = [...range.getClientRects()].every(rect =>
          rect.left >= box.left + parseFloat(style.paddingLeft) - 2
          && rect.right <= box.right - parseFloat(style.paddingRight) + 2
          && rect.top >= box.top + parseFloat(style.paddingTop) - 2
          && rect.bottom <= box.bottom - parseFloat(style.paddingBottom) + 2);
        let fitsEstimate = true;
        if (!domOnly && value && width > 0) {
          const language = element.closest('[lang]')?.lang || root.lang;
          if (locale !== language) {
            locale = language;
            setLocale(locale);
          }
          const key = JSON.stringify([language, font, value, letterSpacing, style.whiteSpace, style.wordBreak]);
          if (!cache.has(key)) {
            if (cache.size >= 128) cache.clear();
            cache.set(key, prepareWithSegments(value, font, { letterSpacing, whiteSpace: style.whiteSpace, wordBreak: style.wordBreak }));
          }
          const stats = measureLineStats(cache.get(key), Math.max(1, width - 1));
          fitsEstimate = stats.maxLineWidth <= width + 1 && stats.lineCount * parseFloat(style.lineHeight) <= height + 2;
        }
        element.dataset.textMeasurement = domOnly || !fitsEstimate ? 'dom' : 'pretext';
        element.dataset.textFit = fitsPaint ? 'fit' : 'reflow';
      }
      root.dataset.measurement = 'ready';
    };
    measureLabels();
    layout();
  } catch (error) {
    root.dataset.measurement = 'unavailable';
    console.warn('Text measurement unavailable. Using the browser layout.', error);
  }
}

void initializeMeasurement();
