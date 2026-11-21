import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { readZip } from '../dist/zip.mjs';
import { partPath } from '../dist/docx-package.mjs';
import { assetGroup, acceptsAsset } from '../dist/lab-core.mjs';

test('resolves DOCX package parts relative to their source or the package root', () => {
  assert.equal(partPath('word/document.xml'), 'word/document.xml');
  assert.equal(partPath('../styles/Basic%20Style.xml', 'word/chapters/main.xml'), 'word/styles/Basic Style.xml');
  assert.equal(partPath('/word/styles.xml', 'word/chapters/main.xml'), 'word/styles.xml');
});

test('keeps relationship targets within the DOCX package', () => {
  for (const target of ['../../outside.xml', 'https://example.test/style.xml', '//example.test/x',
    'https%3A%2F%2Fexample.test%2Fx', 'styles.xml#fragment', 'styles.xml%3Fquery', 'bad%escape.xml',
    '%2e%2e/%2e%2e/x.xml', 'a%5Cb.xml']) {
    assert.equal(partPath(target, 'word/document.xml'), null, target);
  }
  assert.equal(acceptsAsset('document.DOCX'), true);
  assert.equal(assetGroup('document.DOCX'), 'docs');
});

test('reads the OOXML root relationship only when explicitly requested', async () => {
  const bytes = await readFile(new URL('./fixtures/docx-package-paths.zip', import.meta.url));
  assert.deepEqual([...readZip(bytes).files.keys()], ['word/document.xml']);
  const archive = readZip(bytes, { packageRelationships: true });
  assert.deepEqual([...archive.files.keys()], ['_rels/.rels', 'word/document.xml']);
  assert.equal(await (await archive.blob('_rels/.rels')).text(), 'relationships');
});
