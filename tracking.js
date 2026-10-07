const $=s=>document.querySelector(s);
let current=[],currentRetention=180,currentStorage='vercel-blob-private-e2ee',currentMigration=null,lastStatusCheck=0,checking=false,pvsChecking=false;
const WRAPPED_PRIVATE=Object.freeze({
 v:3,kdf:'PBKDF2-SHA256',iterations:310000,
 salt:'8FRW7TuDk1dcegVpoRbEWQ',
 iv:'JbfgT1gdN4YuNFdP',
 data:'wyH8fgHoZEs1qUDlhWQQ97TIu5dli_ANsFmeNQLc5t7DB7YSphpBHnERvPTc30d8gCQABIYHf5ErxNCkuMRUFs2zNywDIw9T5ZyuNSioWWzWAJBywGuftwRLk4Mkj0_EjBHihbfAmW4_dDxxPvc3JEQvqHAdpUpbk-OUmXXP1T51PGiphxT9R1FjBE55mVSOujCy8HgVodhYBg',
 aad:'medidate-tracking-private-key-v3'
});
const TRACKING_PUBLIC_KEY_SPKI_B64='MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErHJvD6uRk7+vGJePnhFJgkoMiyLv+5c4PhyW2D1o+hPFVRQj6qTZslPtqWhY0xE7kMZDuALT8d6gLhBvg95vpQ==';
const SERVICE_FALLBACK=Object.freeze({vorsorge:1950,contraception:1952,followup:1973,breast:1974,pregnancy:1950,'1950':1950,'1952':1952,'1973':1973,'1974':1974});
const DOCTOR_FALLBACK=Object.freeze({moxter:512,vongrone:513,'512':512,'513':513});
const PVS_SNAPSHOT_KEY='medidate-pvs-free-slots-v1';
const PVS_MONITOR_SERVICE_IDS=Object.freeze([1950,1952,1973,1974]);
const PVS_MONITOR_DOCTOR_IDS=Object.freeze([512,513]);
const PVS_DOCTOR_NAMES=Object.freeze({512:'Dr. Christina Moxter',513:'Dr. med. Friederike von Grone'});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const deDate=iso=>String(iso||'').split('-').reverse().join('.');
const routeName=r=>r==='PKV'?'Privatversicherte / Selbstzahler':r==='GKV'?'Gesetzlich Versicherte':r==='SELF'?'Besondere Selbstzahlerleistungen':r==='PVS'?'Praxisprogramm / PVS':r;
const patientName=p=>p==='existing'?'Bestandspatientin':p==='new'?'Neupatientin':'';

function b64urlToBytes(s){
 let x=String(s||'').replace(/-/g,'+').replace(/_/g,'/');
 while(x.length%4)x+='=';
 const bin=atob(x),out=new Uint8Array(bin.length);
 for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
 return out;
}
function b64ToBytes(s){
 const bin=atob(String(s||'')),out=new Uint8Array(bin.length);
 for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
 return out;
}
function bytesToB64Url(bytes){
 let s='';const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function secretParts(){
 const raw=String(location.hash||'').replace(/^#/,'');
 const p=new URLSearchParams(raw);
 return {auth:String(p.get('a')||''),decrypt:String(p.get('d')||'')};
}
async function privateKey(decryptSecret){
 const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(decryptSecret),'PBKDF2',false,['deriveKey']);
 const wrapKey=await crypto.subtle.deriveKey({
   name:'PBKDF2',salt:b64urlToBytes(WRAPPED_PRIVATE.salt),
   iterations:WRAPPED_PRIVATE.iterations,hash:'SHA-256'
 },base,{name:'AES-GCM',length:256},false,['decrypt']);
 const raw=await crypto.subtle.decrypt({
   name:'AES-GCM',iv:b64urlToBytes(WRAPPED_PRIVATE.iv),
   additionalData:new TextEncoder().encode(WRAPPED_PRIVATE.aad)
 },wrapKey,b64urlToBytes(WRAPPED_PRIVATE.data));
 return crypto.subtle.importKey('pkcs8',raw,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
}
async function decryptEnvelope(env,priv){
 if(!env||env.v!==2||env.alg!=='ECDH-P256+A256GCM')throw new Error('Unbekanntes Verschlüsselungsformat.');
 const epk=await crypto.subtle.importKey('spki',b64urlToBytes(env.epk),{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=await crypto.subtle.deriveBits({name:'ECDH',public:epk},priv,256);
 const aes=await crypto.subtle.importKey('raw',shared,{name:'AES-GCM'},false,['decrypt']);
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64urlToBytes(env.iv)},aes,b64urlToBytes(env.data));
 const event=JSON.parse(new TextDecoder().decode(raw));
 Object.defineProperty(event,'_storageRef',{value:String(env.storageRef||''),writable:true,enumerable:false});
 return event;
}
let trackingPublicKeyPromise=null;
async function trackingPublicKey(){
 if(!trackingPublicKeyPromise){
   trackingPublicKeyPromise=crypto.subtle.importKey('spki',b64ToBytes(TRACKING_PUBLIC_KEY_SPKI_B64),{name:'ECDH',namedCurve:'P-256'},false,[]);
 }
 return trackingPublicKeyPromise;
}
async function encryptEvent(event){
 const recipient=await trackingPublicKey();
 const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const shared=await crypto.subtle.deriveBits({name:'ECDH',public:recipient},ephemeral.privateKey,256);
 const aes=await crypto.subtle.importKey('raw',shared,{name:'AES-GCM'},false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode(JSON.stringify(event)));
 const epk=await crypto.subtle.exportKey('spki',ephemeral.publicKey);
 return {v:2,alg:'ECDH-P256+A256GCM',id:String(event.eventId),epk:bytesToB64Url(epk),iv:bytesToB64Url(iv),data:bytesToB64Url(data)};
}
function timeMinutes(value){
 const m=String(value||'').match(/^(\d{1,2})[.:](\d{2})$/);
 return m?Number(m[1])*60+Number(m[2]):NaN;
}
function berlinNow(){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
 const o={};for(const x of p)if(x.type!=='literal')o[x.type]=x.value;
 return {date:`${o.year}-${o.month}-${o.day}`,minutes:Number(o.hour)*60+Number(o.minute)};
}
function isFuture(event){
 const n=berlinNow(),date=String(event?.appointmentDate||'');
 if(date>n.date)return true;if(date<n.date)return false;
 const m=timeMinutes(event?.appointmentTime);
 return Number.isFinite(m)&&m>n.minutes;
}
function effectiveServiceId(e){return Number(e?.mediDateServiceId||SERVICE_FALLBACK[String(e?.serviceId||'')]||0)}
function effectiveDoctorId(e){return Number(e?.mediDateDoctorId||DOCTOR_FALLBACK[String(e?.doctorId||'')]||0)}
function slotKey(e){
 const doc=effectiveDoctorId(e)||String(e?.doctorId||'');
 const t=timeMinutes(e?.appointmentTime);
 return `${String(e?.appointmentDate||'')}|${doc}|${Number.isFinite(t)?t:String(e?.appointmentTime||'')}`;
}
function isPrivateConsultation(e){
 const d=String(e?.appointmentDate||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if(!d)return false;
 const weekday=new Date(Date.UTC(Number(d[1]),Number(d[2])-1,Number(d[3]))).getUTCDay();
 const m=timeMinutes(e?.appointmentTime);
 return weekday===3&&Number.isFinite(m)&&m>=14*60+30&&m<17*60;
}
function bookingStatus(e){
 if(e?.bookingStatus==='released')return 'Storniert / wieder freigegeben';
 if(e?.eventType==='pvs_booking_detected'||e?.bookingStatus==='pvs')return 'Praxis/PVS: nicht mehr frei';
 if(!isFuture(e))return 'Termin vorbei';
 return 'Gebucht';
}
function statusDetail(e){
 const details=[];
 if(isPrivateConsultation(e))details.push('Privatsprechstunde (Mi. 14:30–17:00 Uhr)');
 if(e?.releaseEvidence==='slot_rebooked'){
   const w=e.releaseConfirmedByRebookingAt?new Date(e.releaseConfirmedByRebookingAt).toLocaleString('de-DE'):'';
   details.push('Durch spätere Wiederbuchung desselben Slots bestätigt'+(w?' · '+w:''));
 }else if(e?.releaseEvidence==='slot_reappeared_in_medidate'){
   const w=e.releaseDetectedAt?new Date(e.releaseDetectedAt).toLocaleString('de-DE'):'';
   details.push('Slot in mediDate wieder frei'+(w?' · '+w:''));
 }else if(e?.eventType==='pvs_booking_detected'){
   const w=e.pvsDetectedAt?new Date(e.pvsDetectedAt).toLocaleString('de-DE'):'';
   details.push('Zuvor frei; bei der nächsten Prüfung nicht mehr in mediDate/PVS verfügbar'+(w?' · erkannt '+w:''));
 }
 return details.join(' · ');
}
function render(events=current,retention=currentRetention,storage=currentStorage,migration=currentMigration,extra=''){
 current=(events||[]).slice().sort((a,b)=>String(b.recordedAt||'').localeCompare(String(a.recordedAt||'')));
 currentRetention=retention;currentStorage=storage;currentMigration=migration;
 $('#nAll').textContent=current.length;
 $('#nPkv').textContent=current.filter(x=>x.route==='PKV').length;
 $('#nGkv').textContent=current.filter(x=>x.route==='GKV').length;
 $('#nSelf').textContent=current.filter(x=>x.route==='SELF').length;
 $('#nReleased').textContent=current.filter(x=>x.bookingStatus==='released').length;
 $('#nPvs').textContent=current.filter(x=>x?.eventType==='pvs_booking_detected').length;
 $('#rows').innerHTML=current.map(x=>{
   const bs=bookingStatus(x),detail=statusDetail(x),released=x.bookingStatus==='released',pvs=x?.eventType==='pvs_booking_detected';
   const rowClass=pvs&&!released?' class="pvs-row"':'';
   return `<tr${rowClass}><td>${esc(deDate(x.appointmentDate))} · ${esc(String(x.appointmentTime||'').replace('.',':'))}</td><td>${esc(routeName(x.route))}</td><td>${esc(patientName(x.patientType)||'—')}</td><td class="${released?'released':(pvs?'pvs':'')}">${esc(bs)}${detail?`<span class="status-detail">${esc(detail)}</span>`:''}</td><td>${esc(x.serviceName||'—')}</td><td>${esc(x.doctorName)}</td><td>${esc(x.duration)} Min.</td><td>${esc(new Date(x.recordedAt).toLocaleString('de-DE'))}</td></tr>`;
 }).join('')||'<tr><td colspan="8" class="muted">Noch keine Tracking-Datensätze.</td></tr>';
 $('#summaryPanel').classList.remove('hidden');$('#tablePanel').classList.remove('hidden');$('#csv').classList.remove('hidden');
 const storageName=storage==='vercel-blob-private-e2ee'?'privater Vercel Blob · Ende-zu-Ende verschlüsselt':storage||'Speicher';
 const mig=Number(migration?.migrated||0)>0?` · ${migration.migrated} Alt-Datensätze verschlüsselt migriert`:'';
 const chk=lastStatusCheck?` · Status-Prüfung: ${new Date(lastStatusCheck).toLocaleString('de-DE')}`:'';
 $('#status').className='muted';$('#status').textContent=`${current.length} Datensätze geladen · Speicherdauer: ${retention} Tage · Speicher: ${storageName}${mig}${chk}${extra}`;
}
let sessionCache=null;
async function mediDateSession(force=false){
 if(!force&&sessionCache&&Date.now()-Number(sessionCache.issuedAt||0)<10*60*1000)return sessionCache;
 const u=new URL('/api/session',location.origin);
 if(force)u.searchParams.set('force','1');
 const r=await fetch(u,{cache:'no-store',credentials:'same-origin'}),j=await r.json().catch(()=>null);
 if(!r.ok||!j?.ok||!j?.token||!j?.apiBase)throw new Error(j?.error||'Sichere mediDate-Sitzung nicht verfügbar.');
 sessionCache=j;return j;
}
async function fetchAvailability(serviceId,doctorId){
 let s=await mediDateSession(false);
 async function once(session){
   const u=new URL('appointments/appointmenttimes',session.apiBase);
   u.searchParams.set('clientid',String(session.clientId));
   u.searchParams.set('locationId',String(session.locationId));
   u.searchParams.set('serviceId',String(serviceId));
   u.searchParams.set('doctorId',String(doctorId));
   const r=await fetch(u,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${session.token}`}});
   if((r.status===401||r.status===403))return {retry:true};
   const j=await r.json().catch(()=>null);
   if(!r.ok)throw new Error(`mediDate HTTP ${r.status}`);
   return {data:j};
 }
 let x=await once(s);
 if(x.retry){sessionCache=null;s=await mediDateSession(true);x=await once(s)}
 if(x.retry)throw new Error('mediDate-Sitzung konnte nicht erneuert werden.');
 return Array.isArray(x.data?.appointmentTimes)?x.data.appointmentTimes:[];
}
function slotAvailableAgain(rows,event){
 const targetDate=String(event?.appointmentDate||''),doc=effectiveDoctorId(event),start=timeMinutes(event?.appointmentTime);
 if(!targetDate||!doc||!Number.isFinite(start))return false;
 const blocks=Math.max(1,Math.ceil((Number(event?.duration)||15)/15));
 for(const row of rows||[]){
   if(String(row?.dateTimeStart||'').slice(0,10)!==targetDate)continue;
   if(Number(row?.doctorId||0)!==doc)continue;
   const available=new Set((Array.isArray(row?.times)?row.times:[]).map(timeMinutes).filter(Number.isFinite));
   let all=true;for(let i=0;i<blocks;i++)if(!available.has(start+i*15)){all=false;break}
   if(all)return true;
 }
 return false;
}

function pvsSnapshotRead(){
 try{
   const raw=localStorage.getItem(PVS_SNAPSHOT_KEY),x=raw?JSON.parse(raw):null;
   if(x&&x.v===1&&Array.isArray(x.slots)&&x.capturedAt)return x;
 }catch{}
 return null;
}
function pvsSnapshotWrite(slots){
 try{
   localStorage.setItem(PVS_SNAPSHOT_KEY,JSON.stringify({
     v:1,capturedAt:new Date().toISOString(),
     slots:(slots||[]).map(x=>({key:x.key,date:x.date,time:x.time,doctorId:Number(x.doctorId)}))
   }));
 }catch{}
}
function pvsDoctorName(id){return PVS_DOCTOR_NAMES[Number(id)]||'Ärztin'}
function snapshotSlotFuture(slot){
 const n=berlinNow(),date=String(slot?.date||'');
 if(date>n.date)return true;
 if(date<n.date)return false;
 const m=timeMinutes(slot?.time);
 return Number.isFinite(m)&&m>n.minutes;
}
function rowsToPvsSlots(rows,doctorId,map){
 for(const row of rows||[]){
   const date=String(row?.dateTimeStart||'').slice(0,10);
   if(!date)continue;
   const rowDoctor=Number(row?.doctorId||doctorId||0);
   if(rowDoctor!==Number(doctorId))continue;
   for(const raw of Array.isArray(row?.times)?row.times:[]){
     const time=typeof raw==='string'?raw:String(raw?.time||'');
     const mins=timeMinutes(time);
     if(!Number.isFinite(mins))continue;
     const normalized=time.includes(':')?time.replace(':','.'):time;
     const slot={date,time:normalized,doctorId:Number(doctorId),key:date+'|'+Number(doctorId)+'|'+mins};
     if(snapshotSlotFuture(slot)&&!map.has(slot.key))map.set(slot.key,slot);
   }
 }
}
async function fetchPvsFreeSlots(){
 const out=new Map();
 for(const doctorId of PVS_MONITOR_DOCTOR_IDS){
   for(const serviceId of PVS_MONITOR_SERVICE_IDS){
     const rows=await fetchAvailability(serviceId,doctorId);
     rowsToPvsSlots(rows,doctorId,out);
   }
 }
 return out;
}
function pvsDisappearanceExplained(key,capturedAt){
 return current.some(e=>{
   if(slotKey(e)!==key)return false;
   if(e?.eventType==='pvs_booking_detected'&&e.bookingStatus!=='released')return true;
   if(e?.eventType==='booking_completed'&&String(e.recordedAt||'')>=String(capturedAt||''))return true;
   return false;
 });
}
async function appendEncryptedAdminEvent(event,auth){
 const envelope=await encryptEvent(event);
 const u=new URL('/api/tracking',location.origin);u.searchParams.set('action','append');
 const r=await fetch(u,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-MediDate-Tracking-Key':auth},body:JSON.stringify({envelope})});
 const j=await r.json().catch(()=>null);
 if(!r.ok||!j?.ok)throw new Error(j?.error||'Praxis/PVS-Status konnte nicht gespeichert werden.');
 if(j.storageRef)Object.defineProperty(event,'_storageRef',{value:String(j.storageRef),writable:true,enumerable:false});
 return event;
}
async function reconcilePvsBookings(){
 if(pvsChecking)return;
 const secret=secretParts();if(!secret.auth)return;
 pvsChecking=true;
 try{
   const freeNow=await fetchPvsFreeSlots();
   const previous=pvsSnapshotRead();
   let detected=0,released=0;
   if(previous){
     for(const prev of previous.slots){
       if(!snapshotSlotFuture(prev)||freeNow.has(String(prev.key||'')))continue;
       const key=String(prev.key||'');
       if(!key||pvsDisappearanceExplained(key,previous.capturedAt))continue;
       const detectedAt=new Date().toISOString();
       const event={
         schemaVersion:7,eventId:crypto.randomUUID(),eventType:'pvs_booking_detected',
         route:'PVS',patientType:'',serviceId:'PVS',serviceName:'—',
         appointmentDate:String(prev.date||''),appointmentTime:String(prev.time||''),
         doctorId:String(Number(prev.doctorId)||''),doctorName:pvsDoctorName(prev.doctorId),
         duration:15,bookingStatus:'pvs',
         detectionEvidence:'slot_disappeared_from_medidate',
         previouslyFreeAt:String(previous.capturedAt||''),pvsDetectedAt:detectedAt,recordedAt:detectedAt
       };
       await appendEncryptedAdminEvent(event,secret.auth);
       current.push(event);detected++;
     }
   }
   for(const e of current.filter(x=>x?.eventType==='pvs_booking_detected'&&x.bookingStatus!=='released'&&isFuture(x))){
     if(freeNow.has(slotKey(e))){
       e.bookingStatus='released';
       e.releaseDetectedAt=new Date().toISOString();
       e.releaseEvidence='slot_reappeared_in_medidate';
       await persistEvent(e,secret.auth);
       released++;
     }
   }
   pvsSnapshotWrite([...freeNow.values()]);
   lastStatusCheck=Date.now();
   const first=previous?'':' · Praxis/PVS-Monitor initialisiert: '+freeNow.size+' freie Slots gemerkt';
   const change=detected||released?' · Praxis/PVS: '+detected+' neu nicht mehr frei'+(released?' · '+released+' wieder frei':''):'';
   render(current,currentRetention,currentStorage,currentMigration,first+change);
 }catch(e){
   render(current,currentRetention,currentStorage,currentMigration);
   $('#status').className='muted bad';
   $('#status').textContent='Buchungen geladen; Praxis/PVS-Prüfung derzeit nicht vollständig möglich: '+(e?.message||'unbekannter Fehler');
 }finally{
   pvsChecking=false;
 }
}

async function persistEvent(event,auth){
 if(!event?._storageRef||!/^[0-9a-f-]{36}$/i.test(String(event.eventId||'')))return false;
 const envelope=await encryptEvent(event);
 const u=new URL('/api/tracking',location.origin);u.searchParams.set('action','replace');
 const r=await fetch(u,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-MediDate-Tracking-Key':auth},body:JSON.stringify({storageRef:event._storageRef,envelope})});
 if(!r.ok)throw new Error('Verschlüsselter Storno-Status konnte nicht gespeichert werden.');
 return true;
}
function reconcileRebookings(events,changed){
 const ordered=events.filter(x=>x?.eventType==='booking_completed').slice().sort((a,b)=>String(a.recordedAt||'').localeCompare(String(b.recordedAt||'')));
 const last=new Map();
 for(const event of ordered){
   const key=slotKey(event),prev=last.get(key);
   if(prev&&prev.eventId!==event.eventId){
     if(prev.bookingStatus!=='released'||prev.releaseEvidence!=='slot_rebooked'||prev.rebookedByEventId!==event.eventId){
       prev.bookingStatus='released';
       prev.releaseDetectedAt=prev.releaseDetectedAt||event.recordedAt||new Date().toISOString();
       prev.releaseEvidence='slot_rebooked';
       prev.releaseConfirmedByRebookingAt=event.recordedAt||new Date().toISOString();
       prev.rebookedByEventId=event.eventId;
       changed.add(prev);
     }
     if(event.previousBookingEventId!==prev.eventId){
       event.previousBookingEventId=prev.eventId;
       event.previousBookingRecordedAt=prev.recordedAt;
       changed.add(event);
     }
   }
   last.set(key,event);
 }
}
async function reconcileCancellations({manual=false}={}){
 if(checking)return;
 const secret=secretParts();if(!secret.auth||!current.length)return;
 checking=true;$('#reconcile').disabled=true;
 const changed=new Set();
 try{
   $('#status').className='muted';$('#status').textContent='Stornierungen werden direkt mit mediDate abgeglichen …';
   reconcileRebookings(current,changed);
   const candidates=current.filter(e=>e?.eventType==='booking_completed'&&e.bookingStatus!=='released'&&isFuture(e)&&effectiveServiceId(e)&&effectiveDoctorId(e));
   const groups=new Map();
   for(const e of candidates){
     const key=`${effectiveServiceId(e)}|${effectiveDoctorId(e)}`;
     if(!groups.has(key))groups.set(key,{serviceId:effectiveServiceId(e),doctorId:effectiveDoctorId(e),events:[]});
     groups.get(key).events.push(e);
   }
   let checked=0,released=0;
   for(const g of groups.values()){
     const rows=await fetchAvailability(g.serviceId,g.doctorId);
     for(const e of g.events){
       checked++;
       if(slotAvailableAgain(rows,e)){
         e.bookingStatus='released';
         e.releaseDetectedAt=new Date().toISOString();
         e.releaseEvidence='slot_reappeared_in_medidate';
         changed.add(e);released++;
       }
     }
   }
   for(const e of changed)await persistEvent(e,secret.auth);
   lastStatusCheck=Date.now();
   render(current,currentRetention,currentStorage,currentMigration,` · geprüft: ${checked}${released?` · neu wieder frei: ${released}`:''}`);
 }catch(e){
   render(current,currentRetention,currentStorage,currentMigration);
   $('#status').className='muted bad';
   $('#status').textContent=`Buchungen geladen; Storno-Prüfung derzeit nicht vollständig möglich: ${e?.message||'unbekannter Fehler'}`;
 }finally{
   checking=false;$('#reconcile').disabled=false;
 }
}
async function reconcileAll(opts={}){
 await reconcileCancellations(opts);
 await reconcilePvsBookings(opts);
}
async function load(){
 const secret=secretParts();$('#status').className='muted';$('#status').textContent='Lädt und entschlüsselt …';
 if(!secret.auth||!secret.decrypt){$('#status').className='muted bad';$('#status').textContent='Ungültige Auswertungs-URL: Zugangs- oder Entschlüsselungsschlüssel fehlt.';return}
 try{
  const priv=await privateKey(secret.decrypt);
  const r=await fetch('/api/tracking?limit=2000',{cache:'no-store',credentials:'same-origin',headers:{'X-MediDate-Tracking-Key':secret.auth}});
  const j=await r.json();
  if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
  const events=[];
  for(let i=0;i<(j.events||[]).length;i+=50){
    const batch=await Promise.all((j.events||[]).slice(i,i+50).map(x=>decryptEnvelope(x,priv)));
    events.push(...batch);
  }
  current=events;currentRetention=j.retentionDays;currentStorage=j.storage;currentMigration=j.migration;
  render(current,currentRetention,currentStorage,currentMigration);
  await reconcileAll();
 }catch(e){
  $('#status').className='muted bad';
  $('#status').textContent='Auswertung konnte nicht entschlüsselt werden. Prüfen Sie, ob Sie die neue geheime Auswertungs-URL verwenden.';
  $('#summaryPanel').classList.add('hidden');$('#tablePanel').classList.add('hidden');$('#csv').classList.add('hidden');
 }
}
function csv(){
 const head=['Termin-Datum','Termin-Uhrzeit','Buchungspfad','Patientenstatus','Buchungsstatus','Statusdetail','Terminart','Ärztin','Dauer Minuten','Erfasst'];
 const q=v=>'"'+String(v??'').replaceAll('"','""')+'"';
 const lines=[head,...current.map(x=>[x.appointmentDate,String(x.appointmentTime||'').replace('.',':'),routeName(x.route),patientName(x.patientType),bookingStatus(x),statusDetail(x),x.serviceName,x.doctorName,x.duration,x.recordedAt])].map(r=>r.map(q).join(';')).join('\r\n');
 const blob=new Blob(['\ufeff'+lines],{type:'text/csv;charset=utf-8'}),u=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=u;a.download='medidate-buchungsauswertung.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
}
$('#currentUrl').textContent=location.href;
$('#copyUrl').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$('#copyUrl').textContent='Kopiert';setTimeout(()=>$('#copyUrl').textContent='URL kopieren',1200)}catch{}};
$('#reload').onclick=load;$('#reconcile').onclick=()=>reconcileAll({manual:true});$('#csv').onclick=csv;
setInterval(()=>{if(!document.hidden)reconcileAll()},60*60*1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastStatusCheck>60*60*1000)reconcileAll()});
load();
