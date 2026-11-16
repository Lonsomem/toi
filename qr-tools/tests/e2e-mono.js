const {chromium}=require('playwright');const fs=require('fs');const crypto=require('crypto');
const D='/tmp/qrt_files';fs.mkdirSync(D,{recursive:true});
const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n'),crypto.randomBytes(120000),Buffer.from('\n%%EOF')]);
fs.writeFileSync(D+'/사건기록_김민수.pdf',pdf);
const txt=Buffer.from('안녕하세요 수사보고 사건번호 2026-004182 피해자 김민수 압수수색영장 신청 필수문구\n'.repeat(3000),'utf8');
fs.writeFileSync(D+'/수사보고(최종).txt',txt);
fs.copyFileSync(D+'/saved_note.html',D+'/사건노트.html');fs.writeFileSync(D+'/report-final.txt','plain ascii name file\n');
const names=['사건기록_김민수.pdf','수사보고(최종).txt','사건노트.html','report-final.txt'];
const orig=names.map(n=>fs.readFileSync(D+'/'+n));
(async()=>{
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:850},acceptDownloads:true});
const p1=await ctx.newPage(),p2=await ctx.newPage();
const errs=[];[p1,p2].forEach((p,i)=>{p.on('pageerror',e=>errs.push('p'+(i+1)+' '+e.message));});
await p1.addInitScript(()=>{window.__texts=[];});
await p1.goto('file:///home/user/toi/qr-sender.html');
await p1.addScriptTag({path:'/home/user/toi/qr-tools/vendor/jsQR.js'});
await p1.evaluate(()=>{const o=CanvasRenderingContext2D.prototype.putImageData;CanvasRenderingContext2D.prototype.putImageData=function(img,x,y){const r=jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});window.__texts.push(r?r.data:null);return o.apply(this,arguments);};
 const sel=document.getElementById('segSize');const op=document.createElement('option');op.value='65536';op.textContent='64';sel.appendChild(op);sel.value='65536';
 document.getElementById('fps').value='30';document.getElementById('preset').value='12';});
await p1.setInputFiles('#fileInput',names.map((n,i)=>({name:n,mimeType:'application/octet-stream',buffer:orig[i]})));
await p1.click('#btnPrepare');
await p1.waitForFunction(()=>!document.getElementById('btnPlay').disabled,null,{timeout:60000});
console.log('prep:',await p1.textContent('#prepMsg'));console.log('est:',(await p1.textContent('#est')).replace(/\s+/g,' '));
console.log('files:',await p1.$$eval('#fileList li',l=>l.map(x=>x.innerText.replace(/\n/g,' | '))));
await p1.dispatchEvent('#preset','change');
await p1.click('#btnPlay');
await p2.goto('file:///home/user/toi/qr-receiver.html');
let fed=0,dropped=0,decodeFail=0,idx=0;
const t0=Date.now();
while(Date.now()-t0<240000){
  const batch=await p1.evaluate(()=>{const t=window.__texts;window.__texts=[];return t;});
  for(const t of batch){if(t===null){decodeFail++;continue;} if(Math.random()<0.2){dropped++;continue;}
    await p2.evaluate(tx=>{const fr=QX.decodeScanned(tx,null);window.__qrxRecv.onFrame(fr);},t);fed++;}
  const done=await p2.evaluate(()=>window.__qrxRecv.R.asm.isComplete());
  if(done)break;
  await p1.waitForTimeout(200);
}
console.log({fed,dropped,decodeFail,seconds:(Date.now()-t0)/1000});
await p2.waitForFunction(()=>window.__qrxRecv.R.files,null,{timeout:30000});
console.log('verify:',await p2.textContent('#verifyMsg'));
const res=await p2.evaluate(()=>window.__qrxRecv.R.files.map(f=>({n:f.name,h:Array.from(f.data.slice(0,0)),len:f.data.length})));
const got=await p2.evaluate(async()=>{const o=[];for(const f of window.__qrxRecv.R.files){const h=await QX.sha256(f.data);o.push({n:f.name,h:QX.toHex(h)});}return o;});
let ok=true;names.forEach((n,i)=>{const h=crypto.createHash('sha256').update(orig[i]).digest('hex');const g=got.find(x=>x.n===n);const m=g&&g.h===h;if(!m)ok=false;console.log(m?'MATCH':'MISMATCH',n,orig[i].length);});
// downloads
const [d1]=await Promise.all([p2.waitForEvent('download'),p2.click('#resultList li:nth-child(1) button')]);
console.log('download name (pdf):',d1.suggestedFilename(),fs.readFileSync(await d1.path()).equals(pdf));const [da]=await Promise.all([p2.waitForEvent('download'),p2.click('#resultList li:nth-child(4) button')]);console.log('download name (ascii):',da.suggestedFilename());
const [dz]=await Promise.all([p2.waitForEvent('download'),p2.click('#btnZip')]);fs.copyFileSync(await dz.path(),'/tmp/qrt_out.zip');
const [dj]=await Promise.all([p2.waitForEvent('download'),p2.click('#resultList li:nth-child(3) button:nth-of-type(2)')]);
const js=JSON.parse(fs.readFileSync(await dj.path(),'utf8').replace(/^﻿/,''));console.log('json:',dj.suggestedFilename(),js.version,js.exportedAt,js.cases.length,Object.keys(js.template));
console.log('ALL OK:',ok,'errors:',errs);
await b.close();})();
