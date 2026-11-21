import { openOfficePackage, relationshipId, xmlPart } from './office-package.mjs';

const pptxType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
export const presentationLimit = 48 * 2 ** 20;
const namespaces = {
  p: new Set(['http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main']),
  a: new Set(['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main']),
};
const children = (node, name, kind = 'p') => Array.from(node?.children ?? [])
  .filter((child) => namespaces[kind].has(child.namespaceURI) && (!name || child.localName === name));
const child = (node, name, kind = 'p') => children(node, name, kind)[0];
const attr = (node, name) => node?.getAttribute(name);
const number = (node, name) => attr(node, name) == null ? null : Number(attr(node, name));
const bounded = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const tree = (root) => child(child(root, 'cSld'), 'spTree');
const marked = (node, name) => /^(1|true)$/.test(attr(node, name) ?? '');
const rgb = (value) => /^[a-f0-9]{6}$/i.test(value ?? '') ? '#' + value : null;
const pictureTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

function color(parent, palette) {
  return rgb(attr(child(parent, 'srgbClr', 'a'), 'val'))
    ?? palette.get(attr(child(parent, 'schemeClr', 'a'), 'val')) ?? null;
}

function dimensions(node, offsetName = 'off', sizeName = 'ext') {
  const off = child(node, offsetName, 'a');
  const ext = child(node, sizeName, 'a');
  const x = number(off, 'x'), y = number(off, 'y'), w = number(ext, 'cx'), h = number(ext, 'cy');
  return [x,y,w,h].every((v) => Number.isFinite(v) && Math.abs(v) <= 100_000_000) && w > 0 && h > 0 ? {x,y,w,h} : null;
}

const properties = (shape) => child(shape, 'spPr');
function placeholder(shape) {
  const descriptor = children(shape).find((node) => /^nv.*Pr$/.test(node.localName));
  return child(child(descriptor, 'nvPr'), 'ph');
}
const placeholderType = (node) => attr(node, 'type') ?? 'obj';
const isTitle = (node) => ['title', 'ctrTitle'].includes(placeholderType(node));
function matchPlaceholder(scaffold, ph) {
  if (!ph) return null;
  const shapes = children(tree(scaffold), 'sp').filter((node) => placeholder(node));
  const index = attr(ph, 'idx');
  if (index !== null) {
    const found = shapes.find((node) => attr(placeholder(node), 'idx') === index);
    if (found) return found;
  }
  return shapes.find((node) => isTitle(ph) ? isTitle(placeholder(node)) : placeholderType(placeholder(node)) === placeholderType(ph));
}

function paragraphs(body, palette) {
  return children(body, 'p', 'a').slice(0, 200).map((paragraph) => {
    const config = child(paragraph, 'pPr', 'a');
    const defaults = child(config, 'defRPr', 'a');
    const runs = children(paragraph, null, 'a').slice(0, 300).flatMap((node) => {
      if (node.localName === 'br') return [{ text: '\n' }];
      if (!['r', 'fld'].includes(node.localName)) return [];
      const text = child(node, 't', 'a')?.textContent;
      if (!text) return [];
      const style = child(node, 'rPr', 'a');
      const size = number(style, 'sz') ?? number(defaults, 'sz');
      return [{
        text: text.slice(0, 12_000), size: size > 0 ? bounded(size / 100, 4, 240, 18) : null,
        bold: marked(style, 'b') || marked(defaults, 'b'), italic: marked(style, 'i') || marked(defaults, 'i'),
        color: color(child(style, 'solidFill', 'a'), palette) ?? color(child(defaults, 'solidFill', 'a'), palette),
      }];
    });
    const bullet = child(config, 'buChar', 'a');
    if (bullet) runs.unshift({ text: (attr(bullet, 'char') ?? '•').slice(0, 4) + ' ' });
    return { runs, align: { ctr: 'center', r: 'right', just: 'justify' }[attr(config, 'algn')] };
  }).filter((p) => p.runs.length);
}

export function tableRows(table, palette) {
  return children(table, 'tr', 'a').slice(0, 120).map((row) =>
    children(row, 'tc', 'a').slice(0, 40).filter((cell) => !marked(cell, 'hMerge') && !marked(cell, 'vMerge'))
      .map((cell) => ({
        paragraphs: paragraphs(child(cell, 'txBody', 'a'), palette),
        columns: bounded(number(cell, 'gridSpan'), 1, 40, 1),
        rows: bounded(number(cell, 'rowSpan'), 1, 120, 1),
        color: color(child(child(cell, 'tcPr', 'a'), 'solidFill', 'a'), palette),
      })));
}

export function applyGroup(point, outer, internal) {
  if (!outer || !internal) return point;
  const sx = outer.w / internal.w, sy = outer.h / internal.h;
  return { x: outer.x + (point.x - internal.x) * sx, y: outer.y + (point.y - internal.y) * sy, w: point.w * sx, h: point.h * sy };
}

export async function readPresentation(file) {
  const { archive, main, relationships } = await openOfficePackage(file, pptxType, presentationLimit);
  const root = await xmlPart(archive, main, 2 * 2 ** 20);
  if (!namespaces.p.has(root.namespaceURI) || root.localName !== 'presentation') throw new Error('format');
  const size = child(root, 'sldSz');
  const width = bounded(number(size, 'cx'), 100_000, 100_000_000, 12_192_000);
  const height = bounded(number(size, 'cy'), 100_000, 100_000_000, 6_858_000);
  const links = new Map((await relationships(main)).filter((link) => link.kind === 'slide').map((link) => [link.id, link.path]));
  const ordered = children(child(root, 'sldIdLst'), 'sldId');
  if (!ordered.length) throw new Error('format');

  const cached = new Map();
  function scaffold(path) {
    if (!path) return Promise.resolve(null);
    if (!cached.has(path)) {
      if (cached.size >= 18) cached.delete(cached.keys().next().value);
      cached.set(path, xmlPart(archive, path, 2 * 2 ** 20).catch(() => null));
    }
    return cached.get(path);
  }
  const related = (path) => path ? relationships(path).catch(() => []) : Promise.resolve([]);
  const link = (items, kind) => items.find((entry) => entry.kind === kind)?.path;
  return {
    width, height, count: Math.min(ordered.length, 500), clipped: ordered.length > 500,
    async slide(index) {
      const path = links.get(relationshipId(ordered[index]));
      if (!path) throw new Error('format');
      const [slide, rels] = await Promise.all([xmlPart(archive, path, 3 * 2 ** 20), related(path)]);
      if (!tree(slide) || slide.localName !== 'sld' || !namespaces.p.has(slide.namespaceURI)) throw new Error('format');
      const layoutPath = link(rels, 'slideLayout');
      const masterPath = link(await related(layoutPath), 'slideMaster');
      const themePath = link(await related(masterPath), 'theme');
      const [layout, master, theme] = await Promise.all([scaffold(layoutPath), scaffold(masterPath), scaffold(themePath)]);
      const palette = new Map();
      for (const item of children(child(child(theme, 'themeElements', 'a'), 'clrScheme', 'a'), null, 'a')) {
        const value = rgb(attr(child(item, 'srgbClr', 'a'), 'val') ?? attr(child(item, 'sysClr', 'a'), 'lastClr'));
        if (value) palette.set(item.localName, value);
      }
      for (const [alias, fallback] of [['bg1','lt1'],['bg2','lt2'],['tx1','dk1'],['tx2','dk2']]) {
        palette.set(alias, palette.get(attr(child(master, 'clrMap'), alias)) ?? palette.get(fallback));
      }
      const background = [slide, layout, master].map((part) =>
        color(child(child(child(child(part, 'cSld'), 'bg'), 'bgPr'), 'solidFill', 'a'), palette)).find(Boolean) ?? '#ffffff';
      const visuals = [];
      let title = '';
      function walk(parent, map, depth = 0) {
        if (depth > 6) return;
        for (const shape of children(parent)) {
          if (visuals.length >= 240) break;
          const kind = shape.localName;
          if (kind === 'grpSp') {
            const config = child(child(shape, 'grpSpPr'), 'xfrm', 'a');
            walk(shape, (point) => map(applyGroup(point, dimensions(config), dimensions(config, 'chOff', 'chExt'))), depth + 1);
            continue;
          }
          if (!['sp','pic','graphicFrame','cxnSp'].includes(kind)) continue;
          const ph = placeholder(shape);
          const fromLayout = matchPlaceholder(layout, ph);
          const fromMaster = matchPlaceholder(master, ph);
          const config = child(properties(shape), 'xfrm', 'a') ?? child(shape, 'xfrm');
          const bounds = dimensions(config) ?? dimensions(child(properties(fromLayout), 'xfrm', 'a'))
            ?? dimensions(child(properties(fromMaster), 'xfrm', 'a'));
          const content = paragraphs(child(shape, 'txBody'), palette);
          const table = child(child(child(shape, 'graphic', 'a'), 'graphicData', 'a'), 'tbl', 'a');
          const pic = child(child(shape, 'blipFill'), 'blip', 'a');
          const embedded = relationshipId(pic, 'embed');
          const image = embedded ? rels.find((entry) => entry.kind === 'image' && entry.id === embedded)?.path : null;
          const fill = color(child(properties(shape), 'solidFill', 'a'), palette);
          if (!content.length && !table && !image && !fill) continue;
          const isHeading = isTitle(ph) && !!content.length;
          if (isHeading && !title) title = content.flatMap((p) => p.runs.map((r) => r.text)).join(' ').trim().slice(0, 120);
          const type = attr(child(properties(shape), 'prstGeom', 'a'), 'prst');
          const textStyle = child(child(shape, 'txBody'), 'bodyPr', 'a');
          visuals.push({
            bounds: map(bounds ?? { x: width*.08, y: height*Math.min(.8,.07 + visuals.length*.11), w: width*.84, h: height*.2 }),
            content, fill, image, isHeading, rows: table ? tableRows(table, palette) : null,
            centerTitle: placeholderType(ph) === 'ctrTitle',
            center: attr(textStyle, 'anchor') === 'ctr' || (ph && placeholderType(ph) === 'ctrTitle'),
            circle: type === 'ellipse', rounded: type === 'roundRect',
            rotation: bounded(number(config, 'rot'), -21_600_000, 21_600_000, 0) / 60_000,
          });
        }
      }
      walk(tree(slide), (point) => point);
      return { title, visuals, background, textColor: palette.get('tx1'), hidden: attr(slide, 'show') === '0' };
    },
    async image(path) {
      const mime = pictureTypes[path.split('.').at(-1).toLowerCase()];
      const entry = archive.files.get(path);
      if (!mime || !entry || entry.length > 8 * 2 ** 20) return null;
      const blob = await archive.blob(path, mime);
      const start = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const signature = [...start.slice(0, 4)].map((value) => value.toString(16).padStart(2,'0')).join('');
      if (!/^(89504e47|ffd8ff|47494638|52494646|424d)/.test(signature)) return null;
      return blob;
    },
  };
}
