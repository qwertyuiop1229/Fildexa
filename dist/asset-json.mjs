function describe(value) {
  if (Array.isArray(value)) return '配列 · ' + value.length;
  if (value && typeof value === 'object') return 'オブジェクト · ' + Object.keys(value).length;
  return JSON.stringify(value);
}

export function mountJson(pane, data, text, { element, input, pre }) {
  let rendered = 0;
  const search = input('キー・値を検索');
  const controls = element('div', undefined, 'asset-controls asset-json-controls');
  const count = element('output', describe(data), 'asset-reading');
  count.setAttribute('aria-live', 'polite');
  controls.append(search, count);
  const tree = element('div', undefined, 'asset-tree');
  const results = element('ul', undefined, 'asset-tree asset-json-results');
  const source = element('details', undefined, 'asset-json-source');
  source.append(element('summary', 'JSONソースを見る'), pre(text));

  function entry(key, value, depth) {
    if (++rendered > 700 || depth > 24) return element('p', '表示上限に達しました。', 'quiet');
    const label = key === undefined ? '' : JSON.stringify(key);
    if (value === null || typeof value !== 'object') {
      const row = element('p', undefined, 'asset-json-leaf');
      if (label) row.append(element('code', label, 'asset-json-key'), ': ');
      row.append(element('code', describe(value)));
      return row;
    }
    const group = element('details');
    const summary = element('summary');
    if (label) summary.append(element('code', label, 'asset-json-key'), ' ');
    summary.append(element('span', describe(value), 'quiet'));
    const children = element('div');
    group.append(summary, children);

    let drawn = false;
    function draw() {
      if (drawn || !group.open) return;
      drawn = true;
      const entries = Object.entries(value);
      for (const [name, item] of entries.slice(0, 120)) {
        if (rendered >= 700) {
          children.append(element('p', '表示上限に達しました。', 'quiet'));
          return;
        }
        children.append(entry(name, item, depth + 1));
      }
      if (entries.length > 120) children.append(element('p', '最初の120項目を表示中', 'quiet'));
    }
    group.open = depth === 0;
    group.addEventListener('toggle', draw);
    draw();
    return group;
  }

  search.oninput = () => {
    const query = search.value.trim().toLowerCase();
    tree.hidden = !!query;
    results.hidden = !query;
    results.replaceChildren();
    if (!query) {
      count.textContent = describe(data);
      return;
    }

    let visited = 0;
    let matches = 0;
    function walk(value, path, key) {
      if (matches >= 120 || visited >= 40_000 || path.length > 24) return;
      visited++;
      const container = value !== null && typeof value === 'object';
      const valueText = container ? '' : describe(value);
      if (key?.toLowerCase().includes(query) || valueText.toLowerCase().includes(query)) {
        matches++;
        const row = element('li');
        const address = path.map((part) => '[' + JSON.stringify(part) + ']').join('');
        row.append(element('code', '$' + address, 'asset-json-key'), element('code', describe(value)));
        results.append(row);
      }
      if (!container) return;
      for (const [child, item] of Object.entries(value)) {
        if (matches >= 120 || visited >= 40_000) break;
        walk(item, [...path, child], child);
      }
    }
    walk(data, [], undefined);
    count.textContent = matches + ' 件' + (matches >= 120 || visited >= 40_000 ? '（表示上限）' : '');
    if (!matches) results.append(element('li', '一致するキーや値がありません。', 'quiet'));
  };

  tree.append(entry(undefined, data, 0));
  results.hidden = true;
  pane.append(controls, tree, results, source);
}
