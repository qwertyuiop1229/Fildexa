import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeAssetText, encodeCsv } from '../dist/asset-data.mjs';
import { inferFormat } from '../dist/asset-signatures.mjs';
import { objTriangles, stlTriangles } from '../dist/mesh-formats.mjs';
import { applyGroup } from '../dist/pptx-package.mjs';

test('keeps archive and container signatures distinct from filename extensions', () => {
  assert.equal(inferFormat(Buffer.from('%PDF-1.7')), 'PDF');
  assert.equal(inferFormat(Buffer.from('SQLite format 3\0')), 'SQLite');
  assert.equal(inferFormat(Buffer.from('RIFF\0\0\0\0WAVE')), 'WAV');
  assert.equal(inferFormat(Buffer.from('377abcaf271c','hex')), '7z');
  assert.equal(inferFormat(Buffer.from('sample')), null);
});

test('detects Japanese CSV and exports quoted cells as plain CSV data', () => {
  assert.equal(decodeAssetText(Buffer.from('836583588367', 'hex')), 'テスト');
  assert.equal(decodeAssetText(Buffer.from('Unicode いちご')), 'Unicode いちご');
  assert.equal(encodeCsv(['header'], [['=1+1'], ['"quoted"'], [-12], [null]]),
    '"header"\r\n"\x27=1+1"\r\n"""quoted"""\r\n"-12"\r\n""\r\n');
});

test('triangulates OBJ faces with relative vertex indexes and separate geometry', () => {
  const bytes = new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4 -3 -2 -1');
  const triangles = objTriangles(bytes.buffer);
  assert.equal(triangles.length, 2);
  assert.deepEqual(triangles[1], [[0,0,0],[1,1,0],[0,1,0]]);
  assert.notEqual(triangles[0][0], triangles[1][0]);
  assert.throws(() => objTriangles(new TextEncoder().encode('v 0 0 0\nf 1 2 3').buffer), /頂点/);
});

test('reads binary STL even when its header begins with the ASCII solid marker', () => {
  const bytes = new Uint8Array(134);
  bytes.set(new TextEncoder().encode('solid example'));
  const view = new DataView(bytes.buffer);
  view.setUint32(80,1,true);
  view.setFloat32(108,1,true);
  view.setFloat32(124,1,true);
  assert.deepEqual(stlTriangles(bytes.buffer), [[[0,0,0],[1,0,0],[0,1,0]]]);
});

test('maps grouped slide objects from child coordinates to slide coordinates', () => {
  assert.deepEqual(applyGroup({x:25,y:40,w:10,h:15}, {x:100,y:200,w:80,h:180}, {x:20,y:30,w:40,h:60}), {
    x:110,y:230,w:20,h:45,
  });
});
