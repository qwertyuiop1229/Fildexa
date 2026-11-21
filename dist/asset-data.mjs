export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export function decodeAssetText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch {
    try { return new TextDecoder('shift_jis', { fatal: true }).decode(bytes); }
    catch { return new TextDecoder().decode(bytes); }
  }
}

export function encodeCsv(columns, rows) {
  const field = (value) => {
    if (value == null) return '""';
    let text = String(value);
    if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [columns, ...rows].map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';
}

export function addTextCopy(pane, text, name, format, { element, button }) {
  const section = element('details', undefined, 'format-edit');
  const heading = element('summary', '編集してコピーを保存');
  const editor = element('textarea');
  editor.value = text;
  editor.spellcheck = false;
  editor.setAttribute('aria-label', 'コピーの内容');
  editor.maxLength = 500_000;
  const status = element('p', '', 'asset-status');
  status.setAttribute('role', 'status');
  const save = button('コピーを保存', () => {
    if (format === 'json') {
      try { JSON.parse(editor.value); }
      catch { status.textContent = 'JSONの構文を確認してください。'; return; }
    }
    const dot = name.lastIndexOf('.');
    const copy = name.slice(0, dot) + '-edited' + name.slice(dot);
    const parts = format === 'csv' || format === 'tsv' ? ['\uFEFF', editor.value] : [editor.value];
    downloadBlob(new Blob(parts, { type: 'text/plain;charset=utf-8' }), copy);
    status.textContent = 'UTF-8のコピーを保存しました。';
  });
  section.append(heading, editor, save, status);
  pane.append(section);
}
