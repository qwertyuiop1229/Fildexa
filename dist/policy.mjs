export function previewPolicy(online=false) {
  const remote=online?' https:':'';
  const script="'unsafe-inline' 'unsafe-eval' blob: data:"+remote;
  return [
    "default-src 'none'",
    "script-src "+script,
    "script-src-elem 'unsafe-inline' blob: data:"+remote,
    "style-src 'unsafe-inline' blob: data:"+remote,
    "img-src blob: data:"+remote,
    "font-src blob: data:"+remote,
    "media-src blob: data:"+remote,
    "connect-src blob: data:"+(online?' https: wss:':''),
    "worker-src blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "manifest-src blob: data:"
  ].join('; ')+';';
}

export function previewSandbox(game=false) {
  return 'allow-scripts'+(game?' allow-pointer-lock':'');
}
