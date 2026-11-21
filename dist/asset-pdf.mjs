import { enterContent } from './motion.mjs';

const vendor = new URL('./vendor/pdfjs/', import.meta.url);
const asset = (path) => new URL(path, vendor).href;

export function mountPdf(file, pane, { element, button }) {
  let disposed = false;
  let loader;
  let document;
  let renderTask;
  let requested = 0;
  let pageNumber = 1;
  let lastWidth = 0;

  const controls = element('div', undefined, 'asset-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'PDFのページ移動');
  const previous = button('前のページ', () => navigate(-1));
  const next = button('次のページ', () => navigate(1));
  const indicator = element('output', '—', 'asset-reading');
  indicator.setAttribute('aria-label', '現在のページ');
  previous.disabled = next.disabled = true;
  controls.append(previous, indicator, next);

  const status = element('p', 'PDFを読み込み中…', 'asset-status');
  status.setAttribute('role', 'status');
  const sheet = element('div', undefined, 'asset-pdf-sheet');
  pane.append(controls, status, sheet);

  function navigate(step) {
    const target = pageNumber + step;
    if (!document || target < 1 || target > document.numPages) return;
    pageNumber = target;
    pane.scrollTop = 0;
    void draw();
  }

  async function draw() {
    const turn = ++requested;
    const number = pageNumber;
    const width = Math.max(1, sheet.clientWidth - 24);
    lastWidth = width;
    previous.disabled = number === 1;
    next.disabled = number === document.numPages;
    indicator.textContent = number + ' / ' + document.numPages;
    renderTask?.cancel();
    status.textContent = 'ページを描画中…';
    sheet.setAttribute('aria-busy', 'true');
    try {
      const page = await document.getPage(number);
      if (disposed || turn !== requested) return;
      const original = page.getViewport({ scale: 1 });
      const fitted = page.getViewport({ scale: Math.min(width / original.width, 2) });
      const pixels = Math.min(globalThis.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (fitted.width * fitted.height)), 8192 / Math.max(fitted.width, fitted.height));
      const canvas = element('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'PDF ' + number + 'ページ目');
      canvas.width = Math.max(1, Math.floor(fitted.width * pixels));
      canvas.height = Math.max(1, Math.floor(fitted.height * pixels));
      canvas.style.width = fitted.width + 'px';
      renderTask = page.render({ canvas, viewport: fitted, transform: [pixels, 0, 0, pixels, 0, 0] });
      await renderTask.promise;
      if (disposed || turn !== requested) return;
      sheet.replaceChildren(canvas);
      enterContent(canvas, { duration: 140, y: 2 });
      status.textContent = '';
    } catch {
      if (disposed || turn !== requested) return;
      sheet.replaceChildren();
      status.textContent = 'このページを表示できません。「ダウンロード」から元のPDFを開けます。';
    } finally {
      if (!disposed && turn === requested) sheet.setAttribute('aria-busy', 'false');
    }
  }

  const observe = new ResizeObserver(() => {
    if (document && Math.max(1, sheet.clientWidth - 24) !== lastWidth) void draw();
  });
  observe.observe(sheet);

  void (async () => {
    try {
      const pdf = await import('./vendor/pdfjs/pdf.min.mjs');
      if (disposed) return;
      const data = new Uint8Array(await file.arrayBuffer());
      if (disposed) return;
      pdf.GlobalWorkerOptions.workerSrc = asset('pdf.worker.min.mjs');
      loader = pdf.getDocument({
        data,
        cMapUrl: asset('cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: asset('standard_fonts/'),
        iccUrl: asset('iccs/'),
        wasmUrl: asset('wasm/'),
        isEvalSupported: false,
        enableXfa: false,
        maxImageSize: 16_000_000,
      });
      document = await loader.promise;
      if (!disposed) void draw();
    } catch (error) {
      if (disposed) return;
      status.textContent = error?.name === 'PasswordException'
        ? 'パスワード付きのPDFです。「ダウンロード」から元のPDFを開けます。'
        : 'PDFを読み込めません。「ダウンロード」から元のPDFを開けます。';
    }
  })();

  return () => {
    disposed = true;
    observe.disconnect();
    renderTask?.cancel();
    void loader?.destroy().catch(() => {});
  };
}
