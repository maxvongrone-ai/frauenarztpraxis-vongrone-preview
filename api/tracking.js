const crypto=require('crypto');
const {readSecret}=require('../lib/medidate-core');

let _blobApiPromise;
async function blobApi(){
  if(global.__MEDIDATE_BLOB_MOCK__)return global.__MEDIDATE_BLOB_MOCK__;
  if(!_blobApiPromise)_blobApiPromise=import('@vercel/blob');
  return _blobApiPromise;
}

const ADMIN_TOKEN_SHA256='c194250e573f3811002e49a67dd2098308f0bbe5a6042783028ad506b144dcd0';
const RETENTION_DAYS=180;
const TRACKING_PREFIX='medidate-booking-tracking/v4/events/';
const LEGACY_PREFIX='medidate-booking-tracking/v3/events/';
const MAINTENANCE_PREFIX='medidate-booking-tracking/v4/maintenance/';
const TRACKING_PUBLIC_KEY_DER=Buffer.from('MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErHJvD6uRk7+vGJePnhFJgkoMiyLv+5c4PhyW2D1o+hPFVRQj6qTZslPtqWhY0xE7kMZDuALT8d6gLhBvg95vpQ==','base64');
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
function browserSameOrigin(req){
  const site=String(req.headers['sec-fetch-site']||'');
  const origin=String(req.headers.origin||'');
  const host=String(req.headers.host||'');
  if(site&&site!=='same-origin')return false;
  if(origin){
    try{if(new URL(origin).host!==host)return false}catch{return false}
  }
  return site==='same-origin'||Boolean(origin);
}
function safeEqualText(a,b){
  const A=Buffer.from(String(a||'')),B=Buffer.from(String(b||''));
  return A.length===B.length&&A.length>0&&crypto.timingSafeEqual(A,B);
}
function authorized(req){
  const supplied=String(req.headers['x-medidate-tracking-key']||'');
  if(!supplied)return false;
  const digest=crypto.createHash('sha256').update(supplied,'utf8').digest('hex');
  return safeEqualText(digest,ADMIN_TOKEN_SHA256);
}
function ensureBlobConfigured(){
  if(!process.env.BLOB_STORE_ID&&!process.env.BLOB_READ_WRITE_TOKEN){
    throw Object.assign(new Error('Der private Vercel Blob Store ist mit diesem Deployment nicht verbunden.'),{code:'TRACKING_NOT_CONFIGURED'});
  }
}
async function readJsonBody(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){
    if(req.body.length>16384)throw new Error('Payload zu groß.');
    return JSON.parse(req.body||'{}');
  }
  let raw='';
  for await(const chunk of req){
    raw+=chunk;
    if(raw.length>16384)throw new Error('Payload zu groß.');
  }
  return JSON.parse(raw||'{}');
}
function validB64Url(v,min,max){
  const s=String(v||'');
  return s.length>=min&&s.length<=max&&/^[A-Za-z0-9_-]+$/.test(s);
}
function validateEnvelope(raw){
  const x=raw&&typeof raw==='object'?raw:null;
  if(!x||x.v!==2||x.alg!=='ECDH-P256+A256GCM')throw new Error('Ungültiger verschlüsselter Tracking-Datensatz.');
  if(!/^[0-9a-f-]{36}$/i.test(String(x.id||'')))throw new Error('Ungültige Ereignis-ID.');
  if(!validB64Url(x.epk,80,256)||!validB64Url(x.iv,12,32)||!validB64Url(x.data,32,12000))throw new Error('Ungültiger verschlüsselter Tracking-Datensatz.');
  return {v:2,alg:'ECDH-P256+A256GCM',id:String(x.id),epk:String(x.epk),iv:String(x.iv),data:String(x.data)};
}
function trackingProofValid(trackingNonce,trackingExp,proof){
  const nonce=String(trackingNonce||''),given=String(proof||''),exp=Number(trackingExp);
  const now=Date.now();
  if(!validB64Url(nonce,20,80)||!validB64Url(given,20,128)||!Number.isFinite(exp))return false;
  if(exp<=now||exp>now+12*60*60*1000+5*60*1000)return false;
  const expected=crypto.createHmac('sha256',readSecret()).update('tracking:'+nonce+':'+exp).digest('base64url');
  return safeEqualText(given,expected);
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
function envelopePath(envelope){
  return `${TRACKING_PREFIX}${envelope.id}.json`;
}
async function saveEnvelope(envelope,{pathOverride=null}={}){
  ensureBlobConfigured();
  const {get,put}=await blobApi();
  const path=pathOverride||envelopePath(envelope);
  const existing=await get(path,{access:'private',useCache:false}).catch(()=>null);
  if(existing?.statusCode===200)return false;
  await put(path,JSON.stringify(envelope),{
    access:'private',contentType:'application/json; charset=utf-8',
    addRandomSuffix:false,allowOverwrite:false
  });
  return true;
}
function b64url(buf){return Buffer.from(buf).toString('base64url')}
function encryptLegacyEvent(event){
  const recipient=crypto.createPublicKey({key:TRACKING_PUBLIC_KEY_DER,format:'der',type:'spki'});
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const shared=crypto.diffieHellman({privateKey,publicKey:recipient});
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',shared,iv);
  const plaintext=Buffer.from(JSON.stringify(event),'utf8');
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
  const epk=publicKey.export({format:'der',type:'spki'});
  const id=/^[0-9a-f-]{36}$/i.test(String(event?.eventId||''))?String(event.eventId):crypto.randomUUID();
  return {v:2,alg:'ECDH-P256+A256GCM',id,epk:b64url(epk),iv:b64url(iv),data:b64url(ciphertext)};
}
function isKnownBadLegacyEvent(event){
  return !!event &&
    String(event.appointmentDate||'')==='2026-10-29' &&
    String(event.appointmentTime||'')==='10.15' &&
    String(event.route||'')==='PKV' &&
    String(event.patientType||'')==='existing' &&
    String(event.serviceId||'')==='1950' &&
    Number(event.doctorId||0)===512 &&
    Number(event.duration||0)===15 &&
    String(event.recordedAt||'').startsWith('2026-09-23T09:25:30');
}
async function migrateLegacy(){
  const {del}=await blobApi();
  const blobs=await listAll(LEGACY_PREFIX);
  let migrated=0,deleted=0,failed=0;
  for(const blob of blobs){
    const event=await readOne(blob);
    if(!event){failed++;continue}
    const src=String(blob.pathname||'');
    if(isKnownBadLegacyEvent(event)){
      await del(blob.url||blob.pathname);deleted++;continue;
    }
    try{
      const envelope=encryptLegacyEvent(event);
      const fingerprint=crypto.createHash('sha256').update(src).digest('hex').slice(0,40);
      await saveEnvelope(envelope,{pathOverride:`${TRACKING_PREFIX}migrated-${fingerprint}.json`});
      await del(blob.url||blob.pathname);
      migrated++;
    }catch{failed++}
  }
  return {migrated,deleted,failed};
}
function blobDateMs(blob){
  const uploaded=blob?.uploadedAt?new Date(blob.uploadedAt).getTime():NaN;
  return Number.isFinite(uploaded)?uploaded:NaN;
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
  const expired=blobs.filter(b=>{const t=blobDateMs(b);return Number.isFinite(t)&&t<cutoff}).map(b=>b.url||b.pathname);
  for(let i=0;i<expired.length;i+=250)await del(expired.slice(i,i+250));
  const oldMarkers=(await listAll(MAINTENANCE_PREFIX)).filter(b=>{
    const t=blobDateMs(b);return Number.isFinite(t)&&t<Date.now()-14*86400000;
  }).map(b=>b.url||b.pathname);
  for(let i=0;i<oldMarkers.length;i+=250)await del(oldMarkers.slice(i,i+250));
  await put(markerPath,JSON.stringify({cleanedAt:new Date().toISOString(),deleted:expired.length}),{
    access:'private',contentType:'application/json; charset=utf-8',addRandomSuffix:false,allowOverwrite:true
  });
}
async function readEncryptedEvents(limit){
  const blobs=(await listAll(TRACKING_PREFIX))
    .sort((a,b)=>blobDateMs(b)-blobDateMs(a))
    .slice(0,limit);
  const events=[];
  for(let i=0;i<blobs.length;i+=40){
    const part=blobs.slice(i,i+40);
    const batch=await Promise.all(part.map(readOne));
    for(let j=0;j<batch.length;j++){
      try{
        const envelope=validateEnvelope(batch[j]);
        events.push({...envelope,storageRef:String(part[j]?.pathname||'')});
      }catch{}
    }
  }
  return events;
}
async function replaceEncryptedEvent(storageRef,envelope){
  ensureBlobConfigured();
  const ref=String(storageRef||'');
  if(!ref.startsWith(TRACKING_PREFIX)||ref.length>500)throw new Error('Ungültiger Tracking-Speicherverweis.');
  const {get,put}=await blobApi();
  const current=await get(ref,{access:'private',useCache:false}).catch(()=>null);
  if(!current||current.statusCode!==200)throw new Error('Tracking-Datensatz wurde nicht gefunden.');
  let existing;
  try{existing=validateEnvelope(JSON.parse(await streamToText(current.stream)))}catch{throw new Error('Tracking-Datensatz ist beschädigt.')}
  if(existing.id!==envelope.id)throw new Error('Tracking-Datensatz stimmt nicht überein.');
  await put(ref,JSON.stringify(envelope),{
    access:'private',contentType:'application/json; charset=utf-8',
    addRandomSuffix:false,allowOverwrite:true
  });
}

module.exports=async function handler(req,res){
  try{
    if(req.method==='POST'){
      if(!browserSameOrigin(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'});
      const body=await readJsonBody(req);

      if(String(req.query?.action||'')==='replace'){
        if(!authorized(req))return send(res,401,{ok:false,error:'Nicht autorisiert.'});
        const envelope=validateEnvelope(body?.envelope);
        await replaceEncryptedEvent(body?.storageRef,envelope);
        return send(res,200,{ok:true,storage:'vercel-blob-private-e2ee'});
      }

      if(String(req.query?.action||'')==='append'){
        if(!authorized(req))return send(res,401,{ok:false,error:'Nicht autorisiert.'});
        const envelope=validateEnvelope(body?.envelope);
        const stored=await saveEnvelope(envelope);
        return send(res,200,{ok:true,storage:'vercel-blob-private-e2ee',storageRef:envelopePath(envelope),duplicate:!stored});
      }

      if(body?.encrypted!==true) return send(res,426,{ok:false,error:'Für die Buchungsauswertung werden nur noch Ende-zu-Ende-verschlüsselte Datensätze akzeptiert.'});
      if(!trackingProofValid(body?.trackingNonce,body?.trackingExp,body?.trackingProof))return send(res,403,{ok:false,error:'Ungültiger oder abgelaufener Tracking-Nachweis.'});
      const envelope=validateEnvelope(body?.envelope);
      const nonceHash=crypto.createHash('sha256').update(String(body.trackingNonce)).digest('hex');
      const stored=await saveEnvelope(envelope,{pathOverride:`${TRACKING_PREFIX}${nonceHash}.json`});
      // Einmalige Altbestandsmigration: vorhandene V3-Klartextdaten werden
      // mit dem öffentlichen Auswertungsschlüssel verschlüsselt und anschließend gelöscht.
      migrateLegacy().catch(()=>{});
      cleanupIfNeeded().catch(()=>{});
      return send(res,200,{ok:true,storage:'vercel-blob-private-e2ee',duplicate:!stored});
    }

    if(req.method==='GET'){
      if(!browserSameOrigin(req)||!authorized(req))return send(res,401,{ok:false,error:'Nicht autorisiert.'});
      const limit=Math.max(1,Math.min(5000,Number(req.query?.limit)||2000));
      const migration=await migrateLegacy();
      await cleanupIfNeeded().catch(()=>{});
      const events=await readEncryptedEvents(limit);
      return send(res,200,{
        ok:true,storage:'vercel-blob-private-e2ee',retentionDays:RETENTION_DAYS,
        events,migration
      });
    }

    return send(res,405,{ok:false,error:'Methode nicht erlaubt.'});
  }catch(e){
    const status=e?.code==='TRACKING_NOT_CONFIGURED'?503:400;
    return send(res,status,{ok:false,error:e?.message||'Tracking-Fehler.'});
  }
};
