export function addWaveform(file, player, settings, pane, { element, button }) {
  const canvas = element('canvas', undefined, 'format-wave');
  canvas.width = 720;
  canvas.height = 84;
  canvas.hidden = true;
  canvas.setAttribute('aria-label', '音声波形');
  const state = element('p', '', 'asset-status');
  state.setAttribute('role', 'status');
  const show = button('波形を表示', () => void toggle());
  show.setAttribute('aria-pressed', 'false');
  settings.append(show);
  let audio;
  let peaks;
  let dead = false;

  function update() {
    if (!peaks || canvas.hidden) return;
    const draw = canvas.getContext('2d');
    if (!draw) return;
    const total = player.duration;
    const ratio = total > 0 ? player.currentTime / total : 0;
    draw.clearRect(0, 0, canvas.width, canvas.height);
    draw.fillStyle = '#87a9ac';
    draw.fillRect(0, 41, canvas.width, 2);
    const step = canvas.width / peaks.length;
    peaks.forEach((value, index) => {
      draw.fillStyle = index / peaks.length <= ratio ? '#20a58e' : '#729799';
      const height = Math.max(2, value * 76);
      draw.fillRect(index * step, (canvas.height - height) / 2, step - 1, height);
    });
  }

  function visible(active) {
    canvas.hidden = !active;
    show.textContent = active ? '波形を閉じる' : '波形を表示';
    show.setAttribute('aria-pressed', String(active));
    update();
  }

  async function toggle() {
    if (peaks) {
      visible(canvas.hidden);
      return;
    }
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context || file.size > 16 * 2 ** 20 || !Number.isFinite(player.duration) || player.duration > 600) {
      state.textContent = '波形を表示できるのは16 MB・10分以内の対応音声です。';
      return;
    }
    show.disabled = true;
    state.textContent = '波形を読み込み中…';
    try {
      audio = new Context();
      const decoded = await audio.decodeAudioData(await file.arrayBuffer());
      if (dead) return;
      const data = decoded.getChannelData(0);
      peaks = Array.from({ length: 160 }, (_, i) => {
        const start = Math.floor(i * data.length / 160);
        const end = Math.floor((i + 1) * data.length / 160);
        const skip = Math.max(1, Math.floor((end - start) / 160));
        let peak = 0;
        for (let j = start; j < end; j += skip) peak = Math.max(peak, Math.abs(data[j]));
        return Math.min(1, peak);
      });
      state.textContent = '';
      visible(true);
    } catch {
      if (!dead) state.textContent = 'この音声の波形を読み込めませんでした。';
    } finally {
      if (!dead) show.disabled = false;
      if (audio?.state !== 'closed') void audio?.close().catch(() => {});
    }
  }

  canvas.onclick = (event) => {
    if (!Number.isFinite(player.duration)) return;
    const rect = canvas.getBoundingClientRect();
    player.currentTime = player.duration * Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    update();
  };
  player.addEventListener('timeupdate', update);
  pane.append(canvas, state);
  return () => {
    dead = true;
    player.removeEventListener('timeupdate', update);
    if (audio?.state !== 'closed') void audio?.close().catch(() => {});
  };
}
