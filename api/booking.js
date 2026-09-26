const crypto=require('crypto');
const {bookSlot,readSecret}=require('../lib/medidate-core');

const WINDOW_MS=10*60*1000;
const MAX_ATTEMPTS=8;
const MAX_BODY_BYTES=8192;
const attempts=global.__MEDIDATE_BOOKING_RATE__||(global.__MEDIDATE_BOOKING_RATE__=new Map());
const successfulTokens=global.__MEDIDATE_BOOKING_SUCCESS__||(global.__MEDIDATE_BOOKING_SUCCESS__=new Map());

function send(res,status,body,extra={}){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  for(const [k,v] of Object.entries(extra))res.setHeader(k,v);
  res.end(JSON.stringify(body));
}

async function readJsonBody(req){
  if(req.body&&typeof req.body==='object'){const raw=JSON.stringify(req.body);if(Buffer.byteLength(raw,'utf8')>MAX_BODY_BYTES)throw Object.assign(new Error('Anfrage zu groß.'),{status:413});return req.body;}
  if(typeof req.body==='string'){
    if(Buffer.byteLength(req.body,'utf8')>MAX_BODY_BYTES)throw Object.assign(new Error('Anfrage zu groß.'),{status:413});
    return JSON.parse(req.body||'{}');
  }
  let raw='';
  for await(const chunk of req){
    raw+=chunk;
    if(Buffer.byteLength(raw,'utf8')>MAX_BODY_BYTES)throw Object.assign(new Error('Anfrage zu groß.'),{status:413});
  }
  return JSON.parse(raw||'{}');
}

function requestOriginAllowed(req){
  const host=String(req.headers.host||'');
  const origin=String(req.headers.origin||'');
  const fetchSite=String(req.headers['sec-fetch-site']||'');
  if(!host||!origin)return false;
  try{if(new URL(origin).host!==host)return false}catch{return false}
  if(fetchSite&&fetchSite!=='same-origin')return false;
  return true;
}
function clientKey(req){
  const ip=String(req.headers['x-forwarded-for']||req.headers['x-real-ip']||'unknown').split(',')[0].trim();
  return crypto.createHmac('sha256',readSecret()).update(ip).digest('hex').slice(0,32);
}
function rateAllowed(req){
  const now=Date.now(),key=clientKey(req),old=attempts.get(key);
  const rec=!old||now-old.start>WINDOW_MS?{start:now,count:0}:old;
  rec.count++;attempts.set(key,rec);
  if(attempts.size>1000){for(const [k,v] of attempts)if(now-v.start>WINDOW_MS)attempts.delete(k)}
  return rec.count<=MAX_ATTEMPTS;
}
function tokenHash(token){return crypto.createHmac('sha256',readSecret()).update(String(token||'')).digest('hex')}

function makeTrackingReceipt(result){
  const payload={v:1,eventId:crypto.randomUUID(),exp:Date.now()+10*60*1000,recordedAt:new Date().toISOString(),eventType:'booking_completed',route:result.route,patientType:result.patientType,serviceId:result.serviceKey,appointmentDate:result.date,appointmentTime:result.time,doctorId:result.doctorKey,duration:result.duration};
  const body=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
  const sig=crypto.createHmac('sha256',readSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

module.exports=async function handler(req,res){
  const started=Date.now();
  try{
    if(req.method!=='POST')return send(res,405,{ok:false,error:'Nur POST erlaubt.'},{Allow:'POST'});
    if(!requestOriginAllowed(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'});
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return send(res,415,{ok:false,error:'Ungültiger Inhaltstyp.'});
    const len=Number(req.headers['content-length']||0);if(len&&len>MAX_BODY_BYTES)return send(res,413,{ok:false,error:'Anfrage zu groß.'});
    if(!rateAllowed(req))return send(res,429,{ok:false,error:'Zu viele Buchungsversuche. Bitte versuchen Sie es später erneut.'},{'Retry-After':'600'});

    const body=await readJsonBody(req);
    if(String(body.website||'').trim())return send(res,400,{ok:false,error:'Buchung konnte nicht geprüft werden.'}); // honeypot
    const startedForm=Number(body.formStartedAt||0);
    if(!Number.isFinite(startedForm)||Date.now()-startedForm<1200||Date.now()-startedForm>2*60*60*1000)return send(res,400,{ok:false,error:'Buchungsformular ist nicht mehr gültig. Bitte Termin neu auswählen.'});
    const slotToken=String(body.slotToken||'');
    const h=tokenHash(slotToken),prior=successfulTokens.get(h);
    if(prior&&Date.now()-prior<5*60*1000)return send(res,409,{ok:false,error:'Dieser Buchungsvorgang wurde bereits erfolgreich verarbeitet. Bitte nicht erneut absenden.'});

    const result=await bookSlot({slotToken,patient:body.patient,context:body.context});
    successfulTokens.set(h,Date.now());
    if(successfulTokens.size>1000){const now=Date.now();for(const [k,v] of successfulTokens)if(now-v>10*60*1000)successfulTokens.delete(k)}
    return send(res,200,{...result,trackingReceipt:makeTrackingReceipt(result),elapsedMs:Date.now()-started});
  }catch(e){
    const status=e?.code==='BOOKING_STATUS_UNCLEAR'?502:(e?.status===413?413:(e?.status===409?409:400));
    console.error('Secure booking rejected',{code:e?.code||null,status:e?.status||null,message:e?.message,elapsedMs:Date.now()-started});
    return send(res,status,{ok:false,error:e?.message||'Die Buchung konnte nicht abgeschlossen werden.'});
  }
};
