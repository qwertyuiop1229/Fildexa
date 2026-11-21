const maxRow = 1_048_576;
const maxColumn = 16_384;
export const sheetPage = { rows: 50, columns: 12 };
export const workbookFileLimit = 24 * 2 ** 20;

export function columnName(column) {
  let result = '';
  for (let position = column + 1; position > 0; position = Math.floor((position - 1) / 26)) {
    result = String.fromCharCode(65 + (position - 1) % 26) + result;
  }
  return result;
}

export const address = (row, column) => columnName(column) + (row + 1);

export function parseAddress(value) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/i.exec(value.trim());
  if (!match) return null;
  const column = Array.from(match[1].toUpperCase()).reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
  const row = Number(match[2]);
  return row <= maxRow && column <= maxColumn ? { r: row - 1, c: column - 1 } : null;
}

function validPoint(point) {
  return point && Number.isInteger(point.r) && point.r >= 0 && point.r < maxRow
    && Number.isInteger(point.c) && point.c >= 0 && point.c < maxColumn;
}

function validRange(range) {
  return validPoint(range?.s) && validPoint(range?.e) && range.s.r <= range.e.r && range.s.c <= range.e.c;
}

export function describeSheet(sheet) {
  const parts = sheet['!ref']?.split(':');
  const reference = parts && { s: parseAddress(parts[0]), e: parseAddress(parts[1] ?? parts[0]) };
  const merges = (sheet['!merges'] ?? []).filter(validRange);
  let range = validRange(reference) ? reference : null;
  if (range && range.s.r === range.e.r && range.s.c === range.e.c && !sheet[address(range.s.r, range.s.c)]) {
    range = null;
  }
  for (const merge of merges) {
    range = range ? {
      s: { r: Math.min(range.s.r, merge.s.r), c: Math.min(range.s.c, merge.s.c) },
      e: { r: Math.max(range.e.r, merge.e.r), c: Math.max(range.e.c, merge.e.c) },
    } : merge;
  }
  return { range, merges };
}

function projectCell(cell) {
  const formula = cell?.f ? '=' + cell.f.slice(0, 8_192) : '';
  const value = cell?.v;
  const formatted = value == null ? '' : String(cell.w ?? value);
  return {
    text: formatted.slice(0, 2_048), truncated: formatted.length > 2_048,
    formula,
    noResult: !!formula && value == null,
    type: ['n', 'b', 'e'].includes(cell?.t) ? cell.t : '',
  };
}

export function buildSheetWindow(sheet, { range, merges }, target) {
  if (!range) return { range, cells: [] };
  const { s, e } = range;
  const safe = (value, start, end) => Number.isInteger(value) ? Math.max(start, Math.min(end, value)) : start;
  const pageStart = (value, start, end, size) => start + Math.floor((safe(value, start, end) - start) / size) * size;
  const row = pageStart(target?.r, s.r, e.r, sheetPage.rows);
  const column = pageStart(target?.c, s.c, e.c, sheetPage.columns);
  const height = Math.min(sheetPage.rows, e.r - row + 1);
  const width = Math.min(sheetPage.columns, e.c - column + 1);
  const lastRow = row + height - 1;
  const lastColumn = column + width - 1;
  const cells = Array.from({ length: height }, () => Array(width).fill(null));
  const read = (r, c) => projectCell(sheet[address(r, c)]);

  for (const merge of merges) {
    const startRow = Math.max(row, merge.s.r);
    const startColumn = Math.max(column, merge.s.c);
    const endRow = Math.min(lastRow, merge.e.r);
    const endColumn = Math.min(lastColumn, merge.e.c);
    if (startRow > endRow || startColumn > endColumn) continue;

    let overlaps = false;
    for (let r = startRow; r <= endRow && !overlaps; r++) {
      for (let c = startColumn; c <= endColumn; c++) {
        if (cells[r - row][c - column] !== null) {
          overlaps = true;
          break;
        }
      }
    }
    if (overlaps) continue;
    const item = {
      ...read(merge.s.r, merge.s.c),
      r: startRow, c: startColumn, height: endRow - startRow + 1, width: endColumn - startColumn + 1,
      name: address(merge.s.r, merge.s.c),
      merged: address(merge.s.r, merge.s.c) + ':' + address(merge.e.r, merge.e.c),
    };
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startColumn; c <= endColumn; c++) cells[r - row][c - column] = false;
    }
    cells[startRow - row][startColumn - column] = item;
  }

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const absoluteRow = row + r;
      const absoluteColumn = column + c;
      cells[r][c] ??= {
        ...read(absoluteRow, absoluteColumn),
        r: absoluteRow, c: absoluteColumn, height: 1, width: 1, name: address(absoluteRow, absoluteColumn),
      };
    }
  }
  return { range, row, column, height, width, cells };
}
