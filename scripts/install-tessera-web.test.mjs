import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import yazl from 'yazl';
import { installWeb, validateManifest, safeEntry } from './install-tessera-web.mjs';

const meta = {schemaVersion: 1, tag: 'v0.2.2', sourceSha: 'a'.repeat(40), basePath: '/tessera/app/v0.2.2/'};
const makeManifest = bytes => ({...meta, assetName: 'Tessera-0.2.2-web.zip', sha256: createHash('sha256').update(bytes).digest('hex')});
async function zip(entries) {
  const archive = new yazl.ZipFile();
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    archive.outputStream.on('data', data => chunks.push(data));
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on('error', reject);
  });
  for (const [name, content] of Object.entries(entries)) archive.addBuffer(Buffer.from(content), name);
  archive.end();
  return done;
}
test('安装完整包并生成稳定跳转；hash 或版本不符拒绝', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'tessera-install-'));
  const bytes = await zip({'index.html': `<base href="${meta.basePath}">`, 'main.dart.js': 'app',
    'flutter_bootstrap.js': 'boot', 'assets/FontManifest.json': '[]', 'tessera-build.json': JSON.stringify(meta)});
  try {
    await mkdir(join(dist, 'tessera'), {recursive: true});
    await installWeb({dist, manifest: makeManifest(bytes), bytes});
    assert.equal(await readFile(join(dist, meta.basePath, 'main.dart.js'), 'utf8'), 'app');
    assert.match(await readFile(join(dist, 'tessera/app/index.html'), 'utf8'), /location\.hash/);
    await assert.rejects(installWeb({dist, manifest: {...makeManifest(bytes), sha256: '0'.repeat(64)}, bytes}), /校验/);
    await assert.rejects(installWeb({dist, manifest: {...makeManifest(bytes), sourceSha: 'c'.repeat(40)}, bytes}), /元信息/);
    assert.equal(await readFile(join(dist, meta.basePath, 'main.dart.js'), 'utf8'), 'app');
  } finally { await rm(dist, {recursive: true, force: true}); }
});
test('拒绝任意来源、穿越、盘符、反斜杠和符号链接', () => {
  assert.throws(() => validateManifest({...meta, assetName: 'x.zip', sha256: '0'.repeat(64)}));
  for (const name of ['../a', '/a', 'C:/a', 'a\\b', 'a/../b', 'a/.. /b', 'a//b', 'a./b']) assert.throws(() => safeEntry(name, 0));
  assert.throws(() => safeEntry('link', 0o120777 << 16));
});
test('缺启动资源的候选不替换现有版本',async()=>{
  const dist=await mkdtemp(join(tmpdir(),'tessera-incomplete-'));
  try {
    const bytes=await zip({'index.html':`<base href="${meta.basePath}">`,'tessera-build.json':JSON.stringify(meta)});
    await assert.rejects(installWeb({dist,manifest:makeManifest(bytes),bytes}));
    await assert.rejects(readFile(join(dist,meta.basePath,'index.html')));
  } finally {await rm(dist,{recursive:true,force:true});}
});
