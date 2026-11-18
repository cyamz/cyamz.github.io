import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsMessage, attachOnline } from '../src/scripts/tessera-online.mjs';
const release = {tag:'v0.2.2',sourceSha:'a'.repeat(40),basePath:'/tessera/app/v0.2.2/'};
test('拒绝其他窗口、来源、版本及协议消息', () => {
  const frame = {};
  const event = {source:frame,origin:'https://cyamz.top',data:{type:'tessera-web',status:'ready',...release}};
  assert.equal(acceptsMessage(event,frame,event.origin,release),true);
  for (const altered of [{...event,source:{}},{...event,origin:'https://evil.test'}, {...event,data:{...event.data,sourceSha:'bad'}}, {...event,data:{...event.data,type:'other'}}]) {
    assert.equal(acceptsMessage(altered,frame,event.origin,release),false);
  }
});
test('超时可被晚到 ready 恢复；重试重置状态', async () => {
  const frame = {contentWindow:{},src:release.basePath}, status = {};
  let handler, click;
  const stop=attachOnline({frame,status,release,timeoutMs:5,
    retry:{addEventListener:(_,f)=>{click=f;},removeEventListener:()=>{}},
    windowObject:{location:{origin:'https://cyamz.top'},addEventListener:(_,f)=>{handler=f;},removeEventListener:()=>{}}});
  await new Promise(r=>setTimeout(r,15));
  assert.match(status.textContent,/较长/);
  handler({source:frame.contentWindow,origin:'https://cyamz.top',data:{type:'tessera-web',status:'ready',...release}});
  assert.match(status.textContent,/已就绪/);
  click(); assert.match(status.textContent,/正在加载/); stop();
});
