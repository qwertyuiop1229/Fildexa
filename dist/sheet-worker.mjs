import { read } from './vendor/sheetjs/xlsx.mjs';
import { buildSheetWindow, describeSheet, workbookFileLimit } from './sheet-grid.mjs';
import { readZip } from './zip.mjs';

let workbook;
let sheets;
const sheetMetadata = new Map();

async function open(buffer) {
  workbook = null;
  sheets = null;
  sheetMetadata.clear();
  if (buffer.byteLength > workbookFileLimit) throw new Error('file-limit');
  const packageFile = readZip(new Uint8Array(buffer));
  const contentTypes = packageFile.files.get('[Content_Types].xml');
  if (!contentTypes || contentTypes.length > 1_048_576) throw new Error('format');
  const types = await (await packageFile.blob('[Content_Types].xml')).text();
  if (!types.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) {
    throw new Error('format');
  }

  let length = 0;
  for (const entry of packageFile.files.values()) {
    length += entry.length;
    if (entry.length > 32 * 2 ** 20 || length > 96 * 2 ** 20) throw new Error('expanded-limit');
  }

  workbook = read(buffer, {
    type: 'array', cellFormula: true, cellHTML: false, cellText: true, xlfn: true,
    cellDates: false, sheetStubs: true, bookVBA: false,
  });
  if (!workbook.SheetNames.length) throw new Error('format');
  sheets = workbook.SheetNames.map((name, index) => ({
    name,
    hidden: !!workbook.Workbook?.Sheets?.[index]?.Hidden,
  }));
  return sheets;
}

self.onmessage = async ({ data: { request, action, bytes, index, target } }) => {
  try {
    if (action === 'open') {
      self.postMessage({ request, sheets: await open(bytes) });
    } else if (action === 'page') {
      const name = sheets?.[index]?.name;
      if (name === undefined) throw new Error('format');
      const sheet = workbook.Sheets[name] ?? Object.create(null);
      if (!sheetMetadata.has(index)) sheetMetadata.set(index, describeSheet(sheet));
      self.postMessage({ request, page: buildSheetWindow(sheet, sheetMetadata.get(index), target) });
    }
  } catch (error) {
    self.postMessage({ request, error: ['file-limit', 'expanded-limit'].includes(error?.message) ? error.message : 'format' });
  }
};
