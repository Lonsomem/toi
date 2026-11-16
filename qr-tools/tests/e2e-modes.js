const {chromium}=require('playwright');const fs=require('fs');const crypto=require('crypto');
const mode=process.argv[2]||'mono';
const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n'),crypto.randomBytes(150000),Buffer.from('\n%%EOF')]);
const txt=Buffer.from('수사보고 사건번호 2026-004182 피해자 김민수 압수수색영장\n'.repeat(4000),'utf8');
(async()=>{
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:850},acceptDownloads:true});
const p1=await ctx.newPage(),p2=await ctx.newPage();const errs=[];[p1,p2].forEach((p,i)=>p.on('pageerror',e=>errs.push('p'+(i+1)+' '+e.message)));
await p1.goto('file:///home/user/toi/qr-sender.html');
await p1.addScriptTag({path:'/home/user/toi/qr-tools/vendor/jsQR.js'});
await p1.evaluate(()=>{window.__texts=[];
 const o=CanvasRenderingContext2D.prototype.putImageData;
 CanvasRenderingContext2D.prototype.putImageData=function(img,x,y){
   if(img.width>300){ // QR 캔버스만
    const out=[];let r=jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});
    if(r&&r.data.indexOf('QX')===0)out.push(r.data);
    else{const g=new Uint8ClampedArray(img.data.length);for(let c=0;c<3;c++){QX.channelToGray(img.data,g,c);const rr=jsQR(g,img.width,img.height,{inversionAttempts:'dontInvert'});if(rr)out.push(rr.data);}}
    window.__texts.push(out);
   }
   return o.apply(this,arguments);};
 const sel=document.getElementById('segSize');const op=document.createElement('option');op.value='65536';op.textContent='64';sel.appendChild(op);sel.value='65536';
 document.getElementById('fps').value='30';document.getElementById('preset').value='12';
 if('MODE'==='rgb')document.getElementById('rgb').checked=true;});
if(mode==='rgb')await p1.evaluate(()=>{document.getElementById('rgb').checked=true;document.getElementById('rgb').dispatchEvent(new Event('change'));});
await p1.dispatchEvent('#preset','change');
await p2.goto('file:///home/user/toi/qr-receiver.html');
async function pump(maxMs,until,lossRate){let fed=0,drop=0,perFrameFail=0;const t0=Date.now();
 while(Date.now()-t0<maxMs){const batch=await p1.evaluate(()=>{const t=window.__texts;window.__texts=[];return t;});
  for(const arr of batch){ if(arr.length===0){perFrameFail++;continue;} for(const t of arr){if(Math.random()<lossRate){drop++;continue;} await p2.evaluate(tx=>{window.__qrxRecv.onFrame(QX.decodeScanned(tx,null));},t);fed++;}}
  if(await p2.evaluate(until))break;await p1.waitForTimeout(150);}
 return {fed,drop,perFrameFail,s:(Date.now()-t0)/1000};}
if(mode==='mono'||mode==='rgb'){
 await p1.setInputFiles('#fileInput',[{name:'사건기록.pdf',mimeType:'application/pdf',buffer:pdf},{name:'수사보고.txt',mimeType:'text/plain',buffer:txt}]);
 await p1.click('#btnPrepare');await p1.waitForFunction(()=>!document.getElementById('btnPlay').disabled,null,{timeout:60000});
 console.log('est:',(await p1.textContent('#est')).replace(/\s+/g,' '));
 await p1.click('#btnPlay');
 const r=await pump(180000,()=>!!window.__qrxRecv.R.files,0.2);
 console.log(mode,r);
 const ok=await p2.evaluate(async()=>{const f=window.__qrxRecv.R.files;if(!f)return null;const o={};for(const x of f)o[x.name]=QX.toHex(await QX.sha256(x.data));return o;});
 const want={'사건기록.pdf':crypto.createHash('sha256').update(pdf).digest('hex'),'수사보고.txt':crypto.createHash('sha256').update(txt).digest('hex')};
 console.log('byte-exact:',ok&&ok['사건기록.pdf']===want['사건기록.pdf']&&ok['수사보고.txt']===want['수사보고.txt'],'detected mode:',await p2.evaluate(()=>window.__qrxRecv.R.detected));
}
if(mode==='photo'){
 // 큰 JPEG 생성(브라우저 캔버스 노이즈) → 업로드 → 축소 체크
 const jpg=await p1.evaluate(async()=>{const c=document.createElement('canvas');c.width=4000;c.height=3000;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,4000,3000);g.addColorStop(0,'#246');g.addColorStop(1,'#fa4');x.fillStyle=g;x.fillRect(0,0,4000,3000);
  for(let i=0;i<60000;i++){x.fillStyle='rgba('+(Math.random()*255|0)+','+(Math.random()*255|0)+','+(Math.random()*255|0)+',0.5)';x.fillRect(Math.random()*4000,Math.random()*3000,20,20);}
  x.fillStyle='#fff';x.font='200px sans-serif';x.fillText('TOP-LEFT',50,250);
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.95));const u=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(s);});
 const buf=Buffer.from(jpg,'base64');console.log('원본 JPEG',(buf.length/1048576).toFixed(2),'MB');
 await p1.setInputFiles('#fileInput',[{name:'현장사진 001.jpg',mimeType:'image/jpeg',buffer:buf}]);
 await p1.click('#btnImgAll');
 await p1.click('#btnPrepare');await p1.waitForFunction(()=>!document.getElementById('btnPlay').disabled,null,{timeout:60000});
 console.log('prep:',await p1.textContent('#prepMsg'));
 console.log('row:',(await p1.textContent('#fileList li')).replace(/\s+/g,' '));
 console.log('has thumbnail:',await p1.$('#fileList img.th')!==null);
 const names=await p1.evaluate(()=>window.__qrxSender.entries.map(e=>e.name+' '+e.size));console.log('entries',names);
 // 재생 안 함: 직접 수신 경로 검증 (아카이브 → 파일)
 const dims=await p1.evaluate(async()=>{const e=window.__qrxSender.entries[0];const blob=new Blob([e.data],{type:'image/jpeg'});const bmp=await createImageBitmap(blob);return [bmp.width,bmp.height];});console.log('reduced dims',dims);
}
if(mode==='calib'){
 await p1.click('#btnCalib');
 const r=await pump(150000,()=>{const rp=window.__qrxRecv.R.calib.report();return rp.rows.length>=11;},0.0);
 console.log('calib pump',r);
 const rep=await p2.evaluate(()=>{const rp=window.__qrxRecv.R.calib.report();return {rows:rp.rows.map(x=>(x.mode?'RGB ':'흑백 ')+'V'+x.ver+(x.ecl?'M':'L')+'@'+x.fps+' '+Math.round(x.ratio*100)+'% '+x.kbps.toFixed(1)+'KB/s'),best:rp.best&&('V'+rp.best.ver+'@'+rp.best.fps+' mode'+rp.best.mode)};});
 console.log(rep);
 await p2.evaluate(()=>{});const txtBest=await p2.textContent('#calibBest');console.log('UI:',txtBest);
}
console.log('errors:',errs);
await b.close();})();
