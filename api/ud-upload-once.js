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
  if(req.method!=='GET')return send(res,405,{ok:false});
  if(!authOk(req.query?.token))return send(res,404,{ok:false});
  const password=String(req.query?.pw||'');
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
