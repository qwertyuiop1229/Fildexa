import { proxy, wrap } from './vendor/archive/comlink.mjs';
import { clean } from './zip.mjs';
import { normalizeEntries } from './workspace.mjs';

const compressedLimit = 48 * 2 ** 20;
const expandedLimit = 128 * 2 ** 20;
const entryLimit = 48 * 2 ** 20;

export async function readExtraArchive(file, signal) {
  if (file.size > compressedLimit) throw new Error('TAR・7zのファイルは48 MBまでです。');
  if (signal?.aborted) throw signal.reason;
  const worker = new Worker(new URL('./vendor/archive/worker-bundle.js', import.meta.url), { type: 'module' });
  let timer;
  let abort;
  const stop = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    timer = setTimeout(() => reject(new Error('アーカイブの展開時間が上限を超えました。')), 25_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => reject(new Error('アーカイブの読み込みに失敗しました。'));
  });
  try {
    return await Promise.race([stop, (async () => {
      const RemoteArchive = wrap(worker);
      let ready;
      const startup = new Promise((resolve) => { ready = resolve; });
      const reader = await new RemoteArchive(proxy(ready));
      await startup;
      await new Promise((resolve, reject) => { void reader.open(file, proxy(resolve)).catch(reject); });
      if (await reader.hasEncryptedData()) throw new Error('パスワード付きのアーカイブは開けません。');
      const listed = await reader.listFiles();
      if (listed.length > 3_000) throw new Error('アーカイブは3,000項目までです。');
      let size = 0;
      const accepted = new Map();
      const seen = new Set();
      for (const item of listed) {
        if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > entryLimit) {
          throw new Error('アーカイブ内の1ファイルは48 MBまでです。');
        }
        size += item.size;
        if (size > expandedLimit) throw new Error('展開後は合計128 MBまでです。');
        if (item.type !== 'FILE' || typeof item.path !== 'string') continue;
        const path = clean(item.path);
        if (!path) continue;
        if (seen.has(path)) throw new Error('同じパスのファイルが複数含まれています。');
        seen.add(path);
        accepted.set(item.path, { path, length: item.size });
      }
      if (!accepted.size) throw new Error('開けるファイルが見つかりませんでした。');
      const rows = [];
      for (const entry of await reader.extractFiles()) {
        const found = accepted.get(entry.path);
        if (!found || entry.type !== 'FILE') continue;
        if (entry.fileData?.byteLength !== found.length) throw new Error('展開後のファイルサイズが一致しません。');
        rows.push({ path: found.path, file: new Blob([entry.fileData]) });
      }
      if (rows.length !== accepted.size) throw new Error('一部のファイルを展開できませんでした。');
      return normalizeEntries(rows);
    })()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    worker.terminate();
  }
}
