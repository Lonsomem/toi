const {chromium}=require('playwright');const fs=require('fs');const crypto=require('crypto');
const pdf=Buffer.concat([Buffer.from('%PDF-1.4\n'),crypto.randomBytes(12000),Buffer.from('\n%%EOF')]);
(async()=>{
const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
const ctx=await b.newContext({viewport:{width:1100,height:800}});
const p1=await ctx.newPage();const errs=[];p1.on('pageerror',e=>errs.push(e.message));
await p1.goto('file:///home/user/toi/qr-sender.html');
await p1.setInputFiles('#fileInput',[{name:'감정서_최종.pdf',mimeType:'application/pdf',buffer:pdf}]);
await p1.click('#btnPrepare');await p1.waitForFunction(()=>!document.getElementById('btnPlay').disabled,null,{timeout:30000});
const RGB=process.argv[2]==='rgb';await p1.evaluate((rgb)=>{document.getElementById('fps').value='8';document.getElementById('preset').value='12';document.getElementById('loopAll').checked=true;if(rgb){document.getElementById('rgb').checked=true;}},RGB);
await p1.dispatchEvent('#preset','change');
// 녹화 시작
await p1.evaluate(()=>{const st=document.getElementById('qr');window.__chunks=[];const s=st.captureStream(30);const mr=new MediaRecorder(s,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:8000000});mr.ondataavailable=e=>window.__chunks.push(e.data);mr.start(200);window.__mr=mr;});
await p1.click('#btnPlay');
await p1.waitForTimeout(RGB?12000:16000);
const b64=await p1.evaluate(async()=>{window.__mr.stop();await new Promise(r=>setTimeout(r,500));const blob=new Blob(window.__chunks,{type:'video/webm'});const buf=await blob.arrayBuffer();let s='';const u=new Uint8Array(buf);for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(s);});
const vid=Buffer.from(b64,'base64');fs.writeFileSync('/tmp/qrt_rec.webm',vid);console.log('recorded video bytes',vid.length);
const p2=await ctx.newPage();p2.on('pageerror',e=>errs.push('recv '+e.message));
await p2.goto('file:///home/user/toi/qr-receiver.html');
await p2.selectOption('#vrate','0.5');
await p2.setInputFiles('#videoFile',{name:'촬영영상.webm',mimeType:'video/webm',buffer:vid});
await p2.waitForFunction(()=>window.__qrxRecv.R.files,null,{timeout:150000}).catch(async e=>{console.log('NOT COMPLETE',await p2.textContent('#vMsg'),'|',await p2.textContent('#stateMsg'),'| detected',await p2.evaluate(()=>window.__qrxRecv.R.detected),'| segs',await p2.textContent('#sSegs'));});
const r=await p2.evaluate(async()=>{const f=window.__qrxRecv.R.files;if(!f)return null;return f.map(x=>({n:x.name,len:x.data.length}));});
console.log('result',r);
if(r){const h=await p2.evaluate(async()=>QX.toHex(await QX.sha256(window.__qrxRecv.R.files[0].data)));console.log('sha match',h===crypto.createHash('sha256').update(pdf).digest('hex'));}
console.log('errs',errs);
await b.close();})();
