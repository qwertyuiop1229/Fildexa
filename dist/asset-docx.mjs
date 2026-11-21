import { blockHTML, documentBlocks, headingText } from './docx-content.mjs';
import { documentStyles, docxFileLimit, readDocument, wordElement } from './docx-package.mjs';
import { enterContent } from './motion.mjs';

const batchSize = 80;
const blockLimit = 5_000;
const waitForPaint = () => new Promise((resolve) => requestAnimationFrame(resolve));

export function mountDocx(file, pane, { element, button }) {
  const status = element('p', '文書を読み込み中…', 'asset-status');
  status.setAttribute('role', 'status');
  pane.append(status);
  let disposed = false;
  let tableObserver;

  void (async () => {
    try {
      if (file.size > docxFileLimit) throw new Error('file-limit');
      const { body, styles, partialStyles } = await readDocument(file);
      if (disposed) return;
      const format = documentStyles(styles);
      const rows = [];
      const headings = [];
      let clipped = false;
      for (const block of documentBlocks(body)) {
        if (rows.length >= blockLimit) {
          clipped = true;
          break;
        }
        const index = rows.length;
        const level = wordElement(block, 'p') ? format.level(block) : null;
        const label = level ? headingText(block) : '';
        rows.push({ block, level, label });
        if (label) headings.push({ index, level, label });
      }

      pane.replaceChildren();
      if (!rows.length) {
        pane.append(element('p', '表示できる本文がありません。', 'asset-status'));
        return;
      }
      const layout = element('section', undefined, 'docx-layout');
      layout.setAttribute('aria-label', 'DOCXビューアー');
      const reading = element('div', undefined, 'docx-reading');
      const paper = element('article', undefined, 'docx-paper');
      paper.setAttribute('aria-label', '文書本文');
      const more = element('div', undefined, 'docx-more');
      const next = button('続きを表示', () => appendBatch());
      const progress = element('p', '', 'asset-status');
      progress.setAttribute('role', 'status');
      more.append(progress, next);
      if (partialStyles) reading.append(element('p', '文書の一部のスタイルを読み込めませんでした。', 'docx-warning'));
      reading.append(paper, more);
      if (clipped) reading.append(element('p', '先頭5,000ブロックを表示します。続きは元の文書で確認できます。', 'docx-warning'));

      const tableHints = new WeakMap();
      tableObserver = new ResizeObserver((entries) => {
        for (const { target } of entries) {
          const hint = tableHints.get(target);
          hint.hidden = target.scrollWidth <= target.clientWidth + 1;
        }
      });
      const context = {
        styles: format,
        element,
        cellsLeft: 12_000,
        observeTable(scroll, hint) {
          tableHints.set(scroll, hint);
          tableObserver.observe(scroll);
        },
      };
      const mounted = new Map();
      let rendered = 0;
      let navigation = 0;
      let current;
      const mobile = matchMedia('(max-width: 740px)');
      let outline;

      function appendBatch() {
        const end = Math.min(rendered + batchSize, rows.length);
        const fragment = document.createDocumentFragment();
        for (; rendered < end; rendered++) {
          const { block, level, label } = rows[rendered];
          const node = blockHTML(block, context, 0, level);
          if (label) {
            node.tabIndex = -1;
            mounted.set(rendered, node);
          }
          fragment.append(node);
        }
        paper.append(fragment);
        progress.textContent = rendered.toLocaleString('ja-JP') + ' / ' + rows.length.toLocaleString('ja-JP') + ' ブロックを表示';
        const focused = document.activeElement === next;
        next.hidden = rendered >= rows.length;
        more.hidden = next.hidden && rows.length <= batchSize;
        if (next.hidden && focused) {
          progress.tabIndex = -1;
          progress.focus({ preventScroll: true });
        }
      }

      async function goTo(index, target) {
        const ticket = ++navigation;
        while (rendered <= index) {
          appendBatch();
          await waitForPaint();
          if (disposed || ticket !== navigation) return;
        }
        const heading = mounted.get(index);
        if (!heading) return;
        current?.removeAttribute('aria-current');
        target.setAttribute('aria-current', 'location');
        current = target;
        if (mobile.matches) outline.open = false;
        const offset = mobile.matches ? outline.offsetHeight + 18 : 18;
        const top = pane.scrollTop + heading.getBoundingClientRect().top - pane.getBoundingClientRect().top - offset;
        heading.focus({ preventScroll: true });
        pane.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      }

      if (headings.length) {
        layout.classList.add('docx-has-outline');
        outline = element('details', undefined, 'docx-outline');
        outline.open = !mobile.matches;
        const summary = element('summary', '目次');
        const nav = element('nav', undefined, 'docx-outline-nav');
        nav.setAttribute('aria-label', '文書の目次');
        for (const heading of headings) {
          const item = button(heading.label, () => void goTo(heading.index, item));
          item.className = 'docx-outline-item';
          item.title = heading.label;
          item.style.setProperty('--heading-indent', String(Math.min(heading.level - 1, 4)));
          nav.append(item);
        }
        outline.append(summary, nav);
        layout.append(outline);
      }
      layout.append(reading);
      pane.append(layout);
      appendBatch();
      enterContent(layout, { duration: 150, y: 3 });
    } catch (error) {
      if (disposed) return;
      const message = error?.message === 'file-limit'
        ? 'このビューアーで開けるDOCXは32 MBまでです。'
        : error?.message === 'part-limit'
          ? '展開後の文書データが表示上限を超えています。'
          : 'DOCXを読み込めませんでした。ファイルの形式やパスワード設定を確認してください。';
      status.textContent = message + ' 元の文書は「ダウンロード」から開けます。';
      pane.replaceChildren(status);
    }
  })();

  return () => {
    disposed = true;
    tableObserver?.disconnect();
  };
}
