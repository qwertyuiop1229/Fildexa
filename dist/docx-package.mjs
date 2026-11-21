import { clean, readZip } from './zip.mjs';

const wordNamespaces = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const relationshipNamespaces = new Set([
  'http://schemas.openxmlformats.org/package/2006/relationships',
  'http://purl.oclc.org/ooxml/package/relationships',
]);
const contentTypeNamespaces = new Set([
  'http://schemas.openxmlformats.org/package/2006/content-types',
  'http://purl.oclc.org/ooxml/package/content-types',
]);
const relationshipPrefixes = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/',
];
const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
export const docxFileLimit = 32 * 2 ** 20;
const bodyLimit = 6 * 2 ** 20;

export function partPath(target, source = '') {
  if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target) || /[\\?#]/.test(target)) return null;
  let decoded;
  try { decoded = decodeURIComponent(target); } catch { return null; }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(decoded) || /[\\?#]/.test(decoded)) return null;
  const segments = decoded.startsWith('/') ? [] : source.split('/').slice(0, -1);
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return clean(segments.join('/'));
}

export function wordChildren(node, name) {
  return Array.from(node?.children ?? []).filter((child) =>
    wordNamespaces.has(child.namespaceURI) && (name === undefined || child.localName === name));
}

export const wordChild = (node, name) => wordChildren(node, name)[0];
export const wordValue = (node, key = 'val') => node?.getAttributeNS(node.namespaceURI, key);
export const wordFlag = (node) => !!node && !/^(?:0|false|off)$/i.test(wordValue(node) ?? '');
export const wordElement = (node, name) => wordNamespaces.has(node?.namespaceURI) && node.localName === name;

function decodeXml(bytes) {
  const first = bytes.subarray(0, 4);
  const encoding = (first[0] === 0xff && first[1] === 0xfe) || (first[0] === 0x3c && first[1] === 0)
    ? 'utf-16le'
    : (first[0] === 0xfe && first[1] === 0xff) || (first[0] === 0 && first[1] === 0x3c)
      ? 'utf-16be'
      : 'utf-8';
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (/<!DOCTYPE/i.test(text)) throw new Error('format');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (!doc.documentElement || doc.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('format');
  return doc.documentElement;
}

async function xmlPart(archive, path, limit) {
  const entry = archive.files.get(path);
  if (!entry) throw new Error('format');
  if (entry.length > limit) throw new Error('part-limit');
  const bytes = new Uint8Array(await (await archive.blob(path)).arrayBuffer());
  return decodeXml(bytes);
}

function relationship(root, kind, source) {
  if (root.localName !== 'Relationships' || !relationshipNamespaces.has(root.namespaceURI)) throw new Error('format');
  for (const link of root.children) {
    const type = link.getAttribute('Type');
    const matches = relationshipPrefixes.some((prefix) => type === prefix + kind);
    if (link.localName === 'Relationship' && link.namespaceURI === root.namespaceURI && matches
        && link.getAttribute('TargetMode') !== 'External') {
      return partPath(link.getAttribute('Target'), source);
    }
  }
  return null;
}

export async function readDocument(file) {
  if (file.size > docxFileLimit) throw new Error('file-limit');
  const archive = readZip(new Uint8Array(await file.arrayBuffer()), { packageRelationships: true });
  const packageRels = await xmlPart(archive, '_rels/.rels', 256 * 1024);
  const main = relationship(packageRels, 'officeDocument');
  if (!main) throw new Error('format');

  const types = await xmlPart(archive, '[Content_Types].xml', 512 * 1024);
  const hasType = types.localName === 'Types' && contentTypeNamespaces.has(types.namespaceURI)
    && Array.from(types.children).some((entry) => entry.namespaceURI === types.namespaceURI
      && entry.localName === 'Override' && partPath(entry.getAttribute('PartName')) === main
      && entry.getAttribute('ContentType') === docxType);
  if (!hasType) throw new Error('format');

  const root = await xmlPart(archive, main, bodyLimit);
  const body = wordChild(root, 'body');
  if (!wordElement(root, 'document') || !body) throw new Error('format');

  let styles;
  let partialStyles = false;
  const slash = main.lastIndexOf('/') + 1;
  const docRels = main.slice(0, slash) + '_rels/' + main.slice(slash) + '.rels';
  if (archive.files.has(docRels)) {
    try {
      const rels = await xmlPart(archive, docRels, 256 * 1024);
      const stylePath = relationship(rels, 'styles', main);
      if (stylePath) styles = await xmlPart(archive, stylePath, 1024 * 1024);
    } catch {
      partialStyles = true;
    }
  }
  return { body, styles, partialStyles };
}

function outline(node) {
  const value = wordValue(wordChild(node, 'outlineLvl'));
  return /^[0-9]$/.test(value ?? '') ? Number(value) : null;
}

function builtInHeading(id) {
  const match = /^heading\s*([1-9])$/i.exec(id ?? '');
  return match ? Number(match[1]) - 1 : null;
}

export function documentStyles(root) {
  const styles = new Map(wordChildren(root, 'style')
    .map((style) => [wordValue(style, 'styleId'), style]));
  const cache = new Map();
  function inheritedOutline(id) {
    if (cache.has(id)) return cache.get(id);
    const seen = new Set();
    let current = id;
    let result = null;
    while (current && !seen.has(current) && seen.size < 32) {
      seen.add(current);
      const style = styles.get(current);
      result = outline(wordChild(style, 'pPr'))
        ?? builtInHeading(current)
        ?? builtInHeading(wordValue(wordChild(style, 'name')));
      if (result !== null) break;
      current = wordValue(wordChild(style, 'basedOn'));
    }
    cache.set(id, result);
    return result;
  }
  return {
    level(paragraph) {
      const properties = wordChild(paragraph, 'pPr');
      const id = wordValue(wordChild(properties, 'pStyle'));
      const level = outline(properties) ?? inheritedOutline(id);
      return level !== null && level < 9 ? level + 1 : null;
    },
    character(id) {
      return wordChild(styles.get(id), 'rPr');
    },
  };
}
