const crypto=require('crypto');

const TOKEN_SHA256='d228481cdbcc0d5749d9fbed21b47e8da5fe1f4598216d50b4bbeb3fcd354e2e';
const PREFIX='medidate-booking-tracking/v3/events/';

let blobApiPromise;
async function blobApi(){
  if(!blobApiPromise)blobApiPromise=import('@vercel/blob');
  return blobApiPromise;
}
function safeEqual(a,b){
  const A=Buffer.from(String(a||'')),B=Buffer.from(String(b||''));
  return A.length===B.length&&A.length>0&&crypto.timingSafeEqual(A,B);
}
function authorized(req){
  const token=String(req.query?.token||'');
  if(!token)return false;
  const digest=crypto.createHash('sha256').update(token,'utf8').digest('hex');
  return safeEqual(digest,TOKEN_SHA256);
}
function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.end(JSON.stringify(body));
}
async function listAll(){
  const {list}=await blobApi();
  const out=[];let cursor;
  do{
    const r=await list({prefix:PREFIX,limit:1000,cursor});
    if(Array.isArray(r?.blobs))out.push(...r.blobs);
    cursor=r?.hasMore?r.cursor:undefined;
  }while(cursor);
  return out;
}
async function readJson(blob){
  const {get}=await blobApi();
  const r=await get(blob.url||blob.pathname,{access:'private',useCache:false});
  if(!r||r.statusCode!==200)return null;
  const text=await new Response(r.stream).text();
  return JSON.parse(text);
}

module.exports=async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{ok:false});
  if(!authorized(req))return send(res,404,{ok:false});
  try{
    const blobs=await listAll();
    const rows=[];
    for(let i=0;i<blobs.length;i+=30){
      const batch=await Promise.all(blobs.slice(i,i+30).map(async blob=>{
        try{return {blob,event:await readJson(blob)}}catch{return null}
      }));
      rows.push(...batch.filter(Boolean));
    }
    rows.sort((a,b)=>String(a.event?.recordedAt||'').localeCompare(String(b.event?.recordedAt||'')));
    return send(res,200,{
      ok:true,
      count:rows.length,
      events:rows.map(({blob,event})=>({
        eventId:event?.eventId||'',
        appointmentDate:event?.appointmentDate||'',
        appointmentTime:event?.appointmentTime||'',
        doctorName:event?.doctorName||'',
        serviceName:event?.serviceName||'',
        bookingStatus:event?.bookingStatus||'booked',
        recordedAt:event?.recordedAt||'',
        pathname:blob?.pathname||''
      }))
    });
  }catch(e){
    console.error('inspect tracking failed',{message:e?.message});
    return send(res,500,{ok:false,error:'inspection failed'});
  }
};
