export function mountImage(pane, source, name, { element, button }) {
  const controls = element('div', undefined, 'asset-controls asset-image-controls');
  const zoom = element('div', undefined, 'asset-control-group');
  zoom.setAttribute('role', 'group');
  zoom.setAttribute('aria-label', '画像の拡大率');
  const fit = button('全体', () => scaleTo(null));
  const actual = button('100%', () => scaleTo(100));
  const out = button('−', () => scaleTo((scale ?? fitPercent()) - 25));
  const into = button('＋', () => scaleTo((scale ?? fitPercent()) + 25));
  out.setAttribute('aria-label', '縮小');
  into.setAttribute('aria-label', '拡大');
  const percentage = element('output', '全体表示', 'asset-reading');
  percentage.setAttribute('aria-label', '現在の画像表示倍率');
  zoom.append(fit, actual, out, into, percentage);

  const backgrounds = element('div', undefined, 'asset-control-group');
  backgrounds.setAttribute('role', 'group');
  backgrounds.setAttribute('aria-label', '画像の背景');
  const well = element('div', undefined, 'asset-image checker');
  well.dataset.fit = 'true';
  well.tabIndex = 0;
  well.setAttribute('aria-label', '画像表示領域');
  const surface = element('div', undefined, 'asset-image-surface');
  const image = element('img');
  image.alt = name;
  const info = element('p', '画像を読み込み中…', 'asset-status');
  info.setAttribute('role', 'status');
  let scale = null;
  let ready = false;

  for (const [label, className] of [['透明', 'checker'], ['明', 'light'], ['暗', 'dark']]) {
    const choice = button(label, () => {
      well.className = 'asset-image ' + className;
      for (const item of backgrounds.children) item.setAttribute('aria-pressed', String(item === choice));
    });
    choice.setAttribute('aria-pressed', String(className === 'checker'));
    backgrounds.append(choice);
  }
  controls.append(zoom, backgrounds);
  surface.append(image);
  well.append(surface);
  pane.append(controls, well, info);

  function fitPercent() {
    return Math.min(100, Math.floor(100 * Math.min(
      (well.clientWidth - 32) / image.naturalWidth,
      (well.clientHeight - 32) / image.naturalHeight,
    )));
  }

  function scaleTo(value) {
    scale = value === null ? null : Math.max(10, Math.min(400, value));
    well.dataset.fit = String(scale === null);
    image.style.width = scale === null ? '' : (image.naturalWidth * scale / 100) + 'px';
    fit.setAttribute('aria-pressed', String(scale === null));
    actual.setAttribute('aria-pressed', String(scale === 100));
    percentage.textContent = scale === null ? '全体表示' : scale + '%';
    out.disabled = !ready || (scale ?? fitPercent()) <= 10;
    into.disabled = !ready || scale === 400;
    fit.disabled = actual.disabled = !ready;
  }
  image.onload = () => {
    ready = true;
    scaleTo(null);
    info.textContent = image.naturalWidth + ' × ' + image.naturalHeight + ' px';
  };
  image.onerror = () => {
    well.hidden = true;
    info.textContent = 'このブラウザでは画像を表示できません。';
  };
  scaleTo(null);
  image.src = source;
}
