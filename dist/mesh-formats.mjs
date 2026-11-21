const stepLimit = 5_500;
const dimension = 3;
const safeVector = (values) => values.length === dimension
  && values.every((value) => Number.isFinite(value) && Math.abs(value) < 1e60);

function coordinates(tokens) {
  const result = tokens.slice(0, dimension).map(Number);
  if (!safeVector(result)) throw new Error('モデルに無効な座標があります。');
  return result;
}

function textFrom(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new Error('テキスト形式のモデルデータを読み込めません。'); }
}

export function objTriangles(buffer) {
  const points = [];
  const result = [];
  for (const row of textFrom(buffer).split(/\r?\n/)) {
    const match = /^\s*(v|f)\s+([^#]*)/.exec(row);
    if (!match) continue;
    const tokens = match[2].trim().split(/\s+/);
    if (match[1] === 'v') {
      if (points.length >= 600_000) throw new Error('頂点数が表示上限を超えています。');
      points.push(coordinates(tokens));
    } else if (result.length < stepLimit && tokens.length >= 3) {
      const vertices = tokens.map((token) => {
        const raw = token.split('/')[0];
        if (!/^-?\d+$/.test(raw)) throw new Error('面の頂点番号を読み込めません。');
        const i = Number(raw);
        const point = points[i < 0 ? points.length + i : i - 1];
        if (!point) throw new Error('面が存在しない頂点を参照しています。');
        return point;
      });
      for (let i = 1; i + 1 < vertices.length && result.length < stepLimit; i++) {
        result.push([vertices[0].slice(), vertices[i].slice(), vertices[i + 1].slice()]);
      }
    }
  }
  return result;
}

export function stlTriangles(buffer) {
  const view = new DataView(buffer);
  const faces = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const result = [];
  if (faces && 84 + faces * 50 === buffer.byteLength) {
    const step = Math.ceil(faces / stepLimit);
    for (let i = 0; i < faces; i += step) {
      const start = 84 + i * 50 + 12;
      const triangle = Array.from({ length: 3 }, (_, j) =>
        Array.from({ length: 3 }, (_, k) => view.getFloat32(start + j * 12 + k * 4, true)));
      if (triangle.every(safeVector)) result.push(triangle);
    }
    return result;
  }
  const text = textFrom(buffer);
  if (!/^\s*solid(?:\s|$)/i.test(text)) throw new Error('STLの形式を確認できません。');
  for (const face of text.matchAll(/\bfacet\b[^]*?\bendfacet\b/ig)) {
    const vertices = Array.from(face[0].matchAll(/\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/ig), (match) => coordinates(match.slice(1)));
    if (vertices.length === 3) result.push(vertices);
    if (result.length >= stepLimit) break;
  }
  return result;
}
