const crypto=require('crypto');
const SftpClient=require('ssh2-sftp-client');

const TOKEN_SHA256='c416b46fa4e2b210647f0e98ffad9fc00b5d7a911c400106bf52b1241def88af';
const HOST='access-5021474650.ud-webspace.de';
const PORT=22;
const USERNAME='a2509659';
const BASE='https://raw.githubusercontent.com/maxvongrone-ai/frauenarztpraxis-vongrone-preview/ud-site-v5-20261012/website/';
const FILES=[
  {src:'assets/style.css',dst:'/frauenarztpraxis/assets/style.css',sha256:'630dcaae920daa8f70b25d0e09f4ed0f5cb67394bc4096c6679ae972cc302b7c'},
  {src:'schwangerschaft/index.html',dst:'/frauenarztpraxis/schwangerschaft/index.html',sha256:'45f5fe1880b8031500317520a13bd1a4e16ab69997972079c68b899211f027b7'},
  {src:'wechseljahre/index.html',dst:'/frauenarztpraxis/wechseljahre/index.html',sha256:'c855b3f73d765aa3349a5d35efec15aebf2d2477ae2cb7f5260c509d27fffaf0'},
  {src:'brustultraschall/index.html',dst:'/frauenarztpraxis/brustultraschall/index.html',sha256:'3fbb77b0b8a8761475d8fe7bb794c07e848f23c40d8f9a6a0a6c8396c5faf398'},
  {src:'privat-selbstzahler/index.html',dst:'/frauenarztpraxis/privat-selbstzahler/index.html',sha256:'e9e542f3ea284a5e4100edef1db6012775ccc4fbc6970b7749db35b6f74a3c07'},
  {src:'index.html',dst:'/frauenarztpraxis/index.html',sha256:'c821e70ffba6ef2c681215e5ecfc81de8c1f135c1bb5f5d609987ccea30af996'}
];

function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.end(JSON.stringify(body));
}
function authOk(token){
  const digest=crypto.createHash('sha256').update(String(token||''),'utf8').digest('hex');
  const A=Buffer.from(digest,'hex'),B=Buffer.from(TOKEN_SHA256,'hex');
  return A.length===B.length&&crypto.timingSafeEqual(A,B);
}
async function bodyJson(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}
  let raw='';
  for await(const chunk of req){raw+=chunk;if(raw.length>8192)throw new Error('Payload zu groß.')}
  try{return JSON.parse(raw||'{}')}catch{return {}}
}
async function ensureDir(sftp,path){
  const dir=path.split('/').slice(0,-1).join('/')||'/';
  if(!await sftp.exists(dir))await sftp.mkdir(dir,true);
}

module.exports=async function handler(req,res){
  if(req.method==='GET'){
    res.statusCode=200;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('Pragma','no-cache');
    res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
    return res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Praxiswebsite aktualisieren</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:56px auto;padding:0 20px;color:#303536}h1{font-size:28px}input,button{font:inherit;padding:12px 14px;border-radius:10px;box-sizing:border-box}input{border:1px solid #d9d2ce;width:min(430px,100%)}button{border:0;background:#765f56;color:#fff;margin-top:12px;cursor:pointer}button:disabled{opacity:.55}pre{white-space:pre-wrap;background:#f6f3f1;padding:14px;border-radius:10px;min-height:30px}.ok{color:#18733b}.bad{color:#a33a3a}</style></head><body><h1>Aktualisierte Praxiswebsite übertragen</h1><p>Übertragen werden ausschließlich die <strong>freigegebene Website V5 (12.10.2026)</strong>: Startseite, gemeinsame CSS-Datei und vier Leistungsseiten. Die mediDate-Terminbuchung wird nicht geändert.</p><p>Bitte das aktuell gültige <strong>SFTP-Passwort von United Domains</strong> eingeben. Es wird nur für diese Übertragung verwendet und nicht gespeichert.</p><input id="pw" type="password" autocomplete="off" placeholder="SFTP-Passwort"><br><button id="go">Übertragung starten</button><p id="s"></p><pre id="out"></pre><script>const p=new URLSearchParams(location.hash.slice(1));go.onclick=async()=>{const password=pw.value;if(!password){s.className='bad';s.textContent='Bitte zuerst das SFTP-Passwort eingeben.';return}go.disabled=true;s.className='';s.textContent='Übertragung läuft …';out.textContent='';try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:p.get('token')||'',pw:password})});const j=await r.json();out.textContent=JSON.stringify(j,null,2);s.className=j.ok?'ok':'bad';s.textContent=j.ok?'Erfolgreich übertragen.':'Fehler bei der Übertragung.'}catch(e){s.className='bad';s.textContent='Fehler.';out.textContent=String(e)}finally{go.disabled=false;pw.value=''}}</script></body></html>`);
  }
  if(req.method!=='POST')return send(res,405,{ok:false,error:'Methode nicht erlaubt.'});
  const body=await bodyJson(req);
  if(!authOk(body.token))return send(res,404,{ok:false});
  if(Date.now()>Date.UTC(2026,9,14,0,0,0))return send(res,410,{ok:false,error:'Dieser Upload-Dialog ist abgelaufen.'});
  const password=String(body.pw||'');
  if(!password)return send(res,400,{ok:false,error:'SFTP-Passwort fehlt.'});

  const loaded=[];
  for(const f of FILES){
    const r=await fetch(BASE+f.src,{headers:{'User-Agent':'Praxis-Website-Publisher/1.0'},cache:'no-store'});
    if(!r.ok)return send(res,502,{ok:false,error:'Quelle konnte nicht geladen werden: '+f.src+' (HTTP '+r.status+')'});
    const txt=await r.text();
    const digest=crypto.createHash('sha256').update(txt,'utf8').digest('hex');
    if(digest!==f.sha256)return send(res,409,{ok:false,error:'Die freigegebene Datei stimmt nicht mit der geprüften V5 überein: '+f.src});
    loaded.push({...f,text:txt});
  }

  const sftp=new SftpClient();
  try{
    await sftp.connect({host:HOST,port:PORT,username:USERNAME,password,readyTimeout:20000,keepaliveInterval:5000,keepaliveCountMax:2});
    // First back up all existing destination files in memory. Do not touch any other webspace files.
    const original=new Map();
    for(const f of loaded){
      await ensureDir(sftp,f.dst);
      const exists=await sftp.exists(f.dst);
      original.set(f.dst,exists?await sftp.get(f.dst):null);
    }
    const uploaded=[];
    try{
      for(const f of loaded){
        await sftp.put(Buffer.from(f.text,'utf8'),f.dst);
        const readback=await sftp.get(f.dst);
        const digest=crypto.createHash('sha256').update(readback).digest('hex');
        if(digest!==f.sha256)throw new Error('SFTP-Inhaltsprüfung fehlgeschlagen: '+f.src);
        uploaded.push({file:f.dst,bytes:Buffer.byteLength(f.text,'utf8'),verified:true});
      }
    }catch(e){
      const rollbackErrors=[];
      for(const f of [...loaded].reverse()){
        if(!uploaded.some(x=>x.file===f.dst)&&f.dst!==(loaded[uploaded.length]||{}).dst)continue;
        try{const prev=original.get(f.dst);if(prev===null)await sftp.delete(f.dst);else await sftp.put(prev,f.dst)}
        catch(re){rollbackErrors.push(f.dst)}
      }
      if(rollbackErrors.length)throw new Error('Upload fehlgeschlagen; Wiederherstellung prüfen: '+rollbackErrors.join(', '));
      throw e;
    }
    return send(res,200,{ok:true,uploaded,websiteVersion:'2026-10-12-v5'});
  }catch(e){
    console.error('Website publish failed',{message:e?.message});
    return send(res,500,{ok:false,error:String(e?.message||e)});
  }finally{
    try{await sftp.end()}catch{}
  }
};
