import { createPicker } from './picker.mjs';
import { encodeCsv, downloadBlob } from './asset-data.mjs';
import { enterContent } from './motion.mjs';

export function mountSqlite(file, pane, { element, button }) {
  const status = element('p', 'データベースを読み込み中…', 'asset-status');
  status.setAttribute('role', 'status');
  pane.append(status);
  if (file.size > 64 * 2 ** 20) {
    status.textContent = 'SQLiteファイルは64 MBまでです。';
    return () => {};
  }

  const viewer = element('section', undefined, 'sqlite-view');
  viewer.setAttribute('aria-label', 'SQLiteビューアー');
  const controls = element('div', undefined, 'format-controls sqlite-controls');
  const label = element('span', 'テーブル', 'format-label');
  label.id = 'sqlite-table-label';
  const select = element('div');
  select.id = 'sqlite-table-select';
  const search = element('input');
  search.type = 'search';
  search.placeholder = 'このページ内を検索';
  search.setAttribute('aria-label', search.placeholder);
  const exportRows = button('表示行をCSV保存', () => {
    if (!page) return;
    const csv = encodeCsv(page.columns, filtered());
    downloadBlob(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), 'fildexa-rows.csv');
  });
  controls.append(label, select, search, exportRows);
  const grid = element('div', undefined, 'sqlite-grid');
  grid.setAttribute('role', 'region');
  grid.setAttribute('aria-label', 'テーブルのデータ');
  grid.tabIndex = 0;
  const navigation = element('div', undefined, 'format-controls');
  const prev = button('前の50行', () => query(index, offset - 50));
  const next = button('次の50行', () => query(index, offset + 50));
  const range = element('span', '', 'format-label');
  range.setAttribute('role', 'status');
  navigation.append(prev, range, next);
  viewer.append(controls, grid, navigation);
  const picker = createPicker(select, label.id, (value) => {
    search.value = '';
    query(Number(value), 0);
  });
  let worker, timer, index = 0, offset = 0, request = 0;
  let disposed = false;
  let page;

  function filtered() {
    const query = search.value.trim().toLowerCase();
    return page.rows.filter((row) => !query || row.some((cell) => String(cell ?? '').toLowerCase().includes(query)));
  }

  function render() {
    if (!page) return;
    const table = element('table', undefined, 'asset-table');
    const headings = element('thead');
    const header = element('tr');
    for (const name of page.columns) {
      const cell = element('th', name);
      cell.scope = 'col';
      header.append(cell);
    }
    headings.append(header);
    const body = element('tbody');
    const shown = filtered();
    for (const values of shown) {
      const row = element('tr');
      for (const value of values) row.append(element('td', value == null ? 'NULL' : String(value), value == null ? 'quiet' : ''));
      body.append(row);
    }
    table.append(headings, body);
    grid.replaceChildren(table);
    if (!shown.length) grid.append(element('p', search.value ? '一致する行がありません。' : '行がありません。', 'sqlite-empty'));
    range.textContent = (page.rows.length ? offset + 1 + '–' + (offset + page.rows.length) + ' 行' : '0 行')
      + (search.value ? ' · 表示 ' + shown.length + ' 件' : '')
      + (page.moreColumns ? ' · 先頭30列を表示' : '');
    exportRows.disabled = !shown.length;
  }
  search.oninput = render;

  function requestWorker(message, transfer) {
    clearTimeout(timer);
    timer = setTimeout(() => failure('読み込みに時間がかかりすぎたため停止しました。'), 20_000);
    worker.postMessage({ id: ++request, ...message }, transfer);
  }

  function query(table, start) {
    index = table;
    offset = Math.max(0, start);
    page = null;
    prev.disabled = next.disabled = exportRows.disabled = true;
    status.textContent = '行を読み込み中…';
    grid.setAttribute('aria-busy', 'true');
    requestWorker({ action: 'page', index, offset });
  }

  function failure(text) {
    worker?.terminate();
    clearTimeout(timer);
    picker.close();
    viewer.remove();
    status.textContent = text;
  }

  void (async () => {
    try {
      const bytes = await file.arrayBuffer();
      if (disposed) return;
      worker = new Worker(new URL('./sqlite-worker.js', import.meta.url));
      worker.onerror = () => failure('SQLiteビューアーを起動できませんでした。');
      worker.onmessage = ({ data }) => {
        if (disposed || request !== data.id) return;
        clearTimeout(timer);
        if (data.error) {
          failure('SQLiteを読み込めませんでした。ファイル形式をご確認ください。');
        } else if (data.tables) {
          if (!data.tables.length) {
            failure('表示できるテーブルがありません。');
            return;
          }
          pane.append(viewer);
          picker.set(data.tables.map((name, id) => ({ value: String(id), label: name })), '0');
          if (data.clipped) viewer.append(element('p', '先頭500テーブルを表示します。', 'asset-status'));
          query(0, 0);
        } else {
          page = data.page;
          status.textContent = '';
          grid.setAttribute('aria-busy', 'false');
          prev.disabled = offset === 0;
          next.disabled = !page.hasMore;
          render();
          enterContent(grid, { duration: 115, y: 1 });
        }
      };
      requestWorker({ action: 'open', bytes }, [bytes]);
    } catch {
      if (!disposed) failure('SQLiteを読み込めませんでした。');
    }
  })();

  return () => {
    disposed = true;
    clearTimeout(timer);
    picker.destroy();
    worker?.terminate();
  };
}
