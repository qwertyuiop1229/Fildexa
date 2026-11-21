import { wordChild, wordChildren, wordElement, wordFlag, wordValue } from './docx-package.mjs';

const wrappers = new Set(['customXml', 'ins', 'moveTo', 'sdtContent', 'smartTag']);
const inlineWrappers = new Set([...wrappers, 'hyperlink', 'fldSimple']);

function* storedBlocks(root, names, depth = 0) {
  if (depth > 24) return;
  for (const node of wordChildren(root)) {
    if (names.has(node.localName)) yield node;
    else if (node.localName === 'sdt') yield* storedBlocks(wordChild(node, 'sdtContent'), names, depth + 1);
    else if (wrappers.has(node.localName)) yield* storedBlocks(node, names, depth + 1);
  }
}

const blockTypes = new Set(['p', 'tbl', 'altChunk']);
const rowTypes = new Set(['tr']);
const cellTypes = new Set(['tc']);
export const documentBlocks = (root) => storedBlocks(root, blockTypes);

function* storedRuns(root, depth = 0) {
  if (depth > 24) return;
  for (const node of wordChildren(root)) {
    if (node.localName === 'r') yield node;
    else if (node.localName === 'sdt') yield* storedRuns(wordChild(node, 'sdtContent'), depth + 1);
    else if (inlineWrappers.has(node.localName)) yield* storedRuns(node, depth + 1);
  }
}

function runText(part) {
  switch (part.localName) {
    case 't': return part.textContent;
    case 'tab': return '\t';
    case 'br':
    case 'cr': return '\n';
    case 'noBreakHyphen': return '‑';
    case 'softHyphen': return '\u00ad';
    default: return '';
  }
}

export function headingText(paragraph) {
  let text = '';
  for (const run of storedRuns(paragraph)) {
    for (const part of wordChildren(run)) {
      text += runText(part);
      if (text.length > 180) return text.slice(0, 180).trim().replace(/\s+/g, ' ') + '…';
    }
  }
  return text.trim().replace(/\s+/g, ' ');
}

function runHTML(run, styles, element) {
  const content = document.createDocumentFragment();
  for (const part of wordChildren(run)) {
    if (['drawing', 'pict', 'object'].includes(part.localName)) {
      content.append(element('span', '［図版］', 'docx-omission'));
    } else {
      const value = runText(part);
      if (value) content.append(value);
    }
  }
  if (!content.hasChildNodes()) return content;
  const props = wordChild(run, 'rPr');
  const inherited = styles.character(wordValue(wordChild(props, 'rStyle')));
  const property = (name) => wordChild(props, name) ?? wordChild(inherited, name);
  const underline = property('u');
  let result = content;
  for (const [include, tag] of [
    [wordFlag(property('b')), 'strong'],
    [wordFlag(property('i')), 'em'],
    [wordFlag(underline) && wordValue(underline) !== 'none', 'u'],
    [wordFlag(property('strike')), 's'],
  ]) {
    if (include) {
      const parent = element(tag);
      parent.append(result);
      result = parent;
    }
  }
  return result;
}

function inheritedAlignment(paragraph) {
  const alignment = wordValue(wordChild(wordChild(paragraph, 'pPr'), 'jc'));
  if (alignment === 'center') return 'center';
  if (alignment === 'right' || alignment === 'end') return 'end';
  return '';
}

function paragraphHTML(paragraph, { styles, element }, level) {
  const node = element(level ? 'h' + Math.min(level, 6) : 'p', undefined, 'docx-paragraph');
  if (level) {
    node.classList.add('docx-heading');
    node.dataset.level = String(level);
    if (level > 6) node.setAttribute('aria-level', String(level));
  }
  const align = inheritedAlignment(paragraph);
  if (align) node.dataset.align = align;
  for (const run of storedRuns(paragraph)) node.append(runHTML(run, styles, element));
  if (!node.hasChildNodes()) node.append(element('br'));
  return node;
}

function boundedInteger(value, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : min;
}

function tableHTML(table, context, depth) {
  const { element } = context;
  const wrap = element('div', undefined, 'docx-table-block');
  if (depth >= 3 || context.cellsLeft < 1) {
    wrap.append(element('p', '表の一部は元の文書で確認できます。', 'docx-omission'));
    return wrap;
  }

  const scroll = element('div', undefined, 'docx-table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', '文書内の表');
  const domTable = element('table', undefined, 'docx-table');
  const body = element('tbody');
  let previous = new Map();
  let rowCount = 0;
  let clipped = false;

  for (const row of storedBlocks(table, rowTypes)) {
    if (rowCount >= 400 || context.cellsLeft < 1) {
      clipped = true;
      break;
    }
    rowCount++;
    const properties = wordChild(row, 'trPr');
    const heading = wordFlag(wordChild(properties, 'tblHeader'));
    const tr = element('tr');
    const active = new Map();
    let column = boundedInteger(wordValue(wordChild(properties, 'gridBefore')), 0, 79);
    if (column) {
      const gap = element('td');
      gap.colSpan = column;
      gap.setAttribute('aria-hidden', 'true');
      tr.append(gap);
    }

    for (const cell of storedBlocks(row, cellTypes)) {
      if (column >= 80 || context.cellsLeft < 1) {
        clipped = true;
        break;
      }
      context.cellsLeft--;
      const props = wordChild(cell, 'tcPr');
      const span = boundedInteger(wordValue(wordChild(props, 'gridSpan')), 1, 80 - column);
      const merge = wordChild(props, 'vMerge');
      const old = previous.get(column);
      if (merge && wordValue(merge) !== 'restart' && old?.span === span) {
        old.node.rowSpan++;
        active.set(column, old);
      } else {
        const node = element(heading ? 'th' : 'td');
        node.colSpan = span;
        if (heading) node.scope = span > 1 ? 'colgroup' : 'col';
        for (const child of documentBlocks(cell)) node.append(blockHTML(child, context, depth + 1));
        tr.append(node);
        if (merge && wordValue(merge) === 'restart') active.set(column, { node, span });
      }
      column += span;
    }
    body.append(tr);
    previous = active;
  }
  if (rowCount) {
    domTable.append(body);
    scroll.append(domTable);
    const hint = element('p', '表は横にスクロールできます。', 'docx-table-hint');
    hint.hidden = true;
    wrap.append(hint, scroll);
    context.observeTable(scroll, hint);
  }
  if (clipped) wrap.append(element('p', '表の表示上限を超えた部分は元の文書で確認できます。', 'docx-omission'));
  return wrap;
}

export function blockHTML(block, context, depth = 0, level = null) {
  if (wordElement(block, 'tbl')) return tableHTML(block, context, depth);
  if (wordElement(block, 'p')) return paragraphHTML(block, context, level);
  return context.element('p', '埋め込みコンテンツは元の文書で確認できます。', 'docx-omission');
}
