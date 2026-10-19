'use strict';
const crypto=require('crypto');
const SftpClient=require('ssh2-sftp-client');
const TOKEN_SHA256='d166f86c491cbbd714d42b0436e8f8a53be8cfd1be7a294344f0097c48cb4a8a';
const EXPIRES=Date.parse('2026-10-24T23:59:00+02:00');
const SOURCE='https://raw.githubusercontent.com/maxvongrone-ai/frauenarztpraxis-vongrone-preview/8f85ecb6457db45945a3845cc4f9d21dae7818af/website/index.html';
const DEST='/frauenarztpraxis/index.html';
function send(res,status,payload){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex,nofollow,noarchive');
  res.end(JSON.stringify(payload));
}
function authenticated(token){
  const digest=crypto.createHash('sha256').update(String(token||''),'utf8').digest();
  return crypto.timingSafeEqual(digest,Buffer.from(TOKEN_SHA256,'hex'));
}
async function parseBody(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}
  let str='';
  for await(const block of req){str+=block;if(str.length>8192)throw new Error('Daten zu groß');}
  try{return JSON.parse(str||'{}')}catch{return {}}
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex,nofollow,noarchive');
  if(req.method==='GET'){
    res.statusCode=200;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    return res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>United Domains – Oktober-Banner hochladen</title><style>body{font-family:system-ui,-apple-system,Arial,sans-serif;max-width:690px;margin:48px auto;padding:0 20px;color:#263332}h1{font-size:25px}p{line-height:1.6}input{display:block;width:min(430px,100%);box-sizing:border-box;padding:12px;border:1px solid #aaa;border-radius:8px;font:inherit;margin:16px 0}button{font:inherit;background:#365b4d;color:#fff;border:0;border-radius:8px;padding:13px 20px;cursor:pointer}button:disabled{opacity:.5}pre{white-space:pre-wrap;overflow-wrap:anywhere}.ok{color:#086b39}.bad{color:#a22}</style></head><body><h1>Praxiswebsite – Oktober-Banner hochladen</h1><p>Übertragen wird ausschließlich die aktualisierte <strong>index.html</strong> nach <code>/frauenarztpraxis/index.html</code> bei United Domains. Die Startseite enthält die vier Schließungshinweise mit automatischer Umschaltung und Ausblendung am 30.10.2026, 18:00 Uhr. Andere Seiten und die Terminbuchung bleiben unverändert.</p><p>Bitte das <strong>SFTP-Passwort von United Domains</strong> eingeben. Es wird nur für die verschlüsselte Verbindung zur Übertragung verwendet und weder im Browser gespeichert noch in Protokolle geschrieben.</p><label for="pw">SFTP-Passwort</label><input id="pw" type="password" autocomplete="off"><button id="go" type="button">Übertragung starten</button><p id="status" role="status" aria-live="polite"></p><pre id="details"></pre><script>const pw=document.getElementById('pw'),go=document.getElementById('go'),status=document.getElementById('status'),details=document.getElementById('details');go.onclick=async()=>{const p=pw.value;if(!p){status.textContent='Bitte zuerst das Passwort eingeben.';return}go.disabled=true;status.className='';status.textContent='Verbindung und Übertragung werden geprüft …';details.textContent='';try{const token=new URLSearchParams(location.hash.substring(1)).get('token')||'';const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,pw:p})});const j=await r.json();status.className=j.ok?'ok':'bad';status.textContent=j.ok?'Erfolgreich übertragen und geprüft.':'Übertragung nicht abgeschlossen.';details.textContent=j.ok?'Zieldatei: '+j.file+'; Bytes: '+j.bytes+'; bytegenau geprüft.':(j.error||'Bitte den Zugang und den Link prüfen.')}catch(e){status.className='bad';status.textContent='Übertragung fehlgeschlagen.';details.textContent=String(e)}finally{pw.value='';go.disabled=false}}</script></body></html>`);
  }
  if(req.method!=='POST')return send(res,405,{ok:false,error:'Methode nicht erlaubt'});
  if(Date.now()>=EXPIRES)return send(res,410,{ok:false,error:'Der temporäre Upload-Link ist abgelaufen.'});
  const data=await parseBody(req);
  if(!authenticated(data.token))return send(res,404,{ok:false,error:'Upload-Link nicht gültig'});
  const password=String(data.pw||'');
  if(!password)return send(res,400,{ok:false,error:'SFTP-Passwort fehlt'});
  let source;
  try{
    const r=await fetch(SOURCE,{headers:{'User-Agent':'Praxis-Website-Publisher/1.0'},cache:'no-store'});
    if(!r.ok)throw new Error('Quellversion nicht verfügbar');
    const text=await r.text();
    const required=['praxis-alert-october-2026','21.10.2026','23.10.2026','28.10.2026','30.10.2026','medidate-v604-fast-booking-blob-oid.vercel.app/'];
    if(!required.every(x=>text.includes(x)))throw new Error('Freigabeprüfung der Startseite fehlgeschlagen');
    source=Buffer.from(text,'utf8');
  }catch(e){return send(res,502,{ok:false,error:String(e.message||e)})}
  const sftp=new SftpClient();
  let oldFile=null;
  try{
    await sftp.connect({host:'access-5021474650.ud-webspace.de',port:22,username:'a2509659',password,readyTimeout:20000,keepaliveInterval:5000,keepaliveCountMax:2});
    if(!await sftp.exists(DEST))throw new Error('Bestehende Startseite auf dem Webspace nicht gefunden; aus Sicherheitsgründen nicht überschrieben');
    oldFile=await sftp.get(DEST);
    if(!Buffer.isBuffer(oldFile))oldFile=Buffer.from(oldFile);
    try{
      await sftp.put(source,DEST);
      const check=await sftp.get(DEST);
      const checkBytes=Buffer.isBuffer(check)?check:Buffer.from(check);
      if(!checkBytes.equals(source))throw new Error('Dateivergleich nach Upload fehlgeschlagen');
    }catch(e){
      try{await sftp.put(oldFile,DEST)}catch(rollbackError){return send(res,500,{ok:false,error:'Upload fehlgeschlagen; Wiederherstellung der vorherigen Datei muss geprüft werden.'})}
      throw e;
    }
    return send(res,200,{ok:true,file:DEST,bytes:source.length,verified:true});
  }catch(e){
    return send(res,500,{ok:false,error:String(e.message||e)});
  }finally{
    try{await sftp.end()}catch{}
  }
};
