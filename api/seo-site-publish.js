const crypto=require('crypto');
const SftpClient=require('ssh2-sftp-client');

const TOKEN_SHA256='0d32e3e703b226e57895186604c39498c81d3482afe84a986ec129d247d862c9';
const HOST='access-5021474650.ud-webspace.de';
const PORT=22;
const USERNAME='a2509659';
const BASE='https://raw.githubusercontent.com/maxvongrone-ai/frauenarztpraxis-vongrone-preview/main/website/';
const FILES=[
  {src:'index.html',dst:'/frauenarztpraxis/index.html',must:['Frauenarzt Hamburg-Volksdorf','V12 – Responsive Feinschliff','MedicalClinic']},
  {src:'wechseljahre/index.html',dst:'/frauenarztpraxis/wechseljahre/index.html',must:['Wechseljahresberatung in Hamburg-Volksdorf','MedicalWebPage']},
  {src:'brustultraschall/index.html',dst:'/frauenarztpraxis/brustultraschall/index.html',must:['Brustultraschall in Hamburg-Volksdorf','MedicalWebPage']},
  {src:'privat-selbstzahler/index.html',dst:'/frauenarztpraxis/privat-selbstzahler/index.html',must:['Privatpatientinnen und Selbstzahlerinnen','MedicalWebPage']},
  {src:'robots.txt',dst:'/frauenarztpraxis/robots.txt',must:['Sitemap: https://frauenarztpraxis-vongrone.de/sitemap.xml']},
  {src:'sitemap.xml',dst:'/frauenarztpraxis/sitemap.xml',must:['https://frauenarztpraxis-vongrone.de/wechseljahre/','https://frauenarztpraxis-vongrone.de/brustultraschall/','https://frauenarztpraxis-vongrone.de/privat-selbstzahler/']}
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
    return res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEO-Version veröffentlichen</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:56px auto;padding:0 20px;color:#303536}h1{font-size:28px}input,button{font:inherit;padding:12px 14px;border-radius:10px;box-sizing:border-box}input{border:1px solid #d9d2ce;width:min(430px,100%)}button{border:0;background:#765f56;color:#fff;margin-top:12px;cursor:pointer}button:disabled{opacity:.55}pre{white-space:pre-wrap;background:#f6f3f1;padding:14px;border-radius:10px;min-height:30px}.ok{color:#18733b}.bad{color:#a33a3a}</style></head><body><h1>SEO-Version der Praxiswebsite veröffentlichen</h1><p>Übertragen werden Startseite, drei SEO-Fachseiten, <code>robots.txt</code> und <code>sitemap.xml</code>. Die sichtbare Startseite bleibt im Layout unverändert.</p><p>Bitte das aktuell gültige <strong>SFTP-Passwort von United Domains</strong> eingeben. Es wird nur für diese Übertragung verwendet und nicht gespeichert.</p><input id="pw" type="password" autocomplete="off" placeholder="SFTP-Passwort"><br><button id="go">Übertragung starten</button><p id="s"></p><pre id="out"></pre><script>const p=new URLSearchParams(location.hash.slice(1));go.onclick=async()=>{const password=pw.value;if(!password){s.className='bad';s.textContent='Bitte zuerst das SFTP-Passwort eingeben.';return}go.disabled=true;s.className='';s.textContent='Übertragung läuft …';out.textContent='';try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:p.get('token')||'',pw:password})});const j=await r.json();out.textContent=JSON.stringify(j,null,2);s.className=j.ok?'ok':'bad';s.textContent=j.ok?'Erfolgreich übertragen.':'Fehler bei der Übertragung.'}catch(e){s.className='bad';s.textContent='Fehler.';out.textContent=String(e)}finally{go.disabled=false;pw.value=''}}</script></body></html>`);
  }
  if(req.method!=='POST')return send(res,405,{ok:false,error:'Methode nicht erlaubt.'});
  const body=await bodyJson(req);
  if(!authOk(body.token))return send(res,404,{ok:false});
  const password=String(body.pw||'');
  if(!password)return send(res,400,{ok:false,error:'SFTP-Passwort fehlt.'});

  const loaded=[];
  for(const f of FILES){
    const r=await fetch(BASE+f.src,{headers:{'User-Agent':'Praxis-SEO-Publisher/1.0'},cache:'no-store'});
    if(!r.ok)return send(res,502,{ok:false,error:'Quelle konnte nicht geladen werden: '+f.src+' (HTTP '+r.status+')'});
    const text=await r.text();
    if(!f.must.every(x=>text.includes(x)))return send(res,400,{ok:false,error:'Sicherheitsprüfung fehlgeschlagen: '+f.src});
    loaded.push({...f,text});
  }

  const sftp=new SftpClient();
  try{
    await sftp.connect({host:HOST,port:PORT,username:USERNAME,password,readyTimeout:20000,keepaliveInterval:5000,keepaliveCountMax:2});
    const uploaded=[];
    for(const f of loaded){
      await ensureDir(sftp,f.dst);
      await sftp.put(Buffer.from(f.text,'utf8'),f.dst);
      const stat=await sftp.stat(f.dst);
      uploaded.push({file:f.dst,size:Number(stat.size||0)});
    }
    return send(res,200,{ok:true,uploaded,seoVersion:'2026-09-22'});
  }catch(e){
    console.error('SEO website publish failed',{message:e?.message});
    return send(res,500,{ok:false,error:String(e?.message||e)});
  }finally{
    try{await sftp.end()}catch{}
  }
};
