import { addWaveform } from './asset-wave.mjs';
import { downloadBlob } from './asset-data.mjs';
import { prettySize } from './workspace.mjs';
import { createPicker } from './picker.mjs';

const time = (seconds) => {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.floor(seconds);
  return [Math.floor(total / 60), String(total % 60).padStart(2, '0')].join(':');
};

export function mountMedia(pane, url, file, video, { element, button }) {
  const player = element(video ? 'video' : 'audio', undefined, 'format-player');
  player.controls = true;
  player.playsInline = true;
  player.preload = video ? 'auto' : 'metadata';
  const settings = element('div', undefined, 'format-controls');
  const loop = button('ループ', () => {
    player.loop = !player.loop;
    loop.setAttribute('aria-pressed', String(player.loop));
  });
  loop.setAttribute('aria-pressed', 'false');
  settings.append(loop);
  const speedLabel = element('span', '速度', 'sr-only');
  speedLabel.id = 'media-speed-label';
  const speeds = element('div', undefined, 'media-speed');
  speeds.id = 'media-speed-select';
  const picker = createPicker(speeds, speedLabel.id, (value) => { player.playbackRate = Number(value); });
  picker.set([.5,.75,1,1.25,1.5,2].map((speed) => ({ value: String(speed), label: speed + '×' })), '1');
  settings.append(speedLabel, speeds);

  const meta = element('p', 'メディア情報を読み込み中…', 'asset-status');
  meta.setAttribute('role', 'status');
  let frame;
  if (video) {
    frame = button('フレームを保存', () => {
      const canvas = element('canvas');
      const factor = Math.min(1, 4096 / Math.max(player.videoWidth, player.videoHeight));
      canvas.width = Math.max(1, Math.floor(player.videoWidth * factor));
      canvas.height = Math.max(1, Math.floor(player.videoHeight * factor));
      const context = canvas.getContext('2d');
      if (player.readyState < 2 || !context) return;
      context.drawImage(player, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, 'fildexa-frame-' + Math.floor(player.currentTime * 1000) + 'ms.png');
      }, 'image/png');
    });
    frame.disabled = true;
    settings.append(frame);
  }
  player.onloadedmetadata = () => {
    settings.hidden = false;
    meta.textContent = [time(player.duration), video ? player.videoWidth + ' × ' + player.videoHeight + ' px' : '', prettySize(file.size)]
      .filter(Boolean).join(' · ');
  };
  player.onloadeddata = () => { if (frame) frame.disabled = !player.videoWidth; };
  player.onerror = () => {
    settings.hidden = true;
    meta.textContent = 'このブラウザでは再生できません。形式やコーデックを確認してください。';
    if (frame) frame.disabled = true;
  };
  player.src = url;
  pane.append(player, settings, meta);
  const disposeWave = video ? null : addWaveform(file, player, settings, pane, { element, button });
  return () => { disposeWave?.(); picker.destroy(); player.pause(); player.removeAttribute('src'); player.load(); };
}
