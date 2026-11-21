import { createPicker } from './picker.mjs';
import { enterContent } from './motion.mjs';
import { address, columnName, parseAddress, sheetPage, workbookFileLimit } from './sheet-grid.mjs';

const workbookErrors = {
  'file-limit': 'このビューアーで開けるXLSXは24 MBまでです。',
  'expanded-limit': '展開後のサイズがビューアーの上限を超えています。',
  format: 'XLSXを読み込めませんでした。ファイルの形式やパスワード設定を確認してください。',
  timeout: '読み込みに時間がかかりすぎたため停止しました。',
};

export function mountSheet(file, pane, { element, button }) {
  const status = element('p', 'ブックを読み込み中…', 'asset-status sheet-status');
  status.setAttribute('role', 'status');
  pane.append(status);
  if (file.size > workbookFileLimit) {
    status.textContent = workbookErrors['file-limit'];
    return () => {};
  }

  pane.classList.add('asset-sheet-content');
  const viewer = element('section', undefined, 'sheet-view');
  viewer.hidden = true;
  viewer.setAttribute('aria-label', 'XLSXビューアー');
  pane.append(viewer);
  const toolbar = element('div', undefined, 'sheet-toolbar');
  const selector = element('div', undefined, 'sheet-selector');
  const sheetLabel = element('span', 'シート', 'sheet-label');
  sheetLabel.id = 'asset-sheet-label';
  const pickerHost = element('div', undefined, 'sheet-picker');
  pickerHost.id = 'asset-sheet-picker';
  const picker = createPicker(pickerHost, sheetLabel.id, (value) => {
    index = Number(value);
    loadPage();
  });
  selector.append(sheetLabel, pickerHost);

  const jump = element('form', undefined, 'sheet-jump');
  const jumpField = element('input');
  jumpField.type = 'text';
  jumpField.placeholder = '例 A150';
  jumpField.maxLength = 12;
  jumpField.autocomplete = 'off';
  jumpField.autocapitalize = 'characters';
  jumpField.spellcheck = false;
  jumpField.setAttribute('aria-label', '移動先のセル');
  const jumpButton = button('移動');
  jumpButton.type = 'submit';
  jump.append(jumpField, jumpButton);
  toolbar.append(selector, jump);

  const formulaBar = element('div', undefined, 'sheet-formula');
  const cellName = element('span', '—', 'sheet-address');
  const cellKind = element('span', '', 'sheet-cell-kind');
  const cellValue = element('code', '', 'sheet-cell-value');
  formulaBar.append(cellName, cellKind, cellValue);
  formulaBar.setAttribute('role', 'status');

  const grid = element('div', undefined, 'sheet-scroll');
  grid.tabIndex = 0;
  grid.setAttribute('role', 'region');
  grid.setAttribute('aria-label', 'ワークシートの表');
  const pager = element('div', undefined, 'sheet-pagers');
  const rowPager = createPager('行', 'row', 'r', sheetPage.rows);
  const columnPager = createPager('列', 'column', 'c', sheetPage.columns);
  pager.append(rowPager.node, columnPager.node);
  const note = element('p', '数式はブックに保存された結果を表示します。', 'sheet-note');
  viewer.append(toolbar, formulaBar, grid, pager, note);

  let index = 0;
  let worker;
  let timer;
  let current;
  let request = 0;
  let disposed = false;
  let selected;
  let coordinates;
  let pending = false;

  function createPager(label, startKey, coordinate, size) {
    const node = element('div', undefined, 'sheet-pager');
    node.setAttribute('role', 'group');
    node.setAttribute('aria-label', label + 'の表示範囲');
    const range = element('output', '—', 'sheet-range');
    range.setAttribute('aria-live', 'polite');
    const change = (direction) => {
      if (pending || !current?.range) return;
      const destination = current[startKey] + direction * size;
      if (destination < current.range.s[coordinate] || destination > current.range.e[coordinate]) return;
      loadPage({ r: current.row, c: current.column, [coordinate]: destination });
    };
    const prev = button('‹', () => change(-1));
    const next = button('›', () => change(1));
    prev.setAttribute('aria-label', '前の' + label + '範囲');
    next.setAttribute('aria-label', '次の' + label + '範囲');
    node.append(element('span', label, 'sheet-label'), prev, range, next);
    return {
      node,
      update(page) {
        const start = page[startKey];
        const count = coordinate === 'r' ? page.height : page.width;
        const name = coordinate === 'r' ? (value) => String(value + 1) : columnName;
        range.textContent = page.range ? name(start) + '–' + name(start + count - 1) : '—';
        prev.disabled = !page.range || start <= page.range.s[coordinate];
        next.disabled = !page.range || start + count > page.range.e[coordinate];
      },
    };
  }

  function select(item, focus = false) {
    if (selected) {
      selected.node.tabIndex = -1;
      selected.node.classList.remove('sheet-selected');
    }
    selected = item;
    cellName.textContent = item?.value.name ?? '—';
    const value = item?.value;
    cellKind.textContent = value?.formula ? 'fx' : value?.merged ? '結合' : '値';
    const display = value?.formula || (value?.text ? value.text + (value.truncated ? '…' : '') : value ? '空のセル' : '');
    cellValue.textContent = display + (value?.merged ? '　[' + value.merged + ']' : '');
    cellValue.title = value?.truncated ? 'セルの先頭2,048文字を表示' : '';
    if (value?.noResult) cellValue.textContent += '　·　保存結果なし';
    if (!item) return;
    item.node.tabIndex = 0;
    item.node.classList.add('sheet-selected');
    if (focus) {
      item.node.focus({ preventScroll: true });
      reveal(item.node);
    }
  }

  function reveal(node) {
    const cell = node.getBoundingClientRect();
    const bounds = grid.getBoundingClientRect();
    const left = bounds.left + grid.querySelector('tbody th').offsetWidth;
    const top = bounds.top + grid.querySelector('thead').offsetHeight;
    const right = bounds.left + grid.clientWidth;
    const bottom = bounds.top + grid.clientHeight;
    if (cell.left < left) grid.scrollLeft += cell.left - left;
    else if (cell.right > right) grid.scrollLeft += Math.min(cell.left - left, cell.right - right);
    if (cell.top < top) grid.scrollTop += cell.top - top;
    else if (cell.bottom > bottom) grid.scrollTop += Math.min(cell.top - top, cell.bottom - bottom);
  }

  function render(page, destination) {
    current = page;
    coordinates = new Map();
    rowPager.update(page);
    columnPager.update(page);
    jumpField.disabled = jumpButton.disabled = !page.range;

    if (!page.range) {
      grid.replaceChildren(element('p', 'このシートにはセルデータがありません。', 'sheet-empty'));
      select(null);
      return;
    }

    const table = element('table', undefined, 'sheet-table');
    table.style.setProperty('--sheet-columns', String(page.width));
    const colgroup = element('colgroup');
    colgroup.append(element('col', undefined, 'sheet-index-column'));
    const header = element('tr');
    const corner = element('th');
    corner.setAttribute('aria-hidden', 'true');
    header.append(corner);
    for (let c = 0; c < page.width; c++) {
      colgroup.append(element('col', undefined, 'sheet-data-column'));
      const heading = element('th', columnName(page.column + c));
      heading.scope = 'col';
      header.append(heading);
    }
    const head = element('thead');
    head.append(header);
    const body = element('tbody');
    let first;
    for (const [offset, values] of page.cells.entries()) {
      const row = element('tr');
      const rowHead = element('th', String(page.row + offset + 1));
      rowHead.scope = 'row';
      row.append(rowHead);
      for (const value of values) {
        if (!value) continue;
        const cell = element('td', undefined, 'sheet-cell');
        cell.tabIndex = -1;
        cell.colSpan = value.width;
        cell.rowSpan = value.height;
        cell.dataset.type = value.type;
        if (value.formula) cell.dataset.formula = '';
        if (value.merged) cell.dataset.merged = '';
        const text = value.text || (value.noResult ? '—' : '');
        cell.append(element('span', text, 'sheet-cell-text'));
        cell.setAttribute('aria-label', [value.name, text, value.formula ? '数式あり' : ''].filter(Boolean).join(' '));
        const item = { node: cell, value };
        first ??= item;
        cell.onclick = () => select(item, true);
        cell.onkeydown = (event) => {
          const directions = {
            ArrowLeft: [value.r, value.c - 1],
            ArrowRight: [value.r, value.c + value.width],
            ArrowUp: [value.r - 1, value.c],
            ArrowDown: [value.r + value.height, value.c],
          };
          if (!directions[event.key]) return;
          event.preventDefault();
          const [r, c] = directions[event.key];
          const next = coordinates.get(address(r, c));
          if (next) select(next, true);
          else if (r >= page.range.s.r && r <= page.range.e.r && c >= page.range.s.c && c <= page.range.e.c) {
            loadPage({ r, c, focus: true });
          }
        };
        for (let r = value.r; r < value.r + value.height; r++) {
          for (let c = value.c; c < value.c + value.width; c++) coordinates.set(address(r, c), item);
        }
        row.append(cell);
      }
      body.append(row);
    }
    table.append(colgroup, head, body);
    grid.replaceChildren(table);
    grid.scrollTop = grid.scrollLeft = 0;
    const target = destination && coordinates.get(address(destination.r, destination.c));
    select(target ?? first, !!destination?.focus);
    if (target && !destination.focus) reveal(target.node);
    enterContent(table, { duration: 115, y: 2 });
  }

  function terminate() {
    clearTimeout(timer);
    worker?.terminate();
  }

  function failure(message) {
    terminate();
    picker.close();
    status.dataset.alert = '';
    status.textContent = message + ' 元ファイルは「ダウンロード」から開けます。';
    viewer.hidden = true;
  }

  function send(payload, transfer) {
    clearTimeout(timer);
    timer = setTimeout(() => failure(workbookErrors.timeout), 20_000);
    worker.postMessage({ request: ++request, ...payload }, transfer);
  }

  let destination;
  function loadPage(target) {
    destination = target;
    pending = true;
    grid.setAttribute('aria-busy', 'true');
    jumpField.removeAttribute('aria-invalid');
    delete status.dataset.alert;
    status.textContent = 'シートを読み込み中…';
    send({ action: 'page', index, target });
  }

  jump.onsubmit = (event) => {
    event.preventDefault();
    if (pending || !current?.range) return;
    const target = parseAddress(jumpField.value);
    const { s, e } = current.range;
    if (!target || target.r < s.r || target.r > e.r || target.c < s.c || target.c > e.c) {
      jumpField.setAttribute('aria-invalid', 'true');
      status.dataset.alert = '';
      status.textContent = 'セル番地を ' + address(s.r, s.c) + '～' + address(e.r, e.c) + ' の範囲で入力してください。';
      jumpField.focus();
      return;
    }
    loadPage(target);
  };
  jumpField.oninput = () => {
    if (!jumpField.hasAttribute('aria-invalid')) return;
    delete status.dataset.alert;
    jumpField.removeAttribute('aria-invalid');
    status.textContent = '';
  };

  void (async () => {
    try {
      const bytes = await file.arrayBuffer();
      if (disposed) return;
      worker = new Worker(new URL('./sheet-worker.mjs', import.meta.url), { type: 'module' });
      worker.onerror = () => failure(workbookErrors.format);
      worker.onmessage = ({ data }) => {
        if (disposed || data.request !== request) return;
        clearTimeout(timer);
        if (data.error) {
          failure(workbookErrors[data.error] ?? workbookErrors.format);
        } else if (data.sheets) {
          const sheets = data.sheets;
          index = Math.max(0, sheets.findIndex((sheet) => !sheet.hidden));
          picker.set(sheets.map((sheet, i) => ({
            value: String(i),
            label: sheet.name + (sheet.hidden ? '（非表示）' : ''),
          })), String(index));
          loadPage();
        } else {
          pending = false;
          grid.setAttribute('aria-busy', 'false');
          status.textContent = '';
          status.classList.add('sheet-live');
          viewer.hidden = false;
          render(data.page, destination);
        }
      };
      send({ action: 'open', bytes }, [bytes]);
    } catch {
      if (!disposed) failure(workbookErrors.format);
    }
  })();

  return () => {
    disposed = true;
    terminate();
    picker.destroy();
  };
}
