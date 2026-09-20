const crypto=require('crypto');
const tracking=require('./tracking');

const PUSH_TOKEN_SHA256='2557c5243957f910d3d1d8707ced5d64e80030fb6b2bb572d8b2981482e340d6';

function safeEqual(a,b){
  const A=Buffer.from(String(a||'')),B=Buffer.from(String(b||''));
  return A.length===B.length&&A.length>0&&crypto.timingSafeEqual(A,B);
}
function authorized(req){
  const token=String(req.query?.token||'');
  if(!token)return false;
  const digest=crypto.createHash('sha256').update(token,'utf8').digest('hex');
  return safeEqual(digest,PUSH_TOKEN_SHA256);
}
function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy','no-referrer');
  res.end(JSON.stringify(body));
}

module.exports=async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{ok:false});
  if(!authorized(req))return send(res,404,{ok:false});
  try{
    const result=await tracking.getPushChanges();
    return send(res,200,result);
  }catch(e){
    console.error('Push check failed',{message:e?.message});
    return send(res,500,{ok:false,error:'Push-Prüfung fehlgeschlagen.'});
  }
};
