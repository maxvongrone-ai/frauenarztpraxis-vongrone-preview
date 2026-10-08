const crypto=require('crypto');
const {buildPublicBundle,readSecret}=require('../lib/medidate-core');

let _blobApiPromise;
async function blobApi(){
  if(global.__MEDIDATE_BLOB_MOCK__)return global.__MEDIDATE_BLOB_MOCK__;
  if(!_blobApiPromise)_blobApiPromise=import('@vercel/blob');
  return _blobApiPromise;
}

const PREFIX='medidate-private-new-daily/v1/days/';
const PENDING_TTL_MS=4*60*1000;
const ADMIN_TOKEN_SHA256='c194250e573f3811002e49a67dd2098308f0bbe5a6042783028ad506b144dcd0';

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
  const site=String(req.headers['sec-fetch-site']||'').toLowerCase();
  const origin=String(req.headers.origin||''),host=String(req.headers.host||'');
  if(site!=='same-origin')return false;
  if(origin){try{if(new URL(origin).host!==host)return false}catch{return false}}
  return true;
}
function safeEqual(a,b){
  const A=Buffer.from(String(a||'')),B=Buffer.from(String(b||''));
  return A.length===B.length&&A.length>0&&crypto.timingSafeEqual(A,B);
}
function adminAuthorized(req){
  const supplied=String(req.headers['x-medidate-tracking-key']||'');
  if(!supplied)return false;
  const digest=crypto.createHash('sha256').update(supplied,'utf8').digest('hex');
  return safeEqual(digest,ADMIN_TOKEN_SHA256);
}
function ensureBlobConfigured(){
  if(!process.env.BLOB_STORE_ID&&!process.env.BLOB_READ_WRITE_TOKEN){
    const e=new Error('Der private Vercel Blob Store ist mit diesem Deployment nicht verbunden.');
    e.code='QUOTA_NOT_CONFIGURED';throw e;
  }
}
async function readBody(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){
    if(req.body.length>16384)throw new Error('Payload zu groß.');
    return JSON.parse(req.body||'{}');
  }
  let raw='';
  for await(const chunk of req){
    raw+=chunk;if(raw.length>16384)throw new Error('Payload zu groß.');
  }
  return JSON.parse(raw||'{}');
}
function berlinDate(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const o={};for(const p of parts)if(p.type!=='literal')o[p.type]=p.value;
  return o.year+'-'+o.month+'-'+o.day;
}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))}
function validTime(v){return /^([01]?\d|2[0-3])\.[0-5]\d$/.test(String(v||''))}
function validKey(v){return /^[A-Za-z0-9_-]{1,64}$/.test(String(v||''))}
function markerPath(date){return PREFIX+date+'.json'}
function add15(t){
  const m=String(t||'').match(/^(\d{1,2})\.(\d{2})$/);if(!m)return '';
  const n=Number(m[1])*60+Number(m[2])+15;if(n>=1440)return '';
  return String(Math.floor(n/60)).padStart(2,'0')+'.'+String(n%60).padStart(2,'0');
}
function trackingProofValid(body){
  const nonce=String(body?.trackingNonce||''),proof=String(body?.trackingProof||''),exp=Number(body?.trackingExp);
  if(!/^[A-Za-z0-9_-]{20,80}$/.test(nonce)||!/^[A-Za-z0-9_-]{20,128}$/.test(proof)||!Number.isFinite(exp))return false;
  const now=Date.now();
  if(exp<now-48*60*60*1000||exp>now+13*60*60*1000)return false;
  const expected=crypto.createHmac('sha256',readSecret()).update('tracking:'+nonce+':'+exp).digest('base64url');
  return safeEqual(proof,expected);
}
function normalizeSlot(x){
  const date=String(x?.date||''),time=String(x?.time||''),doctorKey=String(x?.doctorKey||''),serviceKey=String(x?.serviceKey||'');
  const duration=Number(x?.duration||30),mediDateDoctorId=Number(x?.mediDateDoctorId||0),mediDateServiceId=Number(x?.mediDateServiceId||0);
  if(!validDate(date)||!validTime(time)||!validKey(doctorKey)||!validKey(serviceKey))throw new Error('Ungültige Terminmarkierung.');
  if(![15,30].includes(duration))throw new Error('Ungültige Termindauer für das Tageskontingent.');
  return {date,time,doctorKey,serviceKey,duration,mediDateDoctorId,mediDateServiceId};
}
async function readMarker(date){
  ensureBlobConfigured();const {get}=await blobApi();
  const r=await get(markerPath(date),{access:'private',useCache:false}).catch(()=>null);
  if(!r||r.statusCode!==200)return null;
  try{return JSON.parse(await new Response(r.stream).text())}catch{return null}
}
async function writeMarker(marker,allowOverwrite){
  ensureBlobConfigured();const {put}=await blobApi();
  await put(markerPath(marker.date),JSON.stringify(marker),{
    access:'private',contentType:'application/json; charset=utf-8',
    addRandomSuffix:false,allowOverwrite:Boolean(allowOverwrite)
  });
}
async function deleteMarker(date){
  ensureBlobConfigured();const {del}=await blobApi();
  await del(markerPath(date)).catch(()=>{});
}
async function listMarkers(){
  ensureBlobConfigured();const {list}=await blobApi();const blobs=[];let cursor;
  do{
    const r=await list({prefix:PREFIX,limit:1000,cursor});
    if(Array.isArray(r?.blobs))blobs.push(...r.blobs);
    cursor=r?.hasMore?r.cursor:undefined;
  }while(cursor&&blobs.length<5000);
  const out=[];
  for(let i=0;i<blobs.length;i+=40){
    const batch=await Promise.all(blobs.slice(i,i+40).map(async b=>{
      const date=String(b?.pathname||'').slice(PREFIX.length).replace(/\.json$/,'');
      return validDate(date)?readMarker(date):null;
    }));
    out.push(...batch.filter(Boolean));
  }
  return out;
}
function rowMatchesMarker(row,marker){
  if(String(row?.dateTimeStart||'').slice(0,10)!==marker.date)return false;
  if(marker.doctorKey&&String(row?.doctorKey||'')===marker.doctorKey)return true;
  const times=Array.isArray(row?.times)?row.times:[];
  return times.some(t=>Number(t?.direct?.doctorId||0)===Number(marker.mediDateDoctorId||0));
}
function markerSlotIsFree(bundle,marker){
  const groups=Array.isArray(bundle?.groups)?bundle.groups:[];
  const candidates=groups.filter(g=>{
    if(marker.serviceKey&&String(g?.serviceKey||'')===marker.serviceKey)return true;
    return (g?.availability?.appointmentTimes||[]).some(r=>(r?.times||[]).some(t=>Number(t?.direct?.serviceId||0)===Number(marker.mediDateServiceId||0)));
  });
  const wanted=[marker.time];
  for(let i=15;i<marker.duration;i+=15){const next=add15(wanted[wanted.length-1]);if(!next)return false;wanted.push(next)}
  for(const g of candidates){
    for(const row of (g?.availability?.appointmentTimes||[])){
      if(!rowMatchesMarker(row,marker))continue;
      const available=new Set((row?.times||[]).map(t=>typeof t==='string'?t:String(t?.time||'')));
      if(wanted.every(t=>available.has(t)))return true;
    }
  }
  return false;
}
async function reconcileMarkers(markers){
  const now=Date.now(),today=berlinDate(),out=[],needsLive=markers.some(m=>m&&m.date>=today&&(m.status==='active'||(m.status==='pending'&&Number(m.expiresAt||0)<=now)));
  let bundle=null;if(needsLive)bundle=await buildPublicBundle();
  for(const marker of markers){
    if(!marker||!validDate(marker.date))continue;
    if(marker.date<today){await deleteMarker(marker.date);continue}
    if(marker.status==='pending'&&Number(marker.expiresAt||0)>now){out.push(marker);continue}
    if((marker.status==='active'||marker.status==='pending')&&bundle){
      if(markerSlotIsFree(bundle,marker)){await deleteMarker(marker.date);continue}
      if(marker.status==='pending'){
        marker.status='active';marker.confirmedAt=marker.confirmedAt||new Date().toISOString();
        marker.recoveredFromExpiredPending=true;delete marker.expiresAt;await writeMarker(marker,true);
      }
      out.push(marker);
    }
  }
  return out;
}
function normalizeAdminItem(x){
  const base=normalizeSlot({
    date:x?.date,time:x?.time,doctorKey:String(x?.doctorKey||x?.mediDateDoctorId||'unknown'),
    serviceKey:String(x?.serviceKey||x?.mediDateServiceId||'unknown'),duration:Number(x?.duration||30),
    mediDateDoctorId:Number(x?.mediDateDoctorId||0),mediDateServiceId:Number(x?.mediDateServiceId||0)
  });
  return {...base,eventId:String(x?.eventId||'').slice(0,80),recordedAt:String(x?.recordedAt||'').slice(0,40)};
}

module.exports=async function handler(req,res){
  try{
    if(!sameOrigin(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'});
    const action=String(req.query?.action||'status');

    if(req.method==='GET'&&(action==='status'||action==='status-fast')){
      const markers=await listMarkers();
      const current=action==='status'?await reconcileMarkers(markers):markers.filter(m=>m?.date>=berlinDate()&&(m.status==='active'||(m.status==='pending'&&Number(m.expiresAt||0)>Date.now())));
      const blockedDates=[...new Set(current.map(m=>m.date))].sort();
      return send(res,200,{ok:true,blockedDates});
    }

    if(req.method!=='POST')return send(res,405,{ok:false,error:'Methode nicht erlaubt.'});
    const body=await readBody(req);

    if(action==='reserve'){
      if(!trackingProofValid(body))return send(res,403,{ok:false,error:'Der Terminstand ist abgelaufen. Bitte laden Sie die Termine neu.'});
      const slot=normalizeSlot(body);
      if(slot.date<berlinDate())return send(res,400,{ok:false,error:'Vergangene Termine können nicht reserviert werden.'});
      const existing=await readMarker(slot.date);
      if(existing){
        const left=await reconcileMarkers([existing]);
        if(left.length)return send(res,409,{ok:false,code:'PRIVATE_NEW_DAY_TAKEN',error:'An diesem Tag ist bereits eine private Neupatientin über die Online-Terminbuchung eingeplant. Bitte wählen Sie einen anderen Tag.'});
      }
      const reservationId=crypto.randomUUID(),now=new Date().toISOString();
      const marker={v:1,kind:'PKV_NEW_DAILY',source:'booking-reservation',...slot,status:'pending',reservationId,createdAt:now,expiresAt:Date.now()+PENDING_TTL_MS};
      try{await writeMarker(marker,false)}
      catch{return send(res,409,{ok:false,code:'PRIVATE_NEW_DAY_TAKEN',error:'Dieser Tag wurde gerade von einer anderen privaten Neupatientin reserviert. Bitte wählen Sie einen anderen Tag.'})}
      return send(res,200,{ok:true,reservationId,date:slot.date});
    }

    if(action==='confirm'){
      const date=String(body?.date||''),reservationId=String(body?.reservationId||'');
      if(!validDate(date)||!/^[0-9a-f-]{36}$/i.test(reservationId))return send(res,400,{ok:false,error:'Ungültige Reservierung.'});
      const marker=await readMarker(date);
      if(!marker||marker.reservationId!==reservationId)return send(res,404,{ok:false,error:'Reservierung nicht gefunden.'});
      marker.status='active';marker.confirmedAt=new Date().toISOString();delete marker.expiresAt;
      await writeMarker(marker,true);return send(res,200,{ok:true});
    }

    if(action==='release'){
      const date=String(body?.date||''),reservationId=String(body?.reservationId||'');
      if(!validDate(date)||!/^[0-9a-f-]{36}$/i.test(reservationId))return send(res,400,{ok:false,error:'Ungültige Reservierung.'});
      const marker=await readMarker(date);
      if(marker&&marker.status==='pending'&&marker.reservationId===reservationId)await deleteMarker(date);
      return send(res,200,{ok:true});
    }

    if(action==='admin-sync'){
      if(!adminAuthorized(req))return send(res,401,{ok:false,error:'Nicht autorisiert.'});
      const raw=Array.isArray(body?.active)?body.active:[];
      if(raw.length>1000)return send(res,400,{ok:false,error:'Zu viele Datensätze.'});
      const byDate=new Map();
      for(const x of raw){
        try{
          const item=normalizeAdminItem(x);
          if(item.date>=berlinDate()&&!byDate.has(item.date))byDate.set(item.date,item);
        }catch{}
      }
      const existing=await listMarkers(),existingByDate=new Map(existing.map(m=>[m.date,m]));
      let synced=0,removed=0;
      for(const [date,item] of byDate){
        const old=existingByDate.get(date);
        if(old&&old.source!=='dashboard-sync')continue;
        const marker={v:1,kind:'PKV_NEW_DAILY',source:'dashboard-sync',...item,status:'active',reservationId:'',createdAt:old?.createdAt||new Date().toISOString(),confirmedAt:new Date().toISOString()};
        await writeMarker(marker,true);synced++;
      }
      for(const old of existing){
        if(old?.source==='dashboard-sync'&&!byDate.has(old.date)){await deleteMarker(old.date);removed++}
      }
      return send(res,200,{ok:true,synced,removed});
    }

    return send(res,404,{ok:false,error:'Unbekannte Aktion.'});
  }catch(e){
    const status=e?.code==='QUOTA_NOT_CONFIGURED'?503:400;
    return send(res,status,{ok:false,error:e?.message||'Tageskontingent konnte nicht verarbeitet werden.'});
  }
};
