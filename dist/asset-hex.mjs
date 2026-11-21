export const hexPreviewLimit = 512;

export function hexPreview(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.subarray(offset, offset + 16);
    const hex = Array.from(row, (byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    const text = Array.from(row, (byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('');
    lines.push(offset.toString(16).toUpperCase().padStart(8, '0') + '  ' + hex.padEnd(47) + '  |' + text + '|');
  }
  return lines.join('\n');
}
