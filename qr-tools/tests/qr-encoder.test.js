const fs=require('fs');const vm=require('vm');
const jsQR=require('jsqr');
const src=fs.readFileSync('/home/user/toi/qr-tools/src/core.js','utf8')+'\n'+fs.readFileSync('/home/user/toi/qr-tools/src/qr-encoder.js','utf8')+'\n;this.QX=QX;';
const ctx={TextEncoder,TextDecoder,console,Math};vm.createContext(ctx);vm.runInContext(src,ctx);const QX=ctx.QX;
function render(qr,scale=4){const q=4,n=qr.size+8,px=n*scale;const d=new Uint8ClampedArray(px*px*4).fill(255);
 for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.modules[y*qr.size+x])for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++){const o=(((y+q)*scale+yy)*px+(x+q)*scale+xx)*4;d[o]=d[o+1]=d[o+2]=0;}
 return {d,px};}
let bad=0,tot=0;
const A='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
for(const ecl of ['L','M'])for(let ver=1;ver<=40;ver++){
 for(const mode of ['alnum','byte']){
  const cap=QX.QR.capacity(ver,ecl,mode);let input,expect;
  if(mode==='alnum'){let s='QX';while(s.length<cap)s+=A[Math.floor(Math.random()*45)];input=s;expect=s;}
  else{input=new Uint8Array(cap);for(let i=0;i<cap;i++)input[i]=Math.floor(Math.random()*256);input[0]=0x51;input[1]=0x42;expect=input;}
  tot++;
  try{const qr=QX.QR.encode(input,{mode,ver,ecl});const {d,px}=render(qr,4);const r=jsQR(d,px,px,{inversionAttempts:'dontInvert'});
   let okk=false;if(r){if(mode==='alnum')okk=r.data===expect;else okk=Buffer.from(r.binaryData).equals(Buffer.from(expect));}
   if(!okk){bad++;console.log('FAIL',ecl,ver,mode,r?'mismatch':'nodecode');}
  }catch(e){bad++;console.log('ERR',ecl,ver,mode,e.message)}
 }
}
console.log('total',tot,'bad',bad);
// frame-level test: alnum text of real frame in V18 and binary
const f=QX.makeDataFrame(123,1,5,new Uint8Array(300).map((_, i)=>i));
const t=QX.frameToText(f);const qr=QX.QR.encode(t,{mode:'alnum',ver:18,ecl:'L'});const {d,px}=render(qr,5);const r=jsQR(d,px,px);
console.log('frame text roundtrip',r&&QX.parseFrame(QX.decodeScanned(r.data,r.binaryData)).sym===5);
const bn=QX.frameToBinary(f);const qr2=QX.QR.encode(bn,{mode:'byte',ver:18,ecl:'L'});const o2=render(qr2,5);const r2=jsQR(o2.d,o2.px,o2.px);
console.log('frame binary roundtrip',r2&&QX.parseFrame(QX.decodeScanned(r2.data,r2.binaryData)).sym===5);
for(const v of [12,18,24,30])console.log('V'+v,'L alnum frameBytes',QX.QR.maxFrameBytes(v,'L',false),'binary',QX.QR.maxFrameBytes(v,'L',true));
const t0=Date.now();for(let i=0;i<30;i++)QX.QR.encode(t,{mode:'alnum',ver:18,ecl:'L'});console.log('encode ms/frame V18',(Date.now()-t0)/30);
