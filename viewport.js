const root = document.documentElement;
const split = '[data-page-split], details[open]';
let showElement;

export function focusInViewport(element) {
  showElement?.(element);
  element.focus({ preventScroll: true });
}

function groups(body) {
  const leaves = [];
  const wrappers = [];
  function visit(parent, lineage) {
    for (const child of parent.children) {
      if (child.hasAttribute('hidden') || !child.getClientRects().length) continue;
      if (child.matches(split)) {
        wrappers.push(child);
        visit(child, [...lineage, child]);
      } else leaves.push({ element: child, lineage });
    }
  }
  visit(body, []);
  return { leaves, wrappers };
}

function render({ leaves, wrappers }, page) {
  const active = new Set(page.flatMap(({ element, lineage }) => [element, ...lineage]));
  for (const { element } of leaves) element.toggleAttribute('data-page-hidden', !active.has(element));
  for (const wrapper of wrappers) wrapper.toggleAttribute('data-page-hidden', !active.has(wrapper));
}

function makeButton(label, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  const text = document.createElement('span');
  text.setAttribute('aria-hidden', 'true');
  text.dataset.measure = '';
  text.textContent = icon;
  button.append(text);
  return button;
}

function mountPanel(panel, onPaint) {
  const body = panel.querySelector(':scope > .screen-body');
  const footer = panel.querySelector(':scope > footer');
  const nav = document.createElement('nav');
  nav.className = 'viewport-navigation';
  nav.hidden = true;
  nav.setAttribute('aria-label', 'Seiten');
  const previous = makeButton('Vorherige Seite', '←');
  const next = makeButton('Nächste Seite', '→');
  const counter = document.createElement('span');
  counter.dataset.measure = '';
  counter.setAttribute('aria-live', 'polite');
  nav.append(previous, counter, next);
  footer.append(nav);

  let content, pages = [], selected = 0, anchor;
  function display(index) {
    if (!content || !pages[index]) return;
    selected = index;
    anchor = pages[index][0]?.element;
    render(content, pages[index]);
    const label = (index + 1) + ' / ' + pages.length;
    if (counter.textContent !== label) counter.textContent = label;
    nav.hidden = pages.length <= 1;
    previous.disabled = index === 0;
    next.disabled = index === pages.length - 1;
    panel.dataset.page = String(index + 1);
    panel.dataset.pages = String(pages.length);
  }

  for (const [button, offset] of [[previous, -1], [next, 1]]) button.addEventListener('click', () => {
    display(selected + offset);
    if (button.disabled && !nav.hidden) (offset === 1 ? previous : next).focus({ preventScroll: true });
    onPaint();
  });

  return {
    reset() { anchor = null; },
    layout(target) {
      if (panel.hidden || panel.matches('dialog:not([open])')) return;
      const focused = document.activeElement;
      const preferred = target ?? (body.contains(focused) ? focused : anchor);
      body.querySelectorAll('[data-page-hidden], [data-page-index]').forEach(element => {
        element.removeAttribute('data-page-hidden');
        element.removeAttribute('data-page-index');
      });
      nav.hidden = false;
      content = groups(body);
      // Measure with the real DOM, including fonts, wrapping, and open details.
      pages = [];
      let page = [];
      const noFit = [];
      for (const leaf of content.leaves) {
        const candidate = [...page, leaf];
        render(content, candidate);
        if (body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth) {
          if (page.length) {
            pages.push(page);
            page = [leaf];
            render(content, page);
          } else page = candidate;
          if (body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth) {
            noFit.push(leaf.element.id || leaf.element.className || leaf.element.tagName);
          }
        } else page = candidate;
      }
      pages.push(page);
      if (noFit.length) panel.dataset.noFit = noFit.join(', ');
      else panel.removeAttribute('data-no-fit');
      pages.forEach((items, index) => {
        items.forEach(({ element }) => { element.dataset.pageIndex = String(index + 1); });
      });
      const index = preferred ? pages.findIndex(items => items.some(({ element }) => element.contains(preferred))) : -1;
      display(index < 0 ? 0 : index);
      if (focused instanceof HTMLElement && panel.contains(focused) && focused.getClientRects().length
        && document.activeElement !== focused) focused.focus({ preventScroll: true });
    },
  };
}

export function mountViewport(measure) {
  let frame = 0;
  let visibleScreen;
  let visibleDialog;
  let validating = false;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(refresh);
  };
  const panels = new Map([...document.querySelectorAll('.screen, dialog')].map(panel => [panel, mountPanel(panel, measure)]));

  function refresh() {
    frame = 0;
    const height = Math.floor(window.visualViewport?.height ?? window.innerHeight);
    const usableHeight = height + 'px';
    if (root.style.getPropertyValue('--usable-height') !== usableHeight) root.style.setProperty('--usable-height', usableHeight);
    root.toggleAttribute('data-short-viewport', height < 380);
    const screen = document.querySelector('.screen:not([hidden])');
    const dialog = document.querySelector('dialog[open]');
    if (screen !== visibleScreen) panels.get(screen)?.reset();
    if (dialog !== visibleDialog) panels.get(dialog)?.reset();
    visibleScreen = screen;
    visibleDialog = dialog;
    panels.get(screen)?.layout();
    panels.get(dialog)?.layout();
    measure();
  }

  showElement = element => {
    const panel = element.closest('.screen, dialog');
    if (!panel?.dataset.page || !element.getClientRects().length) panels.get(panel)?.layout(element);
    measure();
  };

  const observer = new MutationObserver(records => {
    if (records.some(({ target, type, attributeName, oldValue }) => {
      if (type === 'attributes' && target.getAttribute(attributeName) === oldValue) return false;
      const element = target instanceof Element ? target : target.parentElement;
      return !element?.closest('.viewport-navigation, [data-live-value]');
    })) schedule();
  });
  for (const panel of panels.keys()) observer.observe(panel, {
    childList: true, characterData: true, subtree: true,
    attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'open'],
  });
  observer.observe(root, { attributes: true, attributeFilter: ['style', 'lang'] });
  observer.observe(document.head, { childList: true });
  document.addEventListener('invalid', ({ target }) => {
    if (validating || !(target instanceof HTMLElement) || !target.closest('.screen, dialog')) return;
    validating = true;
    focusInViewport(target);
    // A single form validation can report several invalid fields.
    setTimeout(() => { validating = false; }, 0);
  }, true);
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  document.fonts.addEventListener('loadingdone', schedule);
  refresh();
  return schedule;
}
