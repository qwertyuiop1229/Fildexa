const definitions = [
  ['255044462D', 'PDF'], ['89504E470D0A1A0A', 'PNG'], ['FFD8FF', 'JPEG'],
  ['47494638', 'GIF'], ['504B0304', 'ZIP系コンテナ'], ['504B0506', 'ZIP系コンテナ'],
  ['377ABCAF271C', '7z'], ['1F8B08', 'gzip'], ['53514C69746520666F726D6174203300', 'SQLite'],
  ['0061736D', 'WebAssembly'], ['676C5446', 'GLB'], ['7F454C46', 'ELF'],
  ['4F676753', 'Ogg'], ['664C6143', 'FLAC'],
];

export function inferFormat(bytes) {
  const at = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  const hex = Array.from(bytes.subarray(0, 16), (value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  const guess = definitions.find(([prefix]) => hex.startsWith(prefix));
  if (guess) return guess[1];
  if (at(4, 8) === 'ftyp') return 'MP4系コンテナ';
  if (at(0, 4) === 'RIFF') {
    const type = at(8, 12);
    return ({ WAVE: 'WAV', WEBP: 'WebP', 'AVI ': 'AVI' })[type] ?? 'RIFF';
  }
  if (at(257, 262) === 'ustar') return 'TAR';
  return null;
}
