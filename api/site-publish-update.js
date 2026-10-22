'use strict';
const crypto=require('crypto');
const SftpClient=require('ssh2-sftp-client');
const TOKEN_SHA256='d166f86c491cbbd714d42b0436e8f8a53be8cfd1be7a294344f0097c48cb4a8a';
const EXPIRES=Date.parse('2026-10-24T23:59:00+02:00');
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
    return res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>United Domains – Impressum-E-Mail ändern</title><style>body{font-family:system-ui,-apple-system,Arial,sans-serif;max-width:690px;margin:48px auto;padding:0 20px;color:#263332}h1{font-size:25px}p{line-height:1.6}input{display:block;width:min(430px,100%);box-sizing:border-box;padding:12px;border:1px solid #aaa;border-radius:8px;font:inherit;margin:16px 0}button{font:inherit;background:#365b4d;color:#fff;border:0;border-radius:8px;padding:13px 20px;cursor:pointer}button:disabled{opacity:.5}pre{white-space:pre-wrap;overflow-wrap:anywhere}.ok{color:#086b39}.bad{color:#a22}</style></head><body><h1>Praxiswebsite – E-Mail im Impressum ändern</h1><p>Im Impressum wird ausschließlich <strong>info@frauenarztpraxis-vongrone.de</strong> in <strong>kontakt@frauenarztpraxis-vongrone.de</strong> geändert. Die aktuelle Datei auf United Domains wird vorher eingelesen; alle übrigen Inhalte bleiben unverändert.</p><p>Bitte das <strong>SFTP-Passwort von United Domains</strong> eingeben. Es wird nur für die verschlüsselte Verbindung zur Übertragung verwendet und weder im Browser gespeichert noch in Protokolle geschrieben.</p><label for="pw">SFTP-Passwort</label><input id="pw" type="password" autocomplete="off"><details><summary>Falls der Upload-Link beim Anmelden seinen Zugangscode verliert</summary><p>Nur in diesem Fall den Zugangscode hier eintragen:</p><input id="access" type="password" autocomplete="off" placeholder="Upload-Zugangscode (optional)"></details><button id="go" type="button">E-Mail im Impressum ändern</button><p id="status" role="status" aria-live="polite"></p><pre id="details"></pre><script>const pw=document.getElementById('pw'),go=document.getElementById('go'),status=document.getElementById('status'),details=document.getElementById('details');go.onclick=async()=>{const p=pw.value;if(!p){status.textContent='Bitte zuerst das Passwort eingeben.';return}go.disabled=true;status.className='';status.textContent='Verbindung und Übertragung werden geprüft …';details.textContent='';try{const token=new URLSearchParams(location.search).get('token')||new URLSearchParams(location.hash.substring(1)).get('token')||document.getElementById('access').value.trim();if(!token){status.className='bad';status.textContent='Zugangscode fehlt.';details.textContent='Bitte den vollständigen Upload-Link erneut öffnen oder den Zugangscode im Bereich oben eintragen.';go.disabled=false;return}const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,pw:p})});const j=await r.json();status.className=j.ok?'ok':'bad';status.textContent=j.ok?'Impressum-E-Mail erfolgreich geändert und geprüft.':'Übertragung nicht abgeschlossen.';details.textContent=j.ok?'Zieldatei: '+j.file+'; Bytes: '+j.bytes+'; bytegenau geprüft.':(j.error||'Bitte den Zugang und den Link prüfen.')}catch(e){status.className='bad';status.textContent='Übertragung fehlgeschlagen.';details.textContent=String(e)}finally{pw.value='';go.disabled=false}}</script></body></html>`);
  }
  if(req.method!=='POST')return send(res,405,{ok:false,error:'Methode nicht erlaubt'});
  if(Date.now()>=EXPIRES)return send(res,410,{ok:false,error:'Der temporäre Upload-Link ist abgelaufen.'});
  const data=await parseBody(req);
  if(!authenticated(data.token))return send(res,404,{ok:false,error:'Upload-Link nicht gültig'});
  const password=String(data.pw||'');
  if(!password)return send(res,400,{ok:false,error:'SFTP-Passwort fehlt'});
  let source;
  const sftp=new SftpClient();
  let oldFile=null;
  try{
    await sftp.connect({host:'access-5021474650.ud-webspace.de',port:22,username:'a2509659',password,readyTimeout:20000,keepaliveInterval:5000,keepaliveCountMax:2});
    if(!await sftp.exists(DEST))throw new Error('Bestehende Startseite auf dem Webspace nicht gefunden; aus Sicherheitsgründen nicht überschrieben');
    oldFile=await sftp.get(DEST);
    if(!Buffer.isBuffer(oldFile))oldFile=Buffer.from(oldFile);
    const page=oldFile.toString('utf8');
    const begin=page.indexOf('id="impressum"');
    const finish=page.indexOf('</section>',begin);
    if(begin<0||finish<0||finish-begin>25000)throw new Error('Impressum nicht eindeutig gefunden; keine Änderung');
    const segment=page.slice(begin,finish);
    const oldEmail='E-Mail: info@frauenarztpraxis-vongrone.de';
    const newEmail='E-Mail: kontakt@frauenarztpraxis-vongrone.de';
    if(!segment.includes(oldEmail)&&segment.includes(newEmail))return send(res,200,{ok:true,already:true,file:DEST,verified:true});
    if(segment.split(oldEmail).length!==2||segment.includes(newEmail))throw new Error('Impressum hat einen unerwarteten Stand; keine Änderung');
    source=Buffer.from(page.slice(0,begin)+segment.replace(oldEmail,newEmail)+page.slice(finish),'utf8');
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
