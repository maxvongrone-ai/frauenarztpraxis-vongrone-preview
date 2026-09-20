const crypto=require('crypto');

let _blobApiPromise;
async function blobApi(){
  if(global.__MEDIDATE_BLOB_MOCK__)return global.__MEDIDATE_BLOB_MOCK__;
  if(!_blobApiPromise)_blobApiPromise=import('@vercel/blob');
  return _blobApiPromise;
}

const ADMIN_TOKEN_SHA256='18185017aae07fecb38312376b4b60478561462631006dd57d29ee1782746aeb';
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
  const m=String(pathname||'').match(/\/(?:events|maintenance)\/(?:cleanup-|reconcile-)?(\d{4}-\d{2}-\d{2})/);
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


function berlinNow(){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date());
  const out={};for(const p of parts)if(p.type!=='literal')out[p.type]=p.value;
  return {
    date:out.year+'-'+out.month+'-'+out.day,
    minutes:Number(out.hour)*60+Number(out.minute)
  };
}
function timeMinutes(value){
  const m=String(value||'').match(/^(\d{1,2})[.:](\d{2})$/);
  return m?Number(m[1])*60+Number(m[2]):NaN;
}
function isFutureTrackedAppointment(event){
  const now=berlinNow();
  const date=String(event?.appointmentDate||'');
  if(date>now.date)return true;
  if(date<now.date)return false;
  const mins=timeMinutes(event?.appointmentTime);
  return Number.isFinite(mins)&&mins>now.minutes;
}
function slotIsAvailableAgain(group,event){
  const rows=Array.isArray(group?.availability?.appointmentTimes)?group.availability.appointmentTimes:[];
  const targetDate=String(event?.appointmentDate||'');
  const doctorId=Number(event?.doctorId||0);
  const start=timeMinutes(event?.appointmentTime);
  if(!targetDate||!doctorId||!Number.isFinite(start))return false;

  const blocks=Math.max(1,Math.ceil((Number(event?.duration)||15)/15));
  for(const row of rows){
    if(String(row?.dateTimeStart||'').slice(0,10)!==targetDate)continue;
    if(Number(row?.doctorId||0)!==doctorId)continue;
    const available=new Set((Array.isArray(row?.times)?row.times:[]).map(timeMinutes).filter(Number.isFinite));
    let all=true;
    for(let i=0;i<blocks;i++){
      if(!available.has(start+i*15)){all=false;break}
    }
    if(all)return true;
  }
  return false;
}
async function readEventRecords(limit=5000){
  ensureBlobConfigured();
  const blobs=(await listAll(TRACKING_PREFIX))
    .sort((a,b)=>blobDateMs(b)-blobDateMs(a))
    .slice(0,limit);
  const records=[];
  for(let i=0;i<blobs.length;i+=40){
    const batch=await Promise.all(blobs.slice(i,i+40).map(async blob=>({
      blob,
      event:await readOne(blob)
    })));
    records.push(...batch.filter(x=>x.event));
  }
  return records;
}
async function overwriteEvent(record,event){
  const pathname=record?.blob?.pathname;
  if(!pathname)throw new Error('Tracking-Pfad fehlt.');
  const {put}=await blobApi();
  await put(pathname,JSON.stringify(event),{
    access:'private',
    contentType:'application/json; charset=utf-8',
    addRandomSuffix:false,
    allowOverwrite:true
  });
}
async function maintenanceMarkerExists(pathname){
  const {get}=await blobApi();
  const marker=await get(pathname,{access:'private',useCache:false}).catch(()=>null);
  return marker?.statusCode===200;
}
async function writeMaintenanceMarker(pathname,data){
  const {put}=await blobApi();
  await put(pathname,JSON.stringify(data),{
    access:'private',
    contentType:'application/json; charset=utf-8',
    addRandomSuffix:false,
    allowOverwrite:true
  });
}

function sameTrackedSlot(a,b){
  return String(a?.appointmentDate||'')===String(b?.appointmentDate||'') &&
    Number(a?.doctorId||0)===Number(b?.doctorId||0) &&
    timeMinutes(a?.appointmentTime)===timeMinutes(b?.appointmentTime);
}
async function reconcileRebookedEvents(){
  const records=await readEventRecords(5000);
  const ordered=records
    .filter(({event})=>event?.eventType==='booking_completed')
    .sort((a,b)=>String(a.event.recordedAt||'').localeCompare(String(b.event.recordedAt||'')));

  const lastBySlot=new Map();
  let linked=0,updated=0;

  for(const record of ordered){
    let event=record.event;
    const mins=timeMinutes(event?.appointmentTime);
    if(!String(event?.appointmentDate||'')||!Number(event?.doctorId||0)||!Number.isFinite(mins))continue;
    const key=String(event.appointmentDate)+'|'+Number(event.doctorId)+'|'+mins;
    const previous=lastBySlot.get(key);

    if(previous&&previous.event.eventId!==event.eventId){
      const previousEvent=previous.event;
      const previousNeedsUpdate=
        previousEvent.bookingStatus!=='released' ||
        previousEvent.releaseEvidence!=='slot_rebooked' ||
        previousEvent.rebookedByEventId!==event.eventId ||
        previousEvent.releaseConfirmedByRebookingAt!==event.recordedAt;

      if(previousNeedsUpdate){
        const updatedPrevious={
          ...previousEvent,
          schemaVersion:4,
          bookingStatus:'released',
          releaseDetectedAt:previousEvent.releaseDetectedAt||event.recordedAt,
          releaseEvidence:'slot_rebooked',
          releaseConfirmedByRebookingAt:event.recordedAt,
          rebookedByEventId:event.eventId
        };
        await overwriteEvent(previous,updatedPrevious);
        previous.event=updatedPrevious;
        updated++;
      }

      const currentNeedsUpdate=
        event.previousBookingEventId!==previousEvent.eventId ||
        event.previousBookingRecordedAt!==previousEvent.recordedAt;

      if(currentNeedsUpdate){
        const updatedCurrent={
          ...event,
          schemaVersion:Math.max(4,Number(event.schemaVersion)||0),
          previousBookingEventId:previousEvent.eventId,
          previousBookingRecordedAt:previousEvent.recordedAt
        };
        await overwriteEvent(record,updatedCurrent);
        event=updatedCurrent;
        record.event=updatedCurrent;
        updated++;
      }
      linked++;
    }

    lastBySlot.set(key,record);
  }

  return {linked,updated};
}

async function reconcileTrackedBookings({force=false}={}){
  ensureBlobConfigured();
  const rebooking=await reconcileRebookedEvents();
  const day=berlinNow().date;
  const markerPath=MAINTENANCE_PREFIX+'reconcile-'+day+'.json';

  if(!force&&await maintenanceMarkerExists(markerPath)){
    return {ok:true,skipped:true,reason:'already-checked-today',rebooked:rebooking.linked||0};
  }

  const records=await readEventRecords(5000);
  const candidates=records.filter(({event})=>{
    if(event?.eventType!=='booking_completed')return false;
    if(event?.bookingStatus==='released')return false;
    if(!['1950','1973','1974'].includes(String(event?.serviceId||'')))return false;
    return isFutureTrackedAppointment(event);
  });

  let checked=0,released=0;
  if(candidates.length){
    const {buildLiveBundle}=require('./medidate');
    const live=await buildLiveBundle();
    const groups=new Map((live?.groups||[]).map(g=>[String(g.serviceId),g]));

    for(const record of candidates){
      const event=record.event;
      const group=groups.get(String(event.serviceId));
      if(!group)continue;
      checked++;
      if(!slotIsAvailableAgain(group,event))continue;

      const detectedAt=new Date().toISOString();
      const updated={
        ...event,
        schemaVersion:4,
        bookingStatus:'released',
        releaseDetectedAt:detectedAt,
        releaseEvidence:'slot_reappeared_in_medidate'
      };
      await overwriteEvent(record,updated);
      released++;
    }
  }

  await writeMaintenanceMarker(markerPath,{
    checkedAt:new Date().toISOString(),
    checked,
    released
  });
  cleanupIfNeeded().catch(()=>{});
  return {ok:true,skipped:false,checked,released,rebooked:rebooking.linked||0};
}


async function readMaintenanceJson(pathname){
  const {get}=await blobApi();
  const r=await get(pathname,{access:'private',useCache:false}).catch(()=>null);
  if(!r||r.statusCode!==200)return null;
  try{return JSON.parse(await streamToText(r.stream))}catch{return null}
}
function publicChangeView(event){
  return {
    eventId:String(event?.eventId||''),
    appointmentDate:String(event?.appointmentDate||''),
    appointmentTime:String(event?.appointmentTime||''),
    serviceName:String(event?.serviceName||'Termin'),
    doctorName:String(event?.doctorName||'Ärztin'),
    route:String(event?.route||''),
    patientType:String(event?.patientType||''),
    bookingStatus:String(event?.bookingStatus||'booked'),
    releaseDetectedAt:String(event?.releaseDetectedAt||''),
    releaseEvidence:String(event?.releaseEvidence||'')
  };
}
async function getPushChanges(){
  ensureBlobConfigured();

  // Hourly checks should use current mediDate availability, not the once-daily marker.
  await reconcileTrackedBookings({force:true});

  const statePath=MAINTENANCE_PREFIX+'push-state.json';
  const state=await readMaintenanceJson(statePath);
  const checkedAt=new Date().toISOString();

  if(!state?.lastCheckedAt){
    await writeMaintenanceMarker(statePath,{lastCheckedAt:checkedAt});
    return {
      ok:true,
      initialized:true,
      notify:false,
      checkedAt,
      newBookings:[],
      newReleases:[]
    };
  }

  const sinceMs=Date.parse(String(state.lastCheckedAt||''));
  const validSince=Number.isFinite(sinceMs)?sinceMs:Date.now();
  const events=await readEvents(5000);

  const newBookings=events
    .filter(e=>Date.parse(String(e?.recordedAt||''))>validSince)
    .map(publicChangeView);

  const newReleases=events
    .filter(e=>{
      if(e?.bookingStatus!=='released')return false;
      const candidates=[
        Date.parse(String(e?.releaseDetectedAt||'')),
        Date.parse(String(e?.releaseConfirmedByRebookingAt||''))
      ].filter(Number.isFinite);
      return candidates.length&&Math.max(...candidates)>validSince;
    })
    .map(publicChangeView);

  await writeMaintenanceMarker(statePath,{lastCheckedAt:checkedAt});

  return {
    ok:true,
    initialized:false,
    notify:newBookings.length>0||newReleases.length>0,
    checkedAt,
    previousCheckedAt:state.lastCheckedAt,
    newBookings,
    newReleases
  };
}

const trackingHandler=async function handler(req,res){
  try{
    if(req.method==='POST'){
      if(!sameOrigin(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'});
      const event=validatedEvent(await readJsonBody(req));
      await saveEvent(event);
      // Eine spätere erfolgreiche Buchung desselben tatsächlichen Slots belegt,
      // dass die unmittelbar vorherige getrackte Buchung dieses Slots nicht mehr
      // bestand. Datum, Uhrzeit und Ärztin genügen dafür; die Terminart darf sich ändern.
      await reconcileRebookedEvents().catch(e=>console.error('Rebooking reconciliation failed',{message:e?.message}));
      cleanupIfNeeded().catch(()=>{});
      return send(res,200,{ok:true,storage:'vercel-blob-private'});
    }

    if(req.method==='GET'){
      if(!sameOrigin(req)||!authorized(req))return send(res,401,{ok:false,error:'Nicht autorisiert.'});
      const action=String(req.query?.action||'read');

      if(action==='reconcile'){
        const result=await reconcileTrackedBookings({force:true});
        return send(res,200,{ok:true,checked:result.checked||0,released:result.released||0,rebooked:result.rebooked||0});
      }

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

module.exports=trackingHandler;
module.exports.reconcileTrackedBookings=reconcileTrackedBookings;
module.exports.reconcileRebookedEvents=reconcileRebookedEvents;
module.exports.getPushChanges=getPushChanges;
