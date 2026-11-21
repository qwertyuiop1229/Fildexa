import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSheetWindow, columnName, describeSheet, parseAddress } from '../dist/sheet-grid.mjs';
import { read, utils, write } from '../dist/vendor/sheetjs/xlsx.mjs';

test('limits Excel cell addresses to the XLSX grid', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(26), 'AA');
  assert.deepEqual(parseAddress(' $XFD$1048576 '), { r: 1_048_575, c: 16_383 });
  for (const address of ['XFE1', 'A1048577', 'A0', '1A', 'A1:B2']) {
    assert.equal(parseAddress(address), null);
  }
});

test('clips merged spans across row and column pages while retaining the original cell', () => {
  const sheet = {
    '!ref': 'A1:AA125',
    '!merges': [{ s: { r: 47, c: 11 }, e: { r: 51, c: 13 } }],
    L48: { t: 's', v: 'merged record' },
    AA125: { t: 's', v: 'last record' },
  };
  const dimensions = describeSheet(sheet);
  const first = buildSheetWindow(sheet, dimensions);
  assert.equal(first.cells.length, 50);
  assert.equal(first.cells[47][11].height, 3);
  assert.equal(first.cells[48][11], false);

  const page = buildSheetWindow(sheet, dimensions, parseAddress('M51'));
  assert.equal(page.cells[0][0].merged, 'L48:N52');
  assert.equal(page.cells[0][0].text, 'merged record');
  assert.equal(page.cells[0][0].width, 2);
  assert.equal(page.cells[0][0].height, 2);
  assert.equal(page.cells[1][1], false);

  const end = buildSheetWindow(sheet, dimensions, parseAddress('AA125'));
  assert.equal(end.cells[24][2].text, 'last record');
  assert.equal(end.height, 25);
  assert.equal(end.width, 3);
  assert.equal(describeSheet({ '!ref': 'A1' }).range, null);
});

test('keeps Excel dates and distinguishes zero, empty text and uncached formulas', () => {
  const book = utils.book_new();
  book.Workbook = { WBProps: { date1904: true } };
  utils.book_append_sheet(book, {
    '!ref': 'A1:D1',
    A1: { t: 'n', v: 1, z: 'yyyy-mm-dd' },
    B1: { t: 'n', v: 0, f: '1-1' },
    C1: { t: 'z', f: '1+1' },
    D1: { t: 's', v: '', f: 'IF(TRUE,"","x")' },
  }, 'Numbers');
  const parsed = read(write(book, { type: 'array', bookType: 'xlsx' }), { sheetStubs: true, cellHTML: false });
  const sheet = parsed.Sheets.Numbers;
  const [date, zero, missing, empty] = buildSheetWindow(sheet, describeSheet(sheet)).cells[0];
  assert.equal(date.text, '1904-01-02');
  assert.equal(zero.text, '0');
  assert.equal(zero.noResult, false);
  assert.equal(missing.formula, '=1+1');
  assert.equal(missing.text, '');
  assert.equal(missing.noResult, true);
  assert.equal(empty.text, '');
  assert.equal(empty.noResult, false);
});
