async () => {
  await document.fonts.ready;
  for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);

  const problems = [];
  const root = document.documentElement;
  const viewport = visualViewport;
  const dialog = document.querySelector('dialog[open]');
  const activePanel = dialog ?? document.querySelector('.screen:not([hidden])');
  const describe = element => element.id ? `#${element.id}` : element.tagName.toLowerCase();
  const visible = element => element?.getClientRects().length && element.checkVisibility();
  const layoutContainer = element => ['grid', 'flex'].includes(getComputedStyle(element).display);
  const inside = (box, outer) => box.left >= outer.left - 1 && box.right <= outer.right + 1
    && box.top >= outer.top - 1 && box.bottom <= outer.bottom + 1;
  const view = { left: viewport.offsetLeft, top: viewport.offsetTop,
    right: viewport.offsetLeft + viewport.width, bottom: viewport.offsetTop + viewport.height };
  const reportOverflow = element => {
    const width = element.scrollWidth - element.clientWidth;
    const height = element.scrollHeight - element.clientHeight;
    if (width > 0 || height > 0) problems.push(`${describe(element)} overflow ${Math.max(0, width)} × ${Math.max(0, height)} px`);
    if (element.scrollLeft || element.scrollTop) problems.push(`${describe(element)} scrolled`);
  };

  reportOverflow(root);
  if (!activePanel) return { problems: [...problems, 'No active screen or dialog'] };
  if (!dialog) {
    const main = activePanel.closest('main');
    if (main) reportOverflow(main);
  }
  const panelBox = activePanel.getBoundingClientRect();
  const chrome = dialog ? [] : [...document.querySelectorAll('#corner-actions, #corner-actions button, #recenter-vr')];
  const elements = [activePanel, ...activePanel.querySelectorAll('*'), ...chrome]
    .filter(element => element instanceof HTMLElement && visible(element)
      && !element.closest('.sr-only, [aria-hidden="true"]'));

  for (const element of elements) {
    const style = getComputedStyle(element);
    if (element.matches('#install-app span') && style.clipPath !== 'none' && element.clientWidth <= 1) continue;
    const nativeField = element.matches('input, select, textarea');
    const bounded = element.clientWidth > 0 && element.clientHeight > 0;
    if (bounded && !nativeField) reportOverflow(element);
    if (!inside(element.getBoundingClientRect(), view)) {
      problems.push(`${describe(element)} extends outside the visual viewport`);
    }
    if (element.matches('[data-measure]') && element.textContent.trim()
        && (element.dataset.textFit !== 'fit' || !['pretext', 'dom'].includes(element.dataset.textMeasurement))) {
      problems.push(`${describe(element)} has no passing text measurement`);
    }
    if (activePanel.contains(element) && element.matches('button, input, select, textarea, summary, a[href]')) {
      const box = element.getBoundingClientRect();
      if (!inside(box, panelBox)) problems.push(`${describe(element)} escapes its panel`);
      const target = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      if (target && !element.contains(target)) problems.push(`${describe(element)} is covered`);
    }
  }

  const header = activePanel.querySelector(':scope > :is(header, h1, h2)');
  const body = activePanel.querySelector(':scope > .screen-body');
  const footer = activePanel.querySelector(':scope > footer');
  if (![header, body, footer].every(visible) || ![activePanel, body].every(layoutContainer)) {
    problems.unshift(`${describe(activePanel)} needs stretch accordion header, flexible body, and action footer`);
    return { problems };
  }

  const headerBox = header.getBoundingClientRect();
  const bodyBox = body.getBoundingClientRect();
  const footerBox = footer.getBoundingClientRect();
  const panelStyle = getComputedStyle(activePanel);
  const top = panelBox.top + parseFloat(panelStyle.paddingTop) + activePanel.clientTop;
  const bottom = top + activePanel.clientHeight - parseFloat(panelStyle.paddingTop) - parseFloat(panelStyle.paddingBottom);
  if (Math.abs(headerBox.top - top) > 2 || Math.abs(bottom - footerBox.bottom) > 2
      || headerBox.bottom > bodyBox.top + 1 || bodyBox.bottom > footerBox.top + 1) {
    problems.push(`${describe(activePanel)} lost its stretch accordion anchors or region order`);
  }
  const bodyStyle = getComputedStyle(body);
  if (bodyStyle.minWidth !== '0px' || bodyStyle.minHeight !== '0px') {
    problems.push(`${describe(activePanel)} stretch body needs shrinkable width and height`);
  }
  const groups = [...body.children].filter(visible).map(element => element.getBoundingClientRect());
  const gaps = groups.slice(1).reduce((sum, group, index) => sum + Math.max(0, group.top - groups[index].bottom), 0);
  return { problems, bodyWidth: bodyBox.width, bodyHeight: bodyBox.height, gap: gaps, groups: groups.length };
}
