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
const TRACKING_PUBLIC_KEY_PEM=`-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA578kL88BzE8PWPrrcKjj
wF+vYB/7idETPjgLutvcSO9WhQcJluI4o5WeBpmtfh2qsS5RLN3dXsv373koWH1F
JFkyR4943191LTNUcLfg17yYBsajZLFNTifk/TRp6U3h+eZJ3dhUXCluSaf80fhr
aQ+nZxGkpppwmTaZpUhPf0UIOBzSI3ej+jHVBcluFQTHtE2uwDcPt7xl2JdQ5dKx
kS4uX98RWUsh84lAugbFK3mfIhtkNMEHG8dur6qDjqnr52oauVW2agDif3hndG8L
Z730/ng9AQuwesGmsSJV2KBfzcvF7ozD00aZcTDtWigYAqHbu3h3yBjFb8Pwf6al
rW+tpAJnWPwqzC5H9XvaAAJ+hxZtt0HQWZ0pwvxZAw475duk70qQ7Ym6ARN/hF7r
H0CQ2q0I/B5q88fmIn6ZNhPZ6sGVk80Hb/iVWqkRBsyxiO1pk/BQLazpQg5QPihB
9gfCW3K5/bYLnGWGdLo3+BmEDCdJGns9K+ic0P8ylfs7AgMBAAE=
-----END PUBLIC KEY-----`;

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
  if(!x||x.v!==1||x.alg!=='RSA-OAEP-256+A256GCM')throw new Error('Ungültiger verschlüsselter Tracking-Datensatz.');
  if(!/^[0-9a-f-]{36}$/i.test(String(x.id||'')))throw new Error('Ungültige Ereignis-ID.');
  if(!validB64Url(x.ek,256,1024)||!validB64Url(x.iv,12,32)||!validB64Url(x.data,32,12000))throw new Error('Ungültiger verschlüsselter Tracking-Datensatz.');
  return {v:1,alg:'RSA-OAEP-256+A256GCM',id:String(x.id),ek:String(x.ek),iv:String(x.iv),data:String(x.data)};
}
function trackingProofValid(slotToken,proof){
  const token=String(slotToken||''),given=String(proof||'');
  if(token.length<40||token.length>4096||!validB64Url(given,20,128))return false;
  const expected=crypto.createHmac('sha256',readSecret()).update('tracking:'+token).digest('base64url');
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
  const aesKey=crypto.randomBytes(32),iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',aesKey,iv);
  const plaintext=Buffer.from(JSON.stringify(event),'utf8');
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
  const ek=crypto.publicEncrypt({
    key:TRACKING_PUBLIC_KEY_PEM,
    padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:'sha256'
  },aesKey);
  const id=/^[0-9a-f-]{36}$/i.test(String(event?.eventId||''))?String(event.eventId):crypto.randomUUID();
  return {v:1,alg:'RSA-OAEP-256+A256GCM',id,ek:b64url(ek),iv:b64url(iv),data:b64url(ciphertext)};
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
    const batch=await Promise.all(blobs.slice(i,i+40).map(readOne));
    for(const x of batch){
      try{events.push(validateEnvelope(x))}catch{}
    }
  }
  return events;
}

module.exports=async function handler(req,res){
  try{
    if(req.method==='POST'){
      if(!browserSameOrigin(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'});
      const body=await readJsonBody(req);
      if(body?.encrypted!==true) return send(res,426,{ok:false,error:'Für die Buchungsauswertung werden nur noch Ende-zu-Ende-verschlüsselte Datensätze akzeptiert.'});
      if(!trackingProofValid(body?.slotToken,body?.trackingProof))return send(res,403,{ok:false,error:'Ungültiger Tracking-Nachweis.'});
      const envelope=validateEnvelope(body?.envelope);
      const stored=await saveEnvelope(envelope);
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
