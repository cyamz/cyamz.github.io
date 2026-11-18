// 仅接受当前 iframe、同源且与清单一致的应用消息。
export function acceptsMessage(event, frameWindow, origin, release) {
  const m = event.data;
  return !!release && event.source === frameWindow && event.origin === origin &&
    m?.type === 'tessera-web' && ['ready', 'error'].includes(m.status) &&
    m.tag === release.tag && m.sourceSha === release.sourceSha;
}
export function attachOnline({frame, status, retry, release, windowObject = window, timeoutMs = 30000}) {
  let timer;
  const loading = () => {
    clearTimeout(timer);
    status.textContent = '正在加载 Tessera…';
    timer = setTimeout(() => {status.textContent = '加载时间较长，可重试或直接打开。';}, timeoutMs);
  };
  const receive = event => {
    if (!acceptsMessage(event, frame.contentWindow, windowObject.location.origin, release)) return;
    clearTimeout(timer);
    status.textContent = event.data.status === 'ready' ? '已就绪，数据在当前浏览器中处理。' : '应用加载失败，请重试或下载桌面版。';
  };
  const reload = () => {loading(); frame.src = release.basePath;};
  windowObject.addEventListener('message', receive);
  retry.addEventListener('click', reload);
  loading();
  frame.src = release.basePath;
  return () => {clearTimeout(timer); windowObject.removeEventListener('message', receive); retry.removeEventListener('click', reload);};
}
