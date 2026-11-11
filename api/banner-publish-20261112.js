'use strict';
const crypto=require('crypto');
const SftpClient=require('ssh2-sftp-client');

const TOKEN_SHA256='9789f857faa79581b52edb633015a33f912e8d5841b396e3201f9610043ef43a';
const EXPIRES=Date.parse('2026-11-13T18:00:00+01:00');
const DEST='/frauenarztpraxis/index.html';
const ID='praxis-notice-20261112';
const NOTICE='Unsere Praxis ist am Donnerstag, den 12.11.2026 ab 13:00 Uhr geschlossen.';
const CUTOFF='2026-11-12T18:00:00+01:00';
const STYLE='<style id="'+ID+'-style">\n'
+'#'+ID+'{width:calc(100% - 36px);margin:0 18px;box-sizing:border-box;overflow:hidden;background:var(--v7-paper,#fff);color:var(--wine,#72183a);border:1px solid var(--v7-line,#ded8d2);border-radius:12px;font-size:clamp(13px,1.45vw,16px);line-height:1.5;padding:10px 0}\n'
+'#'+ID+'[hidden]{display:none!important}\n'
+'#'+ID+' .nov-notice-track{display:flex;width:max-content;min-width:100%;align-items:center;gap:72px;white-space:nowrap;animation:nov12-ticker-scroll 54s linear infinite}\n'
+'#'+ID+' .nov-notice-track span{display:inline-block;padding-left:28px}\n'
+'@keyframes nov12-ticker-scroll{from{transform:translateX(0)}to{transform:translateX(calc(-50% - 36px))}}\n'
+'@media(max-width:700px){#'+ID+'{width:calc(100% - 24px);margin:0 12px;border-radius:10px;font-size:13px;padding:9px 0}#'+ID+' .nov-notice-track{gap:48px;animation-duration:50s}#'+ID+' .nov-notice-track span{padding-left:18px}@keyframes nov12-ticker-scroll{from{transform:translateX(0)}to{transform:translateX(calc(-50% - 24px))}}}\n'
+'@media(prefers-reduced-motion:reduce){#'+ID+' .nov-notice-track{width:100%;justify-content:center;white-space:normal;text-align:center;animation:none}#'+ID+' .nov-notice-track span{padding:0 16px}#'+ID+' .nov-notice-track span[aria-hidden=true]{display:none}}\n'
+'</style>\n';
const HTML='<div id="'+ID+'" hidden role="status" aria-live="polite"><div class="nov-notice-track"><span><strong>'+NOTICE+'</strong></span><span aria-hidden="true"><strong>'+NOTICE+'</strong></span></div></div>\n';
const JS='<script id="'+ID+'-script">\n'
+"(function(){var banner=document.getElementById('"+ID+"');if(!banner)return;var cutoff=Date.parse('"+CUTOFF+"');var timer;function update(){clearTimeout(timer);var remaining=cutoff-Date.now();banner.hidden=remaining<=0;if(remaining>0)timer=setTimeout(update,Math.min(remaining,2147483647));}document.addEventListener('visibilitychange',function(){if(!document.hidden)update()});window.addEventListener('focus',update);update()})();\n"
+'</script>\n';

function json(res,code,data){
  res.statusCode=code;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex,nofollow,noarchive');
  res.end(JSON.stringify(data));
}
function auth(token){
  const digest=crypto.createHash('sha256').update(String(token||''),'utf8').digest();
  return crypto.timingSafeEqual(digest,Buffer.from(TOKEN_SHA256,'hex'));
}
async function body(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}
  let raw='';
  for await(const block of req){raw+=block;if(raw.length>8192)throw Error('Eingabe zu groß')}
  try{return JSON.parse(raw||'{}')}catch{return {}}
}
function patch(page){
  if(page.includes('id="'+ID+'"')){
    if(page.includes(NOTICE)&&page.includes(CUTOFF)&&page.includes('id="'+ID+'-style"')&&page.includes('id="'+ID+'-script"'))return {content:page,already:true};
    throw Error('Ein abweichender Banner existiert bereits. Keine Änderung vorgenommen.');
  }
  if(!page.includes('</head>')||!page.includes('</body>'))throw Error('HTML-Struktur unerwartet. Keine Änderung vorgenommen.');
  if(!page.includes('medidate')||!page.includes('frauenarzt'))throw Error('Prüfung der aktuellen Praxiswebsite fehlgeschlagen.');
  const open=/<header\b[^>]*\bclass\s*=\s*["'][^"']*\bheader\b[^"']*["'][^>]*>/i.exec(page);
  if(!open)throw Error('Hauptbereich der Praxiswebsite nicht gefunden. Keine Änderung vorgenommen.');
  const close=page.indexOf('</header>',open.index+open[0].length);
  if(close<0||close-open.index>50000)throw Error('Kopfbereich der Praxiswebsite nicht eindeutig gefunden.');
  let result=page.replace('</head>',STYLE+'</head>');
  const openAgain=/<header\b[^>]*\bclass\s*=\s*["'][^"']*\bheader\b[^"']*["'][^>]*>/i.exec(result);
  const end=result.indexOf('</header>',openAgain.index+openAgain[0].length)+9;
  result=result.slice(0,end)+'\n'+HTML+result.slice(end);
  result=result.replace('</body>',JS+'</body>');
  if(!result.includes('id="'+ID+'-style"')||!result.includes('id="'+ID+'-script"')||!result.includes(CUTOFF))throw Error('Prüfung des neuen Banners fehlgeschlagen.');
  return {content:result,already:false};
}
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex,nofollow,noarchive');
  if(req.method==='GET'){
    res.statusCode=200;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    return res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UD – Praxishinweis 12. November</title><style>body{font-family:system-ui,Arial,sans-serif;max-width:680px;margin:44px auto;padding:0 20px;color:#303536}h1{font-size:26px}p{line-height:1.6}input{box-sizing:border-box;width:min(470px,100%);display:block;padding:12px;border:1px solid #aaa;border-radius:8px;margin:8px 0 18px;font:inherit}button{background:#365b4d;color:white;padding:13px 20px;border:0;border-radius:9px;font:inherit;cursor:pointer}button:disabled{opacity:.5}.ok{color:#086b39}.bad{color:#a22}details{margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>Laufbanner für Donnerstag, 12. November</h1><p>Es wird <strong>ausschließlich ein neuer Laufbanner</strong> direkt unterhalb der Telefonnummer eingefügt. Die aktuell bei united-domains gespeicherte Startseite wird vorher eingelesen. Vorhandene Inhalte, das Impressum und die Online-Terminbuchung bleiben erhalten.</p><p><strong>Hinweistext:</strong> Unsere Praxis ist am Donnerstag, den 12.11.2026 ab 13:00 Uhr geschlossen.</p><p>Der Banner verschwindet automatisch am 12.11.2026 um 18:00 Uhr (deutsche Zeit).</p><label for="pw">UD-SFTP-Passwort</label><input id="pw" type="password" autocomplete="off" placeholder="Aktuelles SFTP-Passwort"><details><summary>Zugangscode manuell eingeben (falls der Link ihn verliert)</summary><label for="access">Upload-Zugangscode</label><input id="access" type="password" autocomplete="off" placeholder="Upload-Zugangscode"></details><button id="go" type="button">Banner zu united-domains hochladen</button><p role="status" id="status"></p><pre id="details"></pre><script>const pw=document.getElementById('pw'),go=document.getElementById('go'),status=document.getElementById('status'),details=document.getElementById('details');go.addEventListener('click',async()=>{const p=pw.value;const token=new URLSearchParams(location.search).get('token')||new URLSearchParams(location.hash.slice(1)).get('token')||document.getElementById('access').value.trim();if(!token){status.className='bad';status.textContent='Zugangscode fehlt. Bitte den Link erneut öffnen oder den Code manuell eintragen.';return}if(!p){status.className='bad';status.textContent='Bitte das UD-SFTP-Passwort eingeben.';return}go.disabled=true;status.className='';status.textContent='Übertragung wird ausgeführt …';details.textContent='';try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,pw:p})});const j=await r.json();status.className=j.ok?'ok':'bad';status.textContent=j.ok?(j.already?'Der Banner ist bereits vorhanden und geprüft.':'Der Banner wurde übertragen und geprüft.'):'Übertragung fehlgeschlagen.';details.textContent=j.ok?'Zieldatei: '+j.file+'; Länge: '+j.bytes+' Bytes':(j.error||'Unbekannter Fehler')}catch(e){status.className='bad';status.textContent='Verbindungsfehler';details.textContent=String(e)}finally{pw.value='';go.disabled=false}})</script></body></html>`);
  }
  if(req.method!=='POST')return json(res,405,{ok:false,error:'Methode nicht erlaubt.'});
  if(Date.now()>EXPIRES)return json(res,410,{ok:false,error:'Der temporäre Upload ist abgelaufen.'});
  let data;
  try{data=await body(req)}catch(e){return json(res,413,{ok:false,error:'Eingabe zu groß'})}
  if(!auth(data.token))return json(res,404,{ok:false,error:'Upload-Zugangscode nicht gültig.'});
  const password=String(data.pw||'');
  if(!password)return json(res,400,{ok:false,error:'SFTP-Passwort fehlt.'});
  const sftp=new SftpClient();
  let original=null;
  try{
    await sftp.connect({host:'access-5021474650.ud-webspace.de',port:22,username:'a2509659',password,readyTimeout:20000,keepaliveInterval:5000,keepaliveCountMax:2});
    if(!await sftp.exists(DEST))throw Error('Bestehende Startseite nicht gefunden. Keine Datei angelegt.');
    original=await sftp.get(DEST);
    if(!Buffer.isBuffer(original))original=Buffer.from(original);
    const adjusted=patch(original.toString('utf8'));
    if(adjusted.already)return json(res,200,{ok:true,already:true,file:DEST,bytes:original.length});
    const content=Buffer.from(adjusted.content,'utf8');
    try{
      await sftp.put(content,DEST);
      const readback=await sftp.get(DEST);
      const restored=Buffer.isBuffer(readback)?readback:Buffer.from(readback);
      if(!restored.equals(content))throw Error('Prüfung der hochgeladenen Datei fehlgeschlagen.');
    }catch(e){
      try{await sftp.put(original,DEST)}
      catch(re){return json(res,500,{ok:false,error:'Upload fehlgeschlagen; Wiederherstellung der vorherigen Startseite bitte prüfen.'})}
      throw e;
    }
    return json(res,200,{ok:true,already:false,file:DEST,bytes:content.length,verified:true});
  }catch(e){
    return json(res,500,{ok:false,error:String(e.message||e)});
  }finally{try{await sftp.end()}catch{}}
};
