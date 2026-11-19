const QX=require('/home/user/toi/qr-tools/src/core.js');const crypto=require('crypto');
for(const [segKB,B] of [[256,695],[512,695],[1024,695],[512,354]]){
 for(const loss of [0,0.1,0.25,0.4]){
  const arc=new Uint8Array(crypto.randomBytes(segKB*1024));const K=Math.ceil(arc.length/B);
  const rs=[];let allok=true;
  for(let trial=0;trial<5;trial++){
   const dec=new QX.SegmentDecoder(K,B,arc.length,trial);let n=0,recv=0;const t=Date.now();
   while(!dec.complete()&&n<K*6){const id=n++;if(Math.random()<loss)continue;recv++;dec.add(id,QX.makeSymbol(arc,B,K,trial,id));}
   if(!dec.complete()||!Buffer.from(dec.getData()).equals(Buffer.from(arc)))allok=false;rs.push(recv/K);
  }
  console.log(`seg ${segKB}KB B=${B} K=${K} loss=${loss}: received/K avg ${(rs.reduce((a,b)=>a+b)/5).toFixed(3)} max ${Math.max(...rs).toFixed(3)} ok=${allok}`);
 }}
