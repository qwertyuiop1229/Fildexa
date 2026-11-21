importScripts('./vendor/sqlite/sql-wasm-browser.js');

const engine = initSqlJs({ locateFile: (name) => new URL('./vendor/sqlite/' + name, self.location.href).href });
let db;
let tables;
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';

function loadPage(index, offset) {
  const table = tables[index];
  if (!table) throw new Error('table');
  const columns = db.exec('SELECT name FROM pragma_table_xinfo(?) WHERE hidden != 1 ORDER BY cid LIMIT 31', [table])[0]?.values.map((row) => row[0]) ?? [];
  if (!columns.length) throw new Error('table');
  const visible = columns.slice(0, 30);
  const statement = db.prepare('SELECT ' + visible.map(quote).join(', ') + ' FROM ' + quote(table) + ' LIMIT 51 OFFSET ?', [offset]);
  const rows = [];
  try {
    while (statement.step()) {
      rows.push(statement.get(null, { useBigInt: true }).map((value) => {
        if (value instanceof Uint8Array) return '[BLOB ' + value.length + ' B]';
        return typeof value === 'string' && value.length > 2_048 ? value.slice(0, 2_048) + '…' : value;
      }));
    }
  } finally { statement.free(); }
  return { columns: visible, moreColumns: columns.length > visible.length, rows: rows.slice(0, 50), hasMore: rows.length > 50 };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.action === 'open') {
      const signature = new TextDecoder().decode(new Uint8Array(data.bytes, 0, Math.min(16, data.bytes.byteLength)));
      if (signature !== 'SQLite format 3\0') throw new Error('format');
      const SQL = await engine;
      db = new SQL.Database(new Uint8Array(data.bytes));
      db.run('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
      tables = db.exec("SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,7)!='sqlite_' AND upper(ltrim(sql)) LIKE 'CREATE TABLE%' ORDER BY name LIMIT 501")[0]?.values.map((row) => row[0]) ?? [];
      self.postMessage({ id: data.id, tables: tables.slice(0, 500), clipped: tables.length > 500 });
    } else {
      self.postMessage({ id: data.id, page: loadPage(data.index, data.offset) });
    }
  } catch {
    self.postMessage({ id: data.id, error: true });
  }
};
