// 手动回滚只接受公开分发仓的正式附件，校验后更新同一持久清单。
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest, installWeb, downloadRelease } from './install-tessera-web.mjs';
const tag = process.argv[2];
if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw new Error('回滚 tag 无效');
const response = await fetch(`https://github.com/cyamz/Tessera/releases/download/${tag}/tessera-release.json`, {signal:AbortSignal.timeout(30000)});
if (!response.ok) throw new Error(`版本清单下载失败：${response.status}`);
const manifest = validateManifest(await response.json());
if (manifest.tag !== tag) throw new Error('清单 tag 不匹配');
const current = JSON.parse(await readFile('src/data/tessera-web-release.json','utf8'));
if (current?.tag === tag && (current.sourceSha !== manifest.sourceSha || current.sha256 !== manifest.sha256)) throw new Error('同 tag 版本冲突');
const blocked=new Set(current?.blockedTags || []);
blocked.delete(tag);
if(current && current.tag!==tag) {
  const a=current.tag.slice(1).split('.').map(BigInt),b=tag.slice(1).split('.').map(BigInt);
  const i=a.findIndex((v,n)=>v!==b[n]);
  if(a[i]>b[i]) blocked.add(current.tag);
}
if(blocked.size) manifest.blockedTags=[...blocked];
const dir = await mkdtemp(join(tmpdir(),'tessera-rollback-'));
try {
  await installWeb({dist:dir,manifest,bytes:await downloadRelease(manifest)});
  await writeFile('src/data/tessera-web-release.json', JSON.stringify(manifest,null,2)+'\n');
} finally {await rm(dir,{recursive:true,force:true});}
