const crypto=require('crypto');

let _blobApiPromise;
async function blobApi(){
  if(global.__MEDIDATE_BLOB_MOCK__)return global.__MEDIDATE_BLOB_MOCK__;
  if(!_blobApiPromise)_blobApiPromise=import('@vercel/blob');
  return _blobApiPromise;
}

const ADMIN_TOKEN_SHA256='57c856614af64afa3277710a7012aca0b1b9b151703c4efbea9f69db310ace46';
const RETENTION_DAYS=180;
const TRACKING_PREFIX='medidate-booking-tracking/v3/events/';
const MAINTENANCE_PREFIX='medidate-booking-tracking/v3/maintenance/';
const SERVICE_NAMES=Object.freeze({
  '1950':'Vorsorge',
  '1973':'Nachsorge',
  '1974':'Brustultraschall',
  'IGEL_HORMON':'Wechseljahressprechstunde',
  'IGEL_SPIRALE':'Spirale Einlage'
});
const DOCTOR_NAMES=Object.freeze({
  512:'Dr. med. Christina Moxter',
  513:'Dr. med. Friederike von Grone'
});

function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.end(JSON.stringify(body));
}
function sameOrigin(req){
  const origin=String(req.headers.origin||''),host=String(req.headers.host||'');
  if(!origin)return true;
  try{return new URL(origin).host===host}catch{return false}
}
function safeEqual(a,b){
  const A=Buffer.from(String(a||'')),B=Buffer.from(String(b||''));
  return A.length===B.length&&A.length>0&&crypto.timingSafeEqual(A,B);
}
function authorized(req){
  const token=String(req.headers['x-medidate-tracking-key']||'');
  if(!token)return false;
  const digest=crypto.createHash('sha256').update(token,'utf8').digest('hex');
  return safeEqual(digest,ADMIN_TOKEN_SHA256);
}
function ensureBlobConfigured(){
  // Bei aktuellen Vercel-Blob-Projektverbindungen authentifiziert @vercel/blob
  // automatisch per OIDC. BLOB_STORE_ID wird von der Projektverbindung gesetzt.
  // Ein alter BLOB_READ_WRITE_TOKEN bleibt als Fallback kompatibel.
  if(!process.env.BLOB_STORE_ID&&!process.env.BLOB_READ_WRITE_TOKEN){
    throw Object.assign(new Error('Der private Vercel Blob Store ist mit diesem Deployment nicht verbunden.'),{code:'TRACKING_NOT_CONFIGURED'});
  }
}
async function readJsonBody(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){
    if(req.body.length>4096)throw new Error('Payload zu groß.');
    return JSON.parse(req.body||'{}');
  }
  let raw='';
  for await(const chunk of req){
    raw+=chunk;
    if(raw.length>4096)throw new Error('Payload zu groß.');
  }
  return JSON.parse(raw||'{}');
}
function validatedEvent(x){
  if(!x||x.eventType!=='booking_completed')throw new Error('Ungültiges Ereignis.');
  const route=String(x.route||'');
  if(!['PKV','GKV','SELF'].includes(route))throw new Error('Ungültiger Buchungspfad.');
  const patientType=String(x.patientType||'');
  if(patientType&&!['existing','new'].includes(patientType))throw new Error('Ungültiger Patientenstatus.');
  const serviceId=String(x.serviceId||'').slice(0,32);
  if(!/^[A-Za-z0-9_-]{1,32}$/.test(serviceId))throw new Error('Ungültige Terminart.');
  const appointmentDate=String(x.appointmentDate||'');
  const appointmentTime=String(x.appointmentTime||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate))throw new Error('Ungültiges Termindatum.');
  if(!/^\d{1,2}\.\d{2}$/.test(appointmentTime))throw new Error('Ungültige Terminzeit.');
  const doctorId=Number(x.doctorId||0);
  if(![512,513].includes(doctorId))throw new Error('Ungültige Ärztin.');
  const duration=Math.max(15,Math.min(120,Number(x.duration)||15));
  return {
    schemaVersion:3,
    eventId:crypto.randomUUID(),
    eventType:'booking_completed',
    route,
    patientType,
    serviceId,
    serviceName:SERVICE_NAMES[serviceId]||'Termin',
    appointmentDate,
    appointmentTime,
    doctorId,
    doctorName:DOCTOR_NAMES[doctorId]||'Ärztin',
    duration,
    recordedAt:new Date().toISOString()
  };
}
function eventPath(event){
  const day=event.recordedAt.slice(0,10);
  const stamp=event.recordedAt.replace(/[-:.TZ]/g,'');
  return `${TRACKING_PREFIX}${day}/${stamp}-${event.eventId}.json`;
}
async function saveEvent(event){
  ensureBlobConfigured();
  const {put}=await blobApi();
  await put(eventPath(event),JSON.stringify(event),{
    access:'private',
    contentType:'application/json; charset=utf-8',
    addRandomSuffix:false,
    allowOverwrite:false
  });
}
async function listAll(prefix){
  ensureBlobConfigured();
  const {list}=await blobApi();
  const out=[];let cursor;
  do{
    const r=await list({prefix,limit:1000,cursor});
    if(Array.isArray(r?.blobs))out.push(...r.blobs);
    cursor=r?.hasMore?r.cursor:undefined;
  }while(cursor&&out.length<20000);
  return out;
}
function dateFromPath(pathname){
  const m=String(pathname||'').match(/\/(?:events|maintenance)\/(?:cleanup-)?(\d{4}-\d{2}-\d{2})/);
  return m?new Date(`${m[1]}T00:00:00Z`).getTime():NaN;
}
function blobDateMs(blob){
  const uploaded=blob?.uploadedAt?new Date(blob.uploadedAt).getTime():NaN;
  return Number.isFinite(uploaded)?uploaded:dateFromPath(blob?.pathname);
}
async function cleanupIfNeeded(){
  ensureBlobConfigured();
  const today=new Date().toISOString().slice(0,10);
  const markerPath=`${MAINTENANCE_PREFIX}cleanup-${today}.json`;
  const {get,del,put}=await blobApi();
  const marker=await get(markerPath,{access:'private',useCache:false}).catch(()=>null);
  if(marker?.statusCode===200)return;

  const cutoff=Date.now()-RETENTION_DAYS*86400000;
  const blobs=await listAll(TRACKING_PREFIX);
  const expired=blobs.filter(b=>{const t=blobDateMs(b);return Number.isFinite(t)&&t<cutoff;}).map(b=>b.url||b.pathname);
  for(let i=0;i<expired.length;i+=250)await del(expired.slice(i,i+250));

  const oldMarkers=(await listAll(MAINTENANCE_PREFIX)).filter(b=>{
    const t=blobDateMs(b);return Number.isFinite(t)&&t<Date.now()-14*86400000;
  }).map(b=>b.url||b.pathname);
  for(let i=0;i<oldMarkers.length;i+=250)await del(oldMarkers.slice(i,i+250));

  await put(markerPath,JSON.stringify({cleanedAt:new Date().toISOString(),deleted:expired.length}),{
    access:'private',contentType:'application/json; charset=utf-8',addRandomSuffix:false,allowOverwrite:true
  });
}
async function streamToText(stream){
  if(!stream)return '';
  return await new Response(stream).text();
}
async function readOne(blob){
  try{
    const {get}=await blobApi();
    const r=await get(blob.url||blob.pathname,{access:'private',useCache:false});
    if(!r||r.statusCode!==200)return null;
    return JSON.parse(await streamToText(r.stream));
  }catch{return null}
}
async function readEvents(limit){
  ensureBlobConfigured();
  const blobs=(await listAll(TRACKING_PREFIX))
    .sort((a,b)=>blobDateMs(b)-blobDateMs(a))
    .slice(0,limit);
  const events=[];
  for(let i=0;i<blobs.length;i+=40){
    const batch=await Promise.all(blobs.slice(i,i+40).map(readOne));
    events.push(...batch.filter(Boolean));
  }
  return events.sort((a,b)=>String(b.recordedAt||'').localeCompare(String(a.recordedAt||'')));
}

module.exports=async function handler(req,res){
  try{
    if(req.method==='POST'){
      if(!sameOrigin(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'});
      const event=validatedEvent(await readJsonBody(req));
      await saveEvent(event);
      cleanupIfNeeded().catch(()=>{});
      return send(res,200,{ok:true,storage:'vercel-blob-private'});
    }

    if(req.method==='GET'){
      if(!sameOrigin(req)||!authorized(req))return send(res,401,{ok:false,error:'Nicht autorisiert.'});
      const limit=Math.max(1,Math.min(5000,Number(req.query?.limit)||2000));
      await cleanupIfNeeded().catch(()=>{});
      const events=await readEvents(limit);
      return send(res,200,{ok:true,storage:'vercel-blob-private',retentionDays:RETENTION_DAYS,events});
    }

    return send(res,405,{ok:false,error:'Methode nicht erlaubt.'});
  }catch(e){
    const status=e?.code==='TRACKING_NOT_CONFIGURED'?503:400;
    return send(res,status,{ok:false,error:e?.message||'Tracking-Fehler.'});
  }
};