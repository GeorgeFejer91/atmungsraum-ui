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
  const survey = activePanel?.matches('#questionnaire-screen') ? activePanel.querySelector('#questionnaire-form') : null;
  const surveyBox = survey?.getBoundingClientRect();
  const reportOverflow = element => {
    const width = element.scrollWidth - element.clientWidth;
    const height = element === survey ? 0 : element.scrollHeight - element.clientHeight;
    if (width > 0 || height > 0) problems.push(`${describe(element)} overflow ${Math.max(0, width)} × ${Math.max(0, height)} px`);
    if (element.scrollLeft || element !== survey && element.scrollTop) problems.push(`${describe(element)} scrolled`);
  };

  reportOverflow(root);
  if (document.querySelector('.viewport-navigation, [data-page-index]')) problems.push('Generic viewport pagination is present');
  if (!activePanel) return { problems: [...problems, 'No active screen or dialog'] };
  if (!dialog) {
    const main = activePanel.closest('main');
    if (main) reportOverflow(main);
  }
  const panelBox = activePanel.getBoundingClientRect();
  const toolbar = document.querySelector('#corner-actions');
  const toolbarBox = toolbar.getBoundingClientRect();
  const widgets = [...toolbar.querySelectorAll('button')].filter(visible);
  const firstWidget = widgets[0]?.getBoundingClientRect();
  if (widgets.length < 6 || widgets.some(widget => {
    const box = widget.getBoundingClientRect();
    return !inside(box, toolbarBox) || box.width < 24 || Math.abs(box.width - box.height) > 1
      || Math.abs(box.top - firstWidget.top) > 1 || Math.abs(box.width - firstWidget.width) > 1;
  })) problems.push('Top widgets must fit in one aligned row of equal squares');
  if (toolbarBox.bottom > panelBox.top + 1) problems.push('Active panel covers the top widget row');
  const chrome = [toolbar, ...widgets];
  const elements = [activePanel, ...activePanel.querySelectorAll('*'), ...chrome]
    .filter(element => element instanceof HTMLElement && visible(element)
      && !element.closest('.sr-only, [aria-hidden="true"]'));

  for (const element of elements) {
    const style = getComputedStyle(element);
    if (element.matches('#install-app span') && style.clipPath !== 'none' && element.clientWidth <= 1) continue;
    const nativeField = element.matches('input, select, textarea');
    const bounded = element.clientWidth > 0 && element.clientHeight > 0;
    if (bounded && !nativeField) reportOverflow(element);
    const surveyItem = element !== survey && survey?.contains(element);
    const boundary = surveyItem ? { left: surveyBox.left, right: surveyBox.right, top: -Infinity, bottom: Infinity } : view;
    if (!inside(element.getBoundingClientRect(), boundary)) {
      problems.push(`${describe(element)} extends outside the visual viewport`);
    }
    if (element.matches('[data-measure]') && element.textContent.trim()
        && (element.dataset.textFit !== 'fit' || !['pretext', 'dom'].includes(element.dataset.textMeasurement))) {
      problems.push(`${describe(element)} has no passing text measurement`);
    }
    if (element.matches('.session-tile')) {
      const box = element.getBoundingClientRect();
      const img = element.querySelector('img');
      const label = element.querySelector('[data-measure]');
      if (Math.abs(box.width - box.height) > 1 || box.width < 44) problems.push('Scenario tile is not a usable square');
      if (!img.naturalWidth || !inside(img.getBoundingClientRect(), box) || !inside(label.getBoundingClientRect(), box)) {
        problems.push('Scenario tile does not fit its illustration and label');
      }
    }
    if (activePanel.contains(element) && element.matches('button, input, select, textarea, summary, a[href]')) {
      const box = element.getBoundingClientRect();
      if (!surveyItem && !inside(box, panelBox)) problems.push(`${describe(element)} escapes its panel`);
      const centerY = (box.top + box.bottom) / 2;
      if (!surveyItem || (centerY >= surveyBox.top && centerY <= surveyBox.bottom)) {
        const target = document.elementFromPoint((box.left + box.right) / 2, centerY);
        if (target && !element.contains(target)) problems.push(`${describe(element)} is covered`);
      }
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
  const fields = body.querySelector('#patient-fields');
  const groups = survey ? [survey] : fields ? [...fields.querySelectorAll('.patient-field')] : [...body.children].filter(visible);
  if (fields) {
    const bounds = fields.getBoundingClientRect();
    const innerHeight = body.clientHeight - parseFloat(bodyStyle.paddingTop) - parseFloat(bodyStyle.paddingBottom);
    if (bounds.height < innerHeight - 1 || bounds.width < body.clientWidth - 1) {
      problems.push('Participant fields do not use the available form area');
    }
    const controlsByRow = new Map();
    for (const field of groups) {
      const { top } = field.getBoundingClientRect();
      const control = field.querySelector('input, select, output').getBoundingClientRect();
      const peer = controlsByRow.get(top);
      if (peer && ['top', 'bottom', 'width'].some(edge => Math.abs(peer[edge] - control[edge]) > 1)) {
        problems.push(field.htmlFor + ' does not align with the other control in its row');
      }
      controlsByRow.set(top, control);
    }
  }
  const actions = Array.from(footer.children).filter(visible).map(element => element.getBoundingClientRect());
  if (actions.length === 2 && Math.abs(actions[0].left - actions[1].left) > 1
    && ['top', 'bottom', 'width'].some(edge => Math.abs(actions[0][edge] - actions[1][edge]) > 1)) {
    problems.push('Footer actions do not share the same row dimensions');
  }
  const rows = new Map();
  for (const group of groups) {
    const box = group.getBoundingClientRect();
    rows.set(box.top, Math.max(box.bottom, rows.get(box.top) ?? 0));
  }
  const boxes = [...rows].sort(([left], [right]) => left - right);
  const gap = boxes.slice(1).reduce((sum, [top], index) => sum + Math.max(0, top - boxes[index][1]), 0);
  const contents = groups.map(element => element.id || element.htmlFor || element.textContent.trim() || describe(element));
  return { problems, bodyWidth: bodyBox.width, bodyHeight: bodyBox.height, gap, groups: rows.size, contents };
}
