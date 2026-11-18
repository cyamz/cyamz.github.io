// 校验并合并已发布 Flutter 产物；禁止从任意 URL 下载或越界解包。
import yauzl from 'yauzl';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateManifest(m) {
  if (m?.schemaVersion !== 1 || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(m.tag) ||
      !/^[a-f0-9]{40}$/.test(m.sourceSha) || !/^[a-f0-9]{64}$/.test(m.sha256) ||
      m.assetName !== `Tessera-${m.tag.slice(1)}-web.zip` || m.basePath !== `/tessera/app/${m.tag}/`) throw new Error('Web 发布清单格式无效');
  return m;
}
export function safeEntry(name, externalAttributes) {
  const mode = (externalAttributes >>> 16) & 0xf000;
  if (!name || name.includes('\\') || name.startsWith('/') || name.includes(':') ||
      name.replace(/\/$/, '').split('/').some(p => !p || p === '..' || p === '.' || /[. ]$/.test(p)) || /[\x00-\x1f]/.test(name) ||
      (mode !== 0 && mode !== 0x8000 && mode !== 0x4000)) throw new Error(`不安全 ZIP 条目：${name}`);
  return name;
}
async function extract(bytes, dir) {
  const zip = await new Promise((yes, no) => yauzl.fromBuffer(bytes, {lazyEntries: true, strictFileNames: true}, (e, z) => e ? no(e) : yes(z)));
  await new Promise((yes, no) => {
    let count = 0, total = 0;
    const names = new Set();
    const fail = error => { zip.close(); no(error); };
    zip.on('error', fail);
    zip.on('end', yes);
    zip.on('entry', async entry => {
      try {
        const name = safeEntry(entry.fileName, entry.externalFileAttributes);
        const key = name.toLowerCase().replace(/\/$/, '');
        if (++count > 20000 || names.has(key) || (total += entry.uncompressedSize) > 512 * 1024 * 1024) throw new Error('ZIP 条目重复或超出解包预算');
        names.add(key);
        const target = resolve(dir, name);
        if (!target.startsWith(resolve(dir) + sep)) throw new Error('ZIP 路径越界');
        if (name.endsWith('/')) await mkdir(target, {recursive: true});
        else {
          await mkdir(dirname(target), {recursive: true});
          const stream = await new Promise((yes, no) => zip.openReadStream(entry, (e, s) => e ? no(e) : yes(s)));
          const chunks = [];
          let length = 0;
          for await (const chunk of stream) {
            if ((length += chunk.length) > entry.uncompressedSize) throw new Error('ZIP 实际大小超出声明');
            chunks.push(chunk);
          }
          await writeFile(target, Buffer.concat(chunks), {flag: 'wx'});
        }
        zip.readEntry();
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
}
export async function installWeb({dist, manifest, bytes}) {
  validateManifest(manifest);
  if (bytes.length > 256 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('Web 包 SHA256 校验失败或超限');
  const appDir = resolve(dist, 'tessera/app');
  await mkdir(appDir, {recursive: true});
  const stage = await mkdtemp(join(appDir, '.install-'));
  try {
    await extract(bytes, stage);
    const meta = JSON.parse(await readFile(join(stage, 'tessera-build.json'), 'utf8'));
    if (['schemaVersion','tag','sourceSha','basePath'].some(k => meta[k] !== manifest[k])) throw new Error('Web 包元信息不匹配');
    for (const file of ['main.dart.js','flutter_bootstrap.js','assets/FontManifest.json']) await readFile(join(stage, file));
    const index = await readFile(join(stage, 'index.html'), 'utf8');
    if (!index.includes(`<base href="${manifest.basePath}">`)) throw new Error('Web base-href 不匹配');
    // 仅替换本应用的明确版本目录；所有校验完成后才触碰既有候选。
    const target = join(appDir, manifest.tag);
    await rm(target, {recursive: true, force: true});
    await rename(stage, target);
    await writeFile(join(appDir, 'tessera-release.json'), JSON.stringify(manifest));
    await writeFile(join(appDir, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Tessera 在线版</title><a href="${manifest.basePath}">进入在线版</a><script>location.replace(${JSON.stringify(manifest.basePath)}+location.search+location.hash)</script></html>`);
  } finally { await rm(stage, {recursive: true, force: true}); }
}
export async function downloadRelease(manifest) {
  validateManifest(manifest);
  const response = await fetch(`https://github.com/cyamz/Tessera/releases/download/${manifest.tag}/${manifest.assetName}`, {signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`Web 包下载失败：${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    if ((size += chunk.length) > 256 * 1024 * 1024) throw new Error('下载超过 256 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => process.argv[process.argv.indexOf(name) + 1];
  const manifestPath = process.argv.includes('--manifest') ? arg('--manifest') : 'src/data/tessera-web-release.json';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!process.argv.includes('--dist')) throw new Error('缺少 --dist');
  if (manifest === null) {
    const app = resolve(arg('--dist'), 'tessera/app');
    await mkdir(app, {recursive:true});
    await writeFile(join(app, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Tessera 在线版</title><p>首个 Web 版本尚未发布。</p><a href="/tessera/online/">查看发布状态</a></html>');
    console.log('尚无固定 Web 版本，仅生成明确的待发布入口');
    process.exit(0);
  }
  const local = process.argv.includes('--local-zip') ? arg('--local-zip') : null;
  await installWeb({dist: arg('--dist'), manifest, bytes: local ? await readFile(local) : await downloadRelease(manifest)});
  console.log(`Web 已合入：${manifest.tag} / ${manifest.sourceSha}`);
}
