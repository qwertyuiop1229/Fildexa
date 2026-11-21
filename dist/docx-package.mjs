import { openOfficePackage, xmlPart } from './office-package.mjs';
export { partPath } from './office-package.mjs';

const wordNamespaces = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
export const docxFileLimit = 32 * 2 ** 20;
const bodyLimit = 6 * 2 ** 20;

export function wordChildren(node, name) {
  return Array.from(node?.children ?? []).filter((child) =>
    wordNamespaces.has(child.namespaceURI) && (name === undefined || child.localName === name));
}

export const wordChild = (node, name) => wordChildren(node, name)[0];
export const wordValue = (node, key = 'val') => node?.getAttributeNS(node.namespaceURI, key);
export const wordFlag = (node) => !!node && !/^(?:0|false|off)$/i.test(wordValue(node) ?? '');
export const wordElement = (node, name) => wordNamespaces.has(node?.namespaceURI) && node.localName === name;

export async function readDocument(file) {
  const { archive, main, relationships } = await openOfficePackage(file, docxType, docxFileLimit);
  const root = await xmlPart(archive, main, bodyLimit);
  const body = wordChild(root, 'body');
  if (!wordElement(root, 'document') || !body) throw new Error('format');

  let styles;
  let partialStyles = false;
  try {
    const style = (await relationships(main)).find((entry) => entry.kind === 'styles');
    if (style) styles = await xmlPart(archive, style.path, 1024 * 1024);
  } catch {
    partialStyles = true;
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
