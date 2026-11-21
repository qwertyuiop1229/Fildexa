import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexPreview } from '../dist/asset-hex.mjs';
import { assetGroup, ext } from '../dist/lab-core.mjs';

test('displays byte offsets, printable text and control bytes in the raw viewer', () => {
  const bytes = Uint8Array.from([0x00, 0x20, 0x7e, 0x7f, ...Array(12).fill(0x41), 0xff]);
  const [first, second] = hexPreview(bytes).split('\n');
  assert.match(first, /^00000000  00 20 7E 7F 41 .*\|\. ~\.A{12}\|$/);
  assert.match(second, /^00000010  FF +\|\.\|$/);
  assert.equal(hexPreview(new Uint8Array()), '');
});

test('uses the filename extension and sends unrecognized formats to the raw viewer', () => {
  assert.equal(ext('project.v2/README'), '');
  assert.equal(ext('project.v2/scan.PDF'), 'pdf');
  assert.equal(assetGroup('project.v2/scan.PDF'), 'docs');
  assert.equal(assetGroup('project.v2/sample.bin'), 'other');
});
