const {chromium}=require('playwright');const fs=require('fs');fs.mkdirSync('/tmp/qrt_files',{recursive:true});
(async()=>{const b=await chromium.launch();const p=await b.newPage();await p.goto('file:///home/user/toi/case-note.html');
const h=await p.evaluate(()=>app.buildCleanHtmlDocumentString());fs.writeFileSync('/tmp/qrt_files/saved_note.html',h,'utf8');console.log(h.length);await b.close();})();
