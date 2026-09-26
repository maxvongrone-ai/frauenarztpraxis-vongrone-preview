const crypto=require('crypto');
const {visibleForContext}=require('./booking-policy');
let BUNDLED_SECRET='';
try{BUNDLED_SECRET=String(require('../api/security-secret.json')?.secret||'')}catch{}

const API_BASE='https://medidatestagingapi.azurewebsites.net/api/v1/';
const PRACTICE_HOME='https://www.frauenarztpraxis-vongrone.de/';
// Public practice booking link. Kept server-side only; never returned to the browser.
const STATIC_BOOKING_URL="https://order.medidate.org/?pid=cf9289f9-342d-4692-a047-7327144797dc&ptok=6976306d715a4c46383038522f586d6f4d61376e754a4e716e4f6a303367384b4251635743556455425962413371374c5a5736544d4f676f65477752486f4d7a764d6f53335271364670536b505661736b6e55617069566837535255456d3763426773393962313635414f4935706e70585256544e6464546b6f47543464786733542b32754b5045315a7335736d516955334578625175694470617a73726c737a375452664f62425157513d";
const EXPECTED_CLIENT_ID=Number(process.env.MEDIDATE_EXPECTED_CLIENT_ID||179);
const EXPECTED_LOCATION_ID=Number(process.env.MEDIDATE_EXPECTED_LOCATION_ID||312);

const SERVICE_RULES=Object.freeze([
  {key:'vorsorge',displayName:'Vorsorge',mediSoftId:2,names:['vorsorge']},
  {key:'followup',displayName:'Nachsorge',mediSoftId:4,names:['nachsorge']},
  {key:'breast',displayName:'Brustultraschall',mediSoftId:5,names:['brustultraschall']}
]);
const DOCTOR_RULES=Object.freeze([
  {key:'moxter',displayName:'Dr. med. Christina Moxter',mediSoftId:1,sortOrder:1,names:['dr. med. christina moxter','christina moxter']},
  {key:'vongrone',displayName:'Dr. med. Friederike von Grone',mediSoftId:2,sortOrder:2,names:['dr. med. friederike von grone','friederike von grone']}
]);

let bookingUrlCache={value:null,at:0};
let bootstrapCache={value:null,at:0};
const BOOKING_URL_CACHE_MS=10*60*1000;
const SESSION_CACHE_MS=15*60*1000;

function normalizeText(v){return String(v||'').trim().toLocaleLowerCase('de-DE').replace(/\s+/g,' ')}
function timeoutSignal(ms){const c=new AbortController();const timer=setTimeout(()=>c.abort(),ms);return {signal:c.signal,clear:()=>clearTimeout(timer)}}
async function fetchText(url,options={},timeoutMs=30000){
  const t=timeoutSignal(timeoutMs);
  try{
    const r=await fetch(url,{redirect:'follow',...options,signal:t.signal,headers:{'User-Agent':'Frauenarztpraxis-von-Grone-SecureGateway/1.0',...(options.headers||{})}});
    const text=await r.text();
    if(!r.ok){const e=new Error(`HTTP ${r.status} bei ${new URL(url).hostname}`);e.status=r.status;e.body=text;throw e}
    return text;
  }finally{t.clear()}
}
function htmlDecode(s){return String(s||'').replace(/&amp;/g,'&').replace(/&#38;/g,'&')}
async function discoverBookingUrl(force=false){
  const env=String(process.env.MEDIDATE_PUBLIC_BOOKING_URL||'').trim();
  if(env){const u=new URL(env);if(u.hostname!=='order.medidate.org')throw new Error('MEDIDATE_PUBLIC_BOOKING_URL verweist nicht auf order.medidate.org.');return u.toString()}
  if(!force&&bookingUrlCache.value&&Date.now()-bookingUrlCache.at<BOOKING_URL_CACHE_MS)return bookingUrlCache.value;
  // Primary path: known public mediDate link, avoiding an unnecessary dependency
  // on the practice website during cold starts.
  if(!force&&STATIC_BOOKING_URL){bookingUrlCache={value:STATIC_BOOKING_URL,at:Date.now()};return STATIC_BOOKING_URL}
  // Recovery path: re-discover the public link from the practice website if the
  // known link ever changes.
  const page=await fetchText(PRACTICE_HOME,{},20000);
  const candidates=[...page.matchAll(/href=["']([^"']*order\.medidate\.org[^"']*)["']/ig),...page.matchAll(/(https:\/\/order\.medidate\.org\/\?[^"'<>\\s]+)/ig)];
  for(const m of candidates){
    const raw=htmlDecode(m[1]||m[0]);
    try{const u=new URL(raw.startsWith('http')?raw:new URL(raw,PRACTICE_HOME));if(u.hostname==='order.medidate.org'){bookingUrlCache={value:u.toString(),at:Date.now()};return bookingUrlCache.value}}catch{}
  }
  throw new Error('Der öffentliche mediDate-Link konnte nicht gefunden werden.');
}
function parseBootstrapPage(page,bookingUrl){
  const c=page.match(/var\s+ClientID\s*=\s*'([0-9]+)'/),l=page.match(/var\s+LocationID\s*=\s*'([0-9]+)'/),t=page.match(/var\s+token\s*=\s*'([^']+)'/);
  if(!c||!l||!t)throw new Error('Die mediDate-Startdaten konnten nicht gelesen werden.');
  const value={clientId:Number(c[1]),locationId:Number(l[1]),token:t[1],bookingUrl,issuedAt:Date.now()};
  if(value.clientId!==EXPECTED_CLIENT_ID||value.locationId!==EXPECTED_LOCATION_ID)throw new Error('Die mediDate-Praxis-/Standortkennung entspricht nicht der freigegebenen Konfiguration.');
  return value;
}
async function bootstrap(force=false){
  if(!force&&bootstrapCache.value&&Date.now()-bootstrapCache.at<SESSION_CACHE_MS)return bootstrapCache.value;
  let firstError=null;
  // Normal path: direct server-side call to the known public mediDate URL.
  if(!force){
    try{
      const bookingUrl=await discoverBookingUrl(false);
      const page=await fetchText(bookingUrl,{},30000);
      const value=parseBootstrapPage(page,bookingUrl);
      bootstrapCache={value,at:Date.now()};return value;
    }catch(e){firstError=e;bookingUrlCache={value:null,at:0}}
  }
  // Recovery: discover the current link from the practice website and retry.
  try{
    const bookingUrl=await discoverBookingUrl(true);
    const page=await fetchText(bookingUrl,{},30000);
    const value=parseBootstrapPage(page,bookingUrl);
    bootstrapCache={value,at:Date.now()};return value;
  }catch(e){
    const err=new Error('mediDate-Bootstrap derzeit nicht erreichbar.');
    err.cause=firstError||e;throw err;
  }
}
async function apiRequest(session,relative,{method='GET',body=null,timeoutMs=30000}={}){
  const url=new URL(String(relative).replace(/^\//,''),API_BASE);
  const t=timeoutSignal(timeoutMs);
  try{
    const r=await fetch(url,{method,signal:t.signal,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${session.token}`,'User-Agent':'Frauenarztpraxis-von-Grone-SecureGateway/1.0'},body:body==null?undefined:JSON.stringify(body)});
    const text=await r.text();let data=null;if(text){try{data=JSON.parse(text)}catch{data=text}}
    if(!r.ok){const e=new Error(`mediDate API HTTP ${r.status}`);e.status=r.status;e.data=data;throw e}
    return data;
  }finally{t.clear()}
}
function asArray(v){return Array.isArray(v)?v:(v==null?[]:[v])}
function serviceMatches(rule,s){
  const n=normalizeText(s?.name),mid=Number(s?.mediSoftId);
  return rule.names.includes(n) && mid===rule.mediSoftId;
}
function doctorRuleFor(d){
  const candidates=[d?.displayName,d?.fullName,[d?.title,d?.firstName,d?.lastName].filter(Boolean).join(' '),[d?.firstName,d?.lastName].filter(Boolean).join(' ')].map(normalizeText);
  return DOCTOR_RULES.find(r=>r.names.some(n=>candidates.includes(n)))||null;
}

let practiceConfigCache={key:'',at:0};
async function assertClientAndLocation(session){
  const key=`${session.clientId}|${session.locationId}`;
  if(practiceConfigCache.key===key&&Date.now()-practiceConfigCache.at<5*60*1000)return;
  const client=await apiRequest(session,`clients/${session.clientId}`);
  if(Number(client?.id)!==session.clientId)throw new Error('mediDate-Mandant konnte nicht verifiziert werden.');
  if(client?.isAppointment===false||normalizeText(client?.state||'active')==='inactive')throw new Error('Online-Terminbuchung ist in mediDate nicht aktiv.');
  const locations=asArray(await apiRequest(session,`clients/${session.clientId}/locations`));
  const location=locations.find(x=>Number(x?.id)===session.locationId&&normalizeText(x?.state||'active')!=='inactive');
  if(!location)throw new Error('Der mediDate-Standort ist nicht freigegeben.');
  practiceConfigCache={key,at:Date.now()};
}

async function loadAllowedServices(session){
  const raw=asArray(await apiRequest(session,`clients/${session.clientId}/services?location=${session.locationId}&KV=all`));
  const out=[];
  for(const rule of SERVICE_RULES){
    const matches=raw.filter(s=>serviceMatches(rule,s)&&normalizeText(s?.state||'active')!=='inactive');
    if(matches.length!==1)throw new Error(`mediDate-Service ${rule.key} ist nicht eindeutig konfiguriert.`);
    const s=matches[0],id=Number(s?.id);
    if(!Number.isInteger(id)||id<=0||Number(s?.clientId)!==session.clientId)throw new Error(`mediDate-Service ${rule.key} ist inkonsistent.`);
    if(Number(s?.duration||15)!==15)throw new Error(`mediDate-Service ${rule.key} hat unerwartete Dauer.`);
    out.push({rule,id,mediSoftId:Number(s.mediSoftId),duration:Number(s.duration||15),raw:s});
  }
  return out;
}
async function loadAllowedDoctors(session,service){
  const raw=asArray(await apiRequest(session,`clients/${session.clientId}/doctors?location=${session.locationId}&service=${service.id}`));
  const out=[];
  for(const d of raw){
    const rule=doctorRuleFor(d);if(!rule)continue;
    if(normalizeText(d?.state||'active')==='inactive')continue;
    if(Number(d?.mediSoftId)!==rule.mediSoftId)continue;
    const id=Number(d?.id);if(!Number.isInteger(id)||id<=0)continue;
    if(d?.clientId!=null&&Number(d.clientId)!==session.clientId)continue;
    out.push({rule,id,raw:d});
  }
  if(!out.length)throw new Error(`Für ${service.rule.key} wurde keine freigegebene Ärztin gefunden.`);
  const seen=new Set();
  return out.filter(x=>!seen.has(x.rule.key)&&(seen.add(x.rule.key),true)).sort((a,b)=>a.rule.sortOrder-b.rule.sortOrder);
}
function readSecret(){
  const raw=String(process.env.BOOKING_TOKEN_SECRET||BUNDLED_SECRET||'').trim();
  if(raw.length<32)throw new Error('BOOKING_TOKEN_SECRET fehlt oder ist zu kurz.');
  return crypto.createHash('sha256').update(raw).digest();
}
function sealSlot(payload){
  const key=readSecret(),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const plaintext=Buffer.from(JSON.stringify(payload),'utf8');
  const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const tag=cipher.getAuthTag();
  return Buffer.concat([iv,tag,encrypted]).toString('base64url');
}
function openSlot(token){
  if(typeof token!=='string'||token.length<40||token.length>1200)throw new Error('Ungültiger Termin-Schlüssel.');
  const buf=Buffer.from(token,'base64url');if(buf.length<29)throw new Error('Ungültiger Termin-Schlüssel.');
  const iv=buf.subarray(0,12),tag=buf.subarray(12,28),enc=buf.subarray(28),dec=crypto.createDecipheriv('aes-256-gcm',readSecret(),iv);dec.setAuthTag(tag);
  let obj;try{obj=JSON.parse(Buffer.concat([dec.update(enc),dec.final()]).toString('utf8'))}catch{throw new Error('Termin-Schlüssel konnte nicht geprüft werden.')}
  if(obj?.v!==1||!Number.isFinite(obj?.exp)||Date.now()>obj.exp)throw new Error('Der Termin-Schlüssel ist abgelaufen. Bitte laden Sie die Terminseite neu.');
  return obj;
}
function validTime(t){return /^([01]?\d|2[0-3])\.[0-5]\d$/.test(String(t||''))}
function compactAvailability(data,{session,service,doctors}){
  const byId=new Map(doctors.map(d=>[Number(d.id),d]));
  const rows=[];
  const apiRows=asArray(data?.appointmentTimes).slice().sort((a,b)=>{
    const da=byId.get(Number(a?.doctorId))?.rule.sortOrder??999,db=byId.get(Number(b?.doctorId))?.rule.sortOrder??999;
    return String(a?.dateTimeStart||'').localeCompare(String(b?.dateTimeStart||''))||da-db||Number(a?.doctorId||0)-Number(b?.doctorId||0);
  });
  for(const r of apiRows){
    const doctor=byId.get(Number(r?.doctorId));if(!doctor)continue;
    const date=String(r?.dateTimeStart||'').slice(0,10),duration=Number(r?.duration||0),listReferenzId=Number(r?.listReferenzId||0),calendarWeek=Number(r?.calendarWeek||r?.calenderWeek||0);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||duration!==15||!Number.isFinite(listReferenzId))continue;
    const times=[];
    for(const rawTime of asArray(r?.times)){
      const time=String(rawTime);if(!validTime(time))continue;
      const slotToken=sealSlot({v:1,iat:Date.now(),exp:Date.now()+30*60*60*1000,c:session.clientId,l:session.locationId,s:service.id,sk:service.rule.key,d:doctor.id,dk:doctor.rule.key,r:listReferenzId,date,time,dur:duration,cw:calendarWeek});
      times.push({time,slotToken});
    }
    if(times.length)rows.push({dateTimeStart:String(r.dateTimeStart||''),duration,doctorKey:doctor.rule.key,calendarWeek,times});
  }
  return {appointmentTimes:rows};
}
async function buildPublicBundle(session=undefined){
  const s=session||await bootstrap(false);await assertClientAndLocation(s);const services=await loadAllowedServices(s);const groups=[];
  for(const service of services){
    const doctors=await loadAllowedDoctors(s,service);
    const data=await apiRequest(s,`appointments/appointmenttimes?clientid=${s.clientId}&locationId=${s.locationId}&serviceId=${service.id}&doctorId=0`,{timeoutMs:60000});
    groups.push({serviceKey:service.rule.key,serviceName:service.rule.displayName,doctorKeys:doctors.map(d=>d.rule.key),availability:compactAvailability(data,{session:s,service,doctors})});
  }
  return {ok:true,generatedAt:new Date().toISOString(),groups,partial:false,failedServices:0};
}
function add15DotTime(t){const m=String(t||'').match(/^(\d{1,2})\.(\d{2})$/);if(!m)return null;const mins=Number(m[1])*60+Number(m[2])+15;if(mins>=1440)return null;return `${String(Math.floor(mins/60)).padStart(2,'0')}.${String(mins%60).padStart(2,'0')}`}
function normalizeBookingContext(context={}){
  const route=String(context.route||''),patientType=String(context.patientType||''),topicMode=String(context.topicMode||'regular'),doctorChoice=String(context.doctorChoice??'0');
  if(!['PKV','GKV','SELF'].includes(route))throw new Error('Ungültiger Buchungspfad.');
  if(!['existing','new'].includes(patientType))throw new Error('Ungültiger Patientenstatus.');
  if(topicMode!=='regular')throw new Error('Dieser Buchungskontext ist in der aktuellen Kalenderfassung nicht zur Direktbuchung freigegeben.');
  if(!['0','moxter','vongrone'].includes(doctorChoice))throw new Error('Ungültige Arztauswahl.');
  const pregnancyOtherPractice=['yes','no'].includes(context.pregnancyOtherPractice)?context.pregnancyOtherPractice:'';
  return {route,patientType,topicMode,doctorChoice,pregnancyOtherPractice};
}
function rawPolicySlots(data,{service,doctors,doctorChoice}){
  const byId=new Map(doctors.map(d=>[Number(d.id),d])),rows=[];
  const apiRows=asArray(data?.appointmentTimes).slice().sort((a,b)=>{
    const da=byId.get(Number(a?.doctorId))?.rule.sortOrder??999,db=byId.get(Number(b?.doctorId))?.rule.sortOrder??999;
    return String(a?.dateTimeStart||'').localeCompare(String(b?.dateTimeStart||''))||da-db||Number(a?.doctorId||0)-Number(b?.doctorId||0);
  });
  for(const r of apiRows){
    const doctor=byId.get(Number(r?.doctorId));if(!doctor)continue;
    if(doctorChoice!=='0'&&doctor.rule.key!==doctorChoice)continue;
    const date=String(r?.dateTimeStart||'').slice(0,10),duration=Number(r?.duration||0);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||duration!==15)continue;
    for(const rawTime of asArray(r?.times)){
      const time=String(rawTime);if(!validTime(time))continue;
      rows.push({date,time,doctorId:doctor.rule.key,duration,serviceId:service.rule.key});
    }
  }
  return rows;
}
async function assertAudiencePolicy({session,service,doctors,slot,context}){
  const ctx=normalizeBookingContext(context);
  if(service.rule.key==='breast'&&ctx.route!=='SELF')throw new Error('Diese Terminart ist nur im Selbstzahler-Buchungspfad freigegeben.');
  if(['vorsorge','followup'].includes(service.rule.key)&&ctx.route==='SELF')throw new Error('Diese Terminart ist für diesen Buchungspfad nicht freigegeben.');
  const data=await apiRequest(session,`appointments/appointmenttimes?clientid=${session.clientId}&locationId=${session.locationId}&serviceId=${service.id}&doctorId=0`,{timeoutMs:45000});
  const technical=rawPolicySlots(data,{service,doctors,doctorChoice:ctx.doctorChoice});
  const visible=visibleForContext(technical,technical,ctx,new Date());
  const allowed=visible.some(x=>x.date===slot.date&&x.time===String(slot.time)&&x.doctorId===slot.dk&&x.serviceId===slot.sk);
  if(!allowed)throw new Error('Dieser Termin ist für die gewählte Patientengruppe bzw. das aktuelle Kontingent nicht freigegeben.');
  return ctx;
}
async function validateLiveSlot(slot){
  let session=await bootstrap(false);
  if(Number(slot.c)!==session.clientId||Number(slot.l)!==session.locationId){session=await bootstrap(true)}
  if(Number(slot.c)!==session.clientId||Number(slot.l)!==session.locationId)throw new Error('Die mediDate-Praxiskonfiguration hat sich geändert. Bitte Seite neu laden.');
  await assertClientAndLocation(session);
  const services=await loadAllowedServices(session),service=services.find(x=>x.rule.key===slot.sk&&x.id===Number(slot.s));
  if(!service)throw new Error('Diese Terminart ist nicht mehr freigegeben.');
  const doctors=await loadAllowedDoctors(session,service),doctor=doctors.find(x=>x.rule.key===slot.dk&&x.id===Number(slot.d));
  if(!doctor)throw new Error('Diese Ärztin ist für die Terminart nicht mehr freigegeben.');
  const data=await apiRequest(session,`appointments/appointmenttimes?clientid=${session.clientId}&locationId=${session.locationId}&serviceId=${service.id}&doctorId=${doctor.id}`,{timeoutMs:45000});
  const rows=asArray(data?.appointmentTimes);let live=null;
  for(const r of rows){
    const date=String(r?.dateTimeStart||'').slice(0,10);
    if(date!==slot.date||Number(r?.doctorId)!==doctor.id||Number(r?.duration)!==Number(slot.dur)||Number(r?.listReferenzId||0)!==Number(slot.r))continue;
    if(asArray(r?.times).map(String).includes(String(slot.time))){live={row:r,date,time:String(slot.time),duration:Number(r.duration),calendarWeek:Number(r.calendarWeek||r.calenderWeek||0),listReferenzId:Number(r.listReferenzId||0)};break}
  }
  if(!live)throw new Error('Dieser Termin ist inzwischen nicht mehr frei. Bitte wählen Sie einen anderen Termin.');
  if(slot.date==='2026-09-28'){
    const mins=(()=>{const m=String(slot.time).match(/^(\d{1,2})\.(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):-1})();
    if(mins>=12*60&&mins<13*60){
      const next=add15DotTime(slot.time);let follow=false;
      for(const r of rows){
        if(String(r?.dateTimeStart||'').slice(0,10)===slot.date&&Number(r?.doctorId)===doctor.id&&Number(r?.duration)===15&&asArray(r?.times).map(String).includes(next)){follow=true;break}
      }
      if(!follow)throw new Error('Der für diesen Sondertermin notwendige Folgeslot ist nicht mehr frei.');
    }
  }
  return {session,service,doctor,doctors,live};
}
function sanitizePatient(p){
  const cleanName=v=>String(v||'').trim().replace(/[\u0000-\u001F\u007F]/g,'').slice(0,80);
  const firstName=cleanName(p?.firstName),lastName=cleanName(p?.lastName),birthDate=String(p?.birthDate||''),email=String(p?.email||'').trim().slice(0,254);
  if(firstName.length<1||lastName.length<1)throw new Error('Vor- und Nachname fehlen.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate))throw new Error('Ungültiges Geburtsdatum.');
  const bd=new Date(birthDate+'T12:00:00Z'),now=new Date(),oldest=new Date(Date.UTC(now.getUTCFullYear()-110,now.getUTCMonth(),now.getUTCDate()));
  if(Number.isNaN(bd.getTime())||bd>now||bd<oldest)throw new Error('Ungültiges Geburtsdatum.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Ungültige E-Mail-Adresse.');
  return {firstName,lastName,birthDate,email};
}
function safeComment(context={}){
  const flags=[];const route=String(context.route||''),topic=String(context.topicMode||''),patientType=String(context.patientType||'');
  if(route==='SELF')flags.push('IGeL/Selbstzahler');
  if(topic==='igel_spirale')flags.push('Selbstzahler: Spirale Einlage');
  if(topic==='igel_hormon')flags.push('Selbstzahler: Wechseljahressprechstunde');
  if(topic==='igel_harmony')flags.push('Selbstzahler: Harmony-Test®');
  if(topic==='pregnancy')flags.push('Schwangerschaft');
  if(route==='GKV'&&patientType==='new'&&topic==='pregnancy'&&['yes','no'].includes(context.pregnancyOtherPractice))flags.push(`Andere gyn. Schwangerschaftsvorsorge/-betreuung lfd. Quartal: ${context.pregnancyOtherPractice==='yes'?'JA':'NEIN'}`);
  return flags.length?`[${flags.join(' | ')}]`:'';
}
function appointmentCode(data){
  const seen=new Set(),valid=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{6,120}$/.test(s.trim());
  function fromUrl(s){const m=typeof s==='string'?s.match(/\/Appointment\/Cancel\/([A-Za-z0-9_-]{6,120})(?:[/?#]|$)/i):null;return m?m[1]:null}
  function walk(v,depth=0){if(v==null||depth>6)return null;if(typeof v==='string')return fromUrl(v);if(typeof v!=='object'||seen.has(v))return null;seen.add(v);for(const k of ['appointmentCode','AppointmentCode','cancelCode','cancellationCode','stornoCode'])if(valid(v[k]))return v[k].trim();for(const val of Object.values(v)){const u=fromUrl(val);if(u)return u}for(const val of Object.values(v)){const x=walk(val,depth+1);if(x)return x}return null}
  return walk(data);
}
async function bookSlot({slotToken,patient,context}){
  const slot=openSlot(slotToken),p=sanitizePatient(patient),checked=await validateLiveSlot(slot),ctx=await assertAudiencePolicy({session:checked.session,service:checked.service,doctors:checked.doctors,slot,context}),now=new Date().toISOString();
  const payload={id:0,appointmentCode:'',mediSoftId:0,clientId:checked.session.clientId,locationId:checked.session.locationId,doctorId:checked.doctor.id,serviceId:checked.service.id,listReferenzId:checked.live.listReferenzId,timeSlotId:0,type:'Online',state:1,dueDate:`${checked.live.date}T${checked.live.time.replace('.',':')}:00`,duration:checked.live.duration,dayOfYear:0,calenderWeek:checked.live.calendarWeek,birthDate:p.birthDate,firstName:p.firstName,lastName:p.lastName,ticketid:'',sex:'Frau',mobilePhone:'',eMailAddress:p.email,comment:safeComment(ctx),createdOn:now,changedOn:now};
  let result;
  try{
    result=await apiRequest(checked.session,'appointments',{method:'POST',body:payload,timeoutMs:45000});
  }catch(e){
    if(e?.status&&e.status<500)throw e;
    const unclear=new Error('mediDate hat den Buchungsversuch nicht eindeutig bestätigt. Bitte nicht erneut buchen; prüfen Sie eine mögliche Bestätigung oder kontaktieren Sie die Praxis.');
    unclear.code='BOOKING_STATUS_UNCLEAR';unclear.status=502;throw unclear;
  }
  return {ok:true,appointmentCode:appointmentCode(result),date:checked.live.date,time:checked.live.time,duration:checked.live.duration,doctorKey:checked.doctor.rule.key,serviceKey:checked.service.rule.key,route:ctx.route,patientType:ctx.patientType};
}
module.exports={API_BASE,SERVICE_RULES,DOCTOR_RULES,bootstrap,buildPublicBundle,bookSlot,openSlot,readSecret};
