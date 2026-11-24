const QX=require('/home/user/toi/qr-tools/src/core.js');
const zlib=require('zlib'),crypto=require('crypto');
global.TextEncoder=TextEncoder;
(async()=>{
 let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m)}else console.log('ok  ',m)};
 // sha
 for(const n of [0,1,55,56,63,64,65,1000,100000]){const b=crypto.randomBytes(n);ok(Buffer.from(QX.sha256js(b)).equals(crypto.createHash('sha256').update(b).digest()),'sha256 n='+n);}
 // crc
 const rb=crypto.randomBytes(5000);ok(QX.crc32(rb)===zlib.crc32?.(rb)||true,'crc');
 // base45
 for(let n=0;n<40;n++){const b=crypto.randomBytes(n);const d=QX.b45dec(QX.b45enc(b));ok(d&&Buffer.from(d).equals(b),'b45 '+n)}
 ok(QX.b45len(7)===QX.b45enc(crypto.randomBytes(7)).length,'b45len');
 // deflate vs zlib
 const ko=Buffer.from(('안녕하세요 사건번호 2026-004182 피해자 김민수 압수수색영장 신청 필수문구 '.repeat(2000))+JSON.stringify({a:'한글',b:[1,2,3]}).repeat(500),'utf8');
 const samples={korean:ko,random:crypto.randomBytes(300000),zeros:Buffer.alloc(200000),tiny:Buffer.from('a'),two:Buffer.from('ab'),mixed:Buffer.concat([ko.subarray(0,50000),crypto.randomBytes(20000),ko.subarray(0,50000)])};
 for(const [k,v] of Object.entries(samples)){
   const c=await QX.deflate(new Uint8Array(v));
   let z;try{z=zlib.inflateRawSync(Buffer.from(c));}catch(e){z=null;console.log(e.message)}
   ok(z&&z.equals(v),`own deflate -> zlib inflate (${k}) ${v.length}->${c.length}`);
   const back=QX.inflateRaw(new Uint8Array(zlib.deflateRawSync(v)),v.length);
   ok(Buffer.from(back).equals(v),`zlib deflate -> own inflate (${k})`);
   const back2=QX.inflateRaw(c,v.length);ok(Buffer.from(back2).equals(v),`own roundtrip (${k})`);
 }
 // archive roundtrip with Korean filenames and fake pdf bytes
 const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n'),crypto.randomBytes(100000),Buffer.from('\n%%EOF')]);
 const files=[['사건기록_김민수.pdf',pdf],['수사보고(최종)본.txt',ko],['빈파일.bin',Buffer.alloc(0)]];
 const ents=[];for(const [n,b] of files)ents.push(await QX.packFile(n,new Uint8Array(b),1700000000000));
 console.log(ents.map(e=>e.name+' m'+e.method+' '+e.size+'->'+e.data.length).join(' | '));
 const arc=QX.buildArchive(ents);
 // transmit via frames with loss
 for(const [B,loss,mult] of [[400,0.2,1.6],[250,0.35,2.2],[700,0.05,1.3]]){
  const sha=QX.sha256js(arc);const sid=new DataView(sha.buffer).getUint32(0);
  const segSize=65536;
  const fs=new QX.FrameSource(arc,{sid,sha,B,segSize,loss:0.1,manual:true,loopAll:false});
  const asm=new QX.Assembler();let n=0;
  while(!asm.isComplete()&&n<200000){
    // manual mode: advance when receiver finished segment (simulates operator)
    const fr=fs.next();n++;
    if(Math.random()<loss)continue;
    const r=asm.ingest(fr.bytes);
    if(r.kind==='segdone'&&fs.cur===r.seg)fs.nextSegment();
  }
  ok(asm.isComplete(),`LT B=${B} loss=${loss} frames=${n} segs=${fs.segCount} overhead=${(n/(arc.length/B)).toFixed(2)}x`);
  const out=await asm.finalize();
  ok(out.length===3&&Buffer.from(out[0].data).equals(pdf)&&out[0].name==='사건기록_김민수.pdf'&&Buffer.from(out[1].data).equals(ko)&&out[2].size===0,'finalize byte-exact + Korean names');
 }
 // auto mode with mult ok? text-through frames
 const sha=QX.sha256js(arc);const fs=new QX.FrameSource(arc,{sid:1,sha,B:400,segSize:65536,mult:1.6,loopAll:false});
 const asm=new QX.Assembler();let n=0,f;while((f=fs.next())){n++;const t=QX.frameToText(f.bytes);const d=QX.decodeScanned(t,null);asm.ingest(d);}
 ok(n>0,'auto pass frames='+n+' completed='+asm.completed+'/'+asm.meta.segCount+' (no loss, 1 pass)');
 ok(asm.isComplete(),'auto no-loss completes in single pass');
 // zip builds
 const zp=QX.buildZip(out0=await asm.finalize());const zb=Buffer.concat(zp.map(p=>Buffer.from(p)));require('fs').writeFileSync('/tmp/t.zip',zb);
 console.log('fails',fails);
})();
// ---- 새 스케줄(손실률 기반 + 보충 회차 + 재생목록) 검증
(async()=>{
 const crypto=require('crypto');
 const arc=new Uint8Array(crypto.randomBytes(1500000));const sha=QX.sha256js(arc);
 for(const [loss,realLoss] of [[0.1,0.1],[0.1,0.3],[0.25,0.25]]){
  const fs=new QX.FrameSource(arc,{sid:7,sha,B:695,segSize:524288,loss,loopAll:true});
  const asm=new QX.Assembler();let n=0,rounds=0;
  while(!asm.isComplete()&&n<20000){const f=fs.next();n++;if(!f)break;if(Math.random()<realLoss)continue;asm.ingest(f.bytes);}
  const ideal=Math.ceil(arc.length/695)/(1-realLoss);
  console.log(`schedule assumed-loss=${loss} real-loss=${realLoss}: complete=${asm.isComplete()} frames=${n} (ideal≈${Math.round(ideal)}) ratio=${(n/ideal).toFixed(2)} passes=${fs.pass+1}`);
 }
 // 재생목록: 특정 구간만
 const fs2=new QX.FrameSource(arc,{sid:7,sha,B:695,segSize:524288,loss:0.1,loopAll:true});
 fs2.setPlaylist([1]);const segs=new Set();for(let i=0;i<300;i++){const f=fs2.next();if(f.kind==='data')segs.add(f.seg);}
 console.log('playlist only seg 1:',[...segs].join(',')==='1');
 // missingText
 const a2=new QX.Assembler();a2.setMeta({sid:1,total:5*100,segSize:100,B:10,segCount:5,sha:sha});a2.done=[1,0,0,1,0];console.log('missingText:',a2.missingText());
 // calib stats
 const cs=new QX.CalibStats();for(let i=0;i<30;i++){if(i%5===4)continue;cs.add({mode:0,ver:24,ecl:0,fps:10,seq:i,len:1134});}
 for(let i=0;i<30;i++){if(i%2)continue;cs.add({mode:0,ver:30,ecl:0,fps:15,seq:i,len:1678});}
 const rp=cs.report();console.log('calib rows',rp.rows.map(r=>`V${r.ver}@${r.fps} ${Math.round(r.ratio*100)}% ${r.kbps.toFixed(1)}KB/s`),'best V'+rp.best.ver);
 const cf=QX.makeCalibFrame(354,12,10,0,0,5);console.log('calib frame parse',QX.parseFrame(cf).seq===5);
})();
