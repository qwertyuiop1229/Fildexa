import { clean, readZip } from './zip.mjs';

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

export async function xmlPart(archive, path, limit) {
  const entry = archive.files.get(path);
  if (!entry) throw new Error('format');
  if (entry.length > limit) throw new Error('part-limit');
  const bytes = new Uint8Array(await (await archive.blob(path)).arrayBuffer());
  return decodeXml(bytes);
}

function packageRelationships(root, source) {
  if (root.localName !== 'Relationships' || !relationshipNamespaces.has(root.namespaceURI)) throw new Error('format');
  const entries = [];
  for (const item of root.children) {
    if (item.localName !== 'Relationship' || item.namespaceURI !== root.namespaceURI
        || item.getAttribute('TargetMode') === 'External') continue;
    const type = item.getAttribute('Type') ?? '';
    const prefix = relationshipPrefixes.find((candidate) => type.startsWith(candidate));
    const path = partPath(item.getAttribute('Target'), source);
    if (prefix && path) entries.push({ id: item.getAttribute('Id'), kind: type.slice(prefix.length), path });
  }
  return entries;
}

export const relationshipId = (node, key = 'id') => relationshipPrefixes
  .map((prefix) => node?.getAttributeNS(prefix.slice(0, -1), key))
  .find((value) => value != null);

export async function openOfficePackage(file, mainType, fileLimit) {
  if (file.size > fileLimit) throw new Error('file-limit');
  const archive = readZip(new Uint8Array(await file.arrayBuffer()), { packageRelationships: true });
  async function relationships(source = '') {
    const slash = source.lastIndexOf('/') + 1;
    const path = source.slice(0, slash) + '_rels/' + source.slice(slash) + '.rels';
    if (source && !archive.files.has(path)) return [];
    return packageRelationships(await xmlPart(archive, path, 256 * 1024), source);
  }
  const main = (await relationships()).find((entry) => entry.kind === 'officeDocument')?.path;
  if (!main) throw new Error('format');
  const types = await xmlPart(archive, '[Content_Types].xml', 512 * 1024);
  const hasType = types.localName === 'Types' && contentTypeNamespaces.has(types.namespaceURI)
    && Array.from(types.children).some((entry) => entry.namespaceURI === types.namespaceURI
      && entry.localName === 'Override' && partPath(entry.getAttribute('PartName')) === main
      && entry.getAttribute('ContentType') === mainType);
  if (!hasType) throw new Error('format');
  return { archive, main, relationships };
}
