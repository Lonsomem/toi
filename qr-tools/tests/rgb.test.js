const fs=require('fs');const vm=require('vm');const jsQR=require('jsqr');
const src=['core.js','qr-encoder.js'].map(f=>fs.readFileSync('/home/user/toi/qr-tools/src/'+f,'utf8')).join('\n')+'\n;this.QX=QX;';
const ctx={TextEncoder,TextDecoder,console,Math};vm.createContext(ctx);vm.runInContext(src,ctx);const QX=ctx.QX;
const crypto=require('crypto');
function render3(qrs,scale){const q=4,size=qrs[0].size,n=size+8,px=n*scale;const d=new Uint8ClampedArray(px*px*4).fill(255);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=y*size+x;const c=[0,1,2].map(k=>qrs[k].modules[i]?0:255);for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++){const o=(((y+q)*scale+yy)*px+(x+q)*scale+xx)*4;d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];}}return {d,px};}
// 색 번짐(크로스토크)+노이즈+약한 블러 시뮬레이션
function degrade(d,px,xt,noise){const o=new Uint8ClampedArray(d.length);
 for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];
  const R=r*(1-xt)+g*xt*0.7+b*xt*0.3,G=g*(1-2*xt)+r*xt+b*xt,B=b*(1-xt)+g*xt*0.7+r*xt*0.3;
  o[i]=R+(Math.random()-.5)*noise;o[i+1]=G+(Math.random()-.5)*noise;o[i+2]=B+(Math.random()-.5)*noise;o[i+3]=255;}
 // 3x3 box blur
 const bl=new Uint8ClampedArray(o.length);for(let y=1;y<px-1;y++)for(let x=1;x<px-1;x++)for(let c=0;c<3;c++){let s=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)s+=o[((y+dy)*px+x+dx)*4+c];bl[(y*px+x)*4+c]=s/9;bl[(y*px+x)*4+3]=255;}
 return bl;}
for(const ver of [12,18,24]){for(const [xt,noise,blur] of [[0,0,false],[0.12,20,true],[0.2,30,true],[0.3,40,true]]){
 let okc=0,tot=0;
 for(let t=0;t<4;t++){
  const frames=[0,1,2].map(k=>QX.makeCalibFrame(QX.QR.maxFrameBytes(ver,'L',false),ver,10,0,1,t*3+k));
  const qrs=frames.map(f=>QX.QR.encode(QX.frameToText(f),{mode:'alnum',ver,ecl:'L'}));
  const scale=6;let {d,px}=render3(qrs,scale);if(xt>0||noise>0)d=degrade(d,px,xt,noise);
  const gray=new Uint8ClampedArray(d.length);
  for(let c=0;c<3;c++){QX.channelToGray(d,gray,c);const r=jsQR(gray,px,px,{inversionAttempts:'dontInvert'});tot++;if(r){const fb=QX.decodeScanned(r.data,r.binaryData);const p=fb&&QX.parseFrame(fb);if(p&&p.seq===t*3+c)okc++;}}
 }
 console.log('V'+ver,'crosstalk',xt,'noise',noise,'blur',blur,'->',okc+'/'+tot,'channels decoded');
}}
