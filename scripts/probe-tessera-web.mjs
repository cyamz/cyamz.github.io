// 构建后及线上使用同一探针，验证真实 iframe ready 和版本。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
const arg = key => process.argv[process.argv.indexOf(key) + 1];
const release = JSON.parse(await readFile('src/data/tessera-web-release.json', 'utf8'));
let server;
let base = process.argv.includes('--base-url') ? arg('--base-url') : null;
if (process.argv.includes('--dist')) {
  const root = resolve(arg('--dist'));
  server = createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = resolve(root, '.' + pathname);
      const rel = relative(root, file);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('路径越界');
      const content = await readFile(file);
      const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.png':'image/png'};
      res.writeHead(200, {'content-type':mime[extname(file)] || 'application/octet-stream'}).end(content);
    } catch {res.writeHead(404).end();}
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
if (!base) throw new Error('需要 --dist 或 --base-url');
let browser;
try {
  for (const path of ['/', '/knowweft/', '/tessera/', '/tessera/online/', '/tessera/app/']) {
    const response = await fetch(base + path, {signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`官网路径失败：${path} ${response.status}`);
  }
  browser = await chromium.launch({headless:true, channel:'chromium'});
  for (const [width,height] of [[1440,900],[1024,768],[390,844]]) {
    const page = await browser.newPage({viewport:{width,height}});
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => {if(m.type() === 'error') errors.push(m.text());});
    await page.addInitScript(() => {
      window.__releaseMessage = null;
      window.addEventListener('message', event => {
        const frame = document.querySelector('#tessera-frame');
        if (frame && event.source === frame.contentWindow && event.origin === location.origin && event.data?.type === 'tessera-web') window.__releaseMessage = event.data;
      });
    });
    await page.goto(base + '/tessera/online/', {waitUntil:'domcontentloaded',timeout:60000});
    if (release) {
      await page.waitForFunction(() => window.__releaseMessage !== null, null, {timeout:120000});
      const message = await page.evaluate(() => window.__releaseMessage);
      if (message.status !== 'ready' || message.tag !== release.tag || message.sourceSha !== release.sourceSha) throw new Error('线上应用版本或 ready 不匹配');
      await page.getByRole('status').filter({hasText:'已就绪'}).waitFor();
      const live = await (await fetch(base + '/tessera/app/tessera-release.json', {cache:'no-store'})).json();
      if (live.tag !== release.tag || live.sourceSha !== release.sourceSha) throw new Error('稳定入口版本不一致');
    } else {
      await page.getByRole('status').filter({hasText:'尚未发布'}).waitFor();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (errors.length || overflow) throw new Error(`页面异常：${errors.join(';')} overflow=${overflow}`);
    await mkdir('.preview', {recursive:true});
    await page.screenshot({path:`.preview/tessera-online-${width}.png`,fullPage:true});
    await page.close();
    console.log(`PASS ${width}x${height} ${release ? release.tag : '待发布状态'}`);
  }
} finally {
  await browser?.close();
  if (server) await new Promise(r => server.close(r));
}
