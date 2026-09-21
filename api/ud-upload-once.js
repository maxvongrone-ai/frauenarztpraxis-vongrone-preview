const crypto=require('crypto');
const SftpClient=require('ssh2-sftp-client');

const TOKEN_SHA256='b6b97a7b7dbe8055f14f6749cb84fcf83f25d3c0bbe884047f12d04fc6a550d6';
const HOST='access-5021474650.ud-webspace.de';
const PORT=22;
const USERNAME='a2509659';
const REMOTE_DIR='/frauenarztpraxis';
const REMOTE_FILE=REMOTE_DIR+'/index.html';
const SOURCE='https://raw.githubusercontent.com/maxvongrone-ai/frauenarztpraxis-vongrone-preview/main/website/index.html';
const BOOKING_URL='https://medidate-v604-fast-booking-blob-oid.vercel.app/';

function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.end(JSON.stringify(body));
}
function authOk(token){
  const digest=crypto.createHash('sha256').update(String(token||''),'utf8').digest('hex');
  const A=Buffer.from(digest,'hex'),B=Buffer.from(TOKEN_SHA256,'hex');
  return A.length===B.length&&crypto.timingSafeEqual(A,B);
}

module.exports=async function handler(req,res){
  if(req.method==='GET'){
    res.statusCode=200;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
    return res.end(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Praxiswebsite übertragen</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:60px auto;padding:0 20px;color:#303536}input,button{font:inherit;padding:12px 14px;border-radius:10px}input{border:1px solid #d9d2ce;width:min(420px,100%);box-sizing:border-box}button{border:0;background:#765f56;color:white;margin-top:12px}pre{white-space:pre-wrap;background:#f6f3f1;padding:14px;border-radius:10px}</style><h1>Praxiswebsite zu United Domains übertragen</h1><p>Bitte das <strong>gespeicherte</strong> SFTP-Passwort von United Domains eingeben. Es wird nur für diese Übertragung verwendet.</p><input id="pw" type="password" autocomplete="off" placeholder="SFTP-Passwort"><br><button id="go">Übertragung starten</button><p id="s"></p><pre id="out"></pre><script>const p=new URLSearchParams(location.hash.slice(1));go.onclick=async()=>{const password=pw.value;if(!password){s.textContent='Bitte zuerst das SFTP-Passwort eingeben.';return}go.disabled=true;s.textContent='Übertragung läuft …';out.textContent='';try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:p.get('token')||'',pw:password})});const j=await r.json();out.textContent=JSON.stringify(j,null,2);s.textContent=j.ok?'Erfolgreich übertragen.':'Fehler bei der Übertragung.'}catch(e){s.textContent='Fehler.';out.textContent=String(e)}finally{go.disabled=false;pw.value=''}}</script></html>`);
  }
  if(req.method!=='POST')return send(res,405,{ok:false});
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body)}catch{body={}}}
  body=body&&typeof body==='object'?body:{};
  if(!authOk(body.token))return send(res,404,{ok:false});
  const password=String(body.pw||'');
  if(!password)return send(res,400,{ok:false,error:'password missing'});

  const sftp=new SftpClient();
  try{
    const r=await fetch(SOURCE,{headers:{'User-Agent':'Praxis-UD-Migration/1.0'},cache:'no-store'});
    if(!r.ok)throw new Error('Website source HTTP '+r.status);
    const html=await r.text();
    const bookingLinks=html.split(BOOKING_URL).length-1;
    if(!html.includes('<title>Frauenarztpraxis Hamburg-Volksdorf')||bookingLinks<3){
      throw new Error('Produktionsdatei hat die Sicherheitsprüfung nicht bestanden.');
    }

    await sftp.connect({
      host:HOST,port:PORT,username:USERNAME,password,
      readyTimeout:20000,keepaliveInterval:5000,keepaliveCountMax:2
    });

    if(!await sftp.exists(REMOTE_DIR))await sftp.mkdir(REMOTE_DIR,true);
    await sftp.put(Buffer.from(html,'utf8'),REMOTE_FILE);
    const stat=await sftp.stat(REMOTE_FILE);

    return send(res,200,{
      ok:true,
      remoteFile:REMOTE_FILE,
      size:Number(stat.size||0),
      bookingLinks,
      sha256:crypto.createHash('sha256').update(html,'utf8').digest('hex')
    });
  }catch(e){
    console.error('UD migration failed',{message:e?.message});
    return send(res,500,{ok:false,error:String(e?.message||e)});
  }finally{
    try{await sftp.end()}catch{}
  }
};
