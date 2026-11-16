const returnFocus = new WeakMap();

export function openDialog(dialog, trigger = document.activeElement) {
  if (dialog.open) return;
  const previous = document.querySelector('dialog[open]');
  const origin = previous ? returnFocus.get(previous) : trigger;
  previous?.close();
  returnFocus.set(dialog, origin);
  dialog.showModal();
}

export function mountDialogs() {
  document.addEventListener('click', ({ target }) => {
    const trigger = target.closest('[data-dialog], [data-close]');
    if (!trigger) return;
    if (trigger.hasAttribute('data-close')) trigger.closest('dialog').close();
    else openDialog(document.getElementById(trigger.dataset.dialog), trigger);
  });
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('close', () => {
      if (document.querySelector('dialog[open]')) return;
      const current = document.activeElement;
      if (current !== document.body && current.getClientRects().length) return;
      const origin = returnFocus.get(dialog);
      if (origin?.getClientRects().length && !origin.disabled) origin.focus({ preventScroll: true });
      else document.getElementById('tools-open').focus({ preventScroll: true });
    });
  }
}
