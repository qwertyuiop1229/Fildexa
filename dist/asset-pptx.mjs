import { createPicker } from './picker.mjs';
import { enterContent } from './motion.mjs';
import { readPresentation } from './pptx-package.mjs';

export function mountPresentation(file, pane, { element, button }) {
  const status = element('p', 'スライドを読み込み中…', 'asset-status');
  status.setAttribute('role', 'status');
  pane.append(status);

  const viewer = element('section', undefined, 'pptx-view');
  viewer.setAttribute('aria-label', 'PPTXビューアー');
  const toolbar = element('div', undefined, 'pptx-toolbar');
  const pagination = element('div', undefined, 'format-control-group');
  const previous = button('‹', () => void show(index - 1));
  previous.setAttribute('aria-label', '前のスライド');
  const next = button('›', () => void show(index + 1));
  next.setAttribute('aria-label', '次のスライド');
  const label = element('span', 'スライド', 'sr-only');
  label.id = 'pptx-slide-label';
  const select = element('div');
  select.id = 'pptx-slide-select';
  const picker = createPicker(select, label.id, (value) => void show(Number(value)));
  pagination.append(previous, label, select, next);
  const views = element('div', undefined, 'format-control-group');
  const visual = button('スライド', () => changeView(false));
  const readable = button('テキスト', () => changeView(true));
  views.append(visual, readable);
  toolbar.append(pagination, views);
  const stage = element('div', undefined, 'pptx-stage');
  stage.tabIndex = 0;
  stage.setAttribute('role', 'region');
  stage.setAttribute('aria-label', 'スライド表示');
  const reading = element('article', undefined, 'pptx-text');
  reading.setAttribute('aria-label', 'スライドのテキスト');
  const detail = element('p', '', 'asset-status pptx-title');
  detail.setAttribute('role', 'status');
  viewer.append(toolbar, detail, stage, reading);
  let deck, index = 0, seq = 0;
  let disposed = false;
  const images = new Set();
  let fitFrame;
  const measure = new ResizeObserver(() => {
    if (fitFrame) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = null;
      fitStage();
    });
  });
  measure.observe(pane);
  measure.observe(toolbar);
  measure.observe(detail);

  function fitStage() {
    if (!deck) return;
    const space = Math.max(135, pane.clientHeight - toolbar.offsetHeight - detail.offsetHeight - 65);
    const width = Math.floor(space * deck.width / deck.height) + 'px';
    if (stage.style.getPropertyValue('--pptx-fit') !== width) stage.style.setProperty('--pptx-fit', width);
  }

  function clearImages() {
    for (const url of images) URL.revokeObjectURL(url);
    images.clear();
  }

  function changeView(asText) {
    visual.setAttribute('aria-pressed', String(!asText));
    readable.setAttribute('aria-pressed', String(asText));
    stage.hidden = asText;
    reading.hidden = !asText;
  }

  function textBlock(paragraphs, canvas, level = false) {
    const container = element('div');
    for (const paragraph of paragraphs) {
      const row = element(level && !container.children.length ? 'h3' : 'p');
      if (paragraph.align && canvas) row.style.textAlign = paragraph.align;
      for (const run of paragraph.runs) {
        const span = element('span', run.text);
        if (run.bold) span.style.fontWeight = '750';
        if (run.italic) span.style.fontStyle = 'italic';
        if (canvas && run.size) span.style.fontSize = run.size * 1_270_000 / deck.width + 'cqw';
        if (canvas && run.color) span.style.color = run.color;
        row.append(span);
      }
      container.append(row);
    }
    return container;
  }

  function renderTable(rows, canvas) {
    const table = element('table', undefined, 'pptx-table');
    const tbody = element('tbody');
    for (const row of rows) {
      const tr = element('tr');
      for (const value of row) {
        const td = element('td');
        td.colSpan = value.columns;
        td.rowSpan = value.rows;
        if (canvas && value.color) td.style.backgroundColor = value.color;
        td.append(textBlock(value.paragraphs, canvas));
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    const wrap = element('div', undefined, 'pptx-table-wrap');
    wrap.append(table);
    return wrap;
  }

  async function show(position) {
    if (!deck || position < 0 || position >= deck.count) return;
    index = position;
    const turn = ++seq;
    stage.setAttribute('aria-busy', 'true');
    clearImages();
    stage.replaceChildren();
    reading.replaceChildren();
    previous.disabled = index === 0;
    next.disabled = index === deck.count - 1;
    const page = (index + 1) + ' / ' + deck.count;
    picker.value(String(index));
    detail.textContent = page + ' · 読み込み中…';
    try {
      const model = await deck.slide(position);
      if (disposed || turn !== seq) return;
      detail.textContent = page + (model.title ? ' · ' + model.title : '') + (model.hidden ? '（非表示スライド）' : '');
      stage.style.aspectRatio = deck.width + ' / ' + deck.height;
      stage.style.backgroundColor = model.background;
      stage.style.color = model.textColor ?? '#202b39';
      let imageCount = 0;
      let imageBytes = 0;
      for (const item of model.visuals) {
        const box = element('div', undefined, 'pptx-box');
        const bounds = item.bounds;
        Object.assign(box.style, {
          left: bounds.x * 100 / deck.width + '%', top: bounds.y * 100 / deck.height + '%',
          width: bounds.w * 100 / deck.width + '%', height: bounds.h * 100 / deck.height + '%',
          transform: item.rotation ? 'rotate(' + item.rotation + 'deg)' : '',
          fontSize: (item.isHeading ? 36 : 21) * 1_270_000 / deck.width + 'cqw',
          backgroundColor: item.fill ?? '',
          borderRadius: item.circle ? '50%' : item.rounded ? '10%' : '',
        });
        if (item.center) box.classList.add('pptx-centered');
        if (item.centerTitle) box.classList.add('pptx-center-title');
        if (item.content.length) {
          box.append(textBlock(item.content, true));
          reading.append(textBlock(item.content, false, item.isHeading));
        }
        if (item.rows) {
          box.append(renderTable(item.rows, true));
          reading.append(renderTable(item.rows, false));
        }
        if (item.image && imageCount++ < 12 && imageBytes < 16 * 2 ** 20) {
          try {
            const blob = await deck.image(item.image);
            if (disposed || turn !== seq) return;
            if (blob && imageBytes + blob.size <= 16 * 2 ** 20) {
              imageBytes += blob.size;
              const url = URL.createObjectURL(blob);
              images.add(url);
              const image = element('img');
              image.src = url;
              image.alt = '';
              box.append(image);
            }
          } catch {
            if (disposed || turn !== seq) return;
          }
        }
        stage.append(box);
      }
      if (!reading.children.length) reading.append(element('p', 'このスライドに表示できるテキストや表はありません。', 'asset-status'));
      stage.setAttribute('aria-busy', 'false');
      const asText = readable.getAttribute('aria-pressed') === 'true';
      changeView(asText);
      enterContent(asText ? reading : stage, { duration: 130, y: 2 });
    } catch {
      if (disposed || turn !== seq) return;
      stage.setAttribute('aria-busy', 'false');
      detail.textContent = page + ' · このスライドを読み込めませんでした。';
    }
  }

  viewer.onkeydown = (event) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)
        || select.contains(event.target) || !deck) return;
    event.preventDefault();
    const positions = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: deck.count - 1 };
    void show(positions[event.key]);
  };

  void (async () => {
    try {
      deck = await readPresentation(file);
      if (disposed) return;
      pane.replaceChildren(viewer);
      fitStage();
      stage.style.aspectRatio = deck.width + ' / ' + deck.height;
      changeView(false);
      picker.set(Array.from({ length: deck.count }, (_, i) => ({ value: String(i), label: (i + 1) + ' / ' + deck.count })), '0');
      if (deck.clipped) viewer.append(element('p', '先頭500枚を確認できます。続きは元の資料で確認してください。', 'asset-status'));
      void show(0);
    } catch (error) {
      if (disposed) return;
      status.textContent = error?.message === 'file-limit'
        ? 'このビューアーで開けるPPTXは48 MBまでです。'
        : 'PPTXを読み込めませんでした。元の資料は「ダウンロード」から開けます。';
    }
  })();

  return () => {
    disposed = true;
    measure.disconnect();
    if (fitFrame) cancelAnimationFrame(fitFrame);
    picker.destroy();
    clearImages();
  };
}
