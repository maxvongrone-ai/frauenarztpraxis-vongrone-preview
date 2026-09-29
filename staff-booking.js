'use strict';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DOCTORS={moxter:'Dr. med. Christina Moxter',vongrone:'Dr. med. Friederike von Grone'};
const GKV_BUCKET={moxter:2,vongrone:3};
const POLICY={privateDailyMax:10,privateNewShare:2/3,selfPayShare:2/3,gkvNum:2,gkvDen:5};
const CHAIN_WEEKS=[7,10,14,18,22,26,30,32,34,36,38,40];
let bundle=null,sessionCache=null,singleSlots=[],chainRowsState=[];

function status(el,msg,kind=''){el.className='status'+(kind?' '+kind:'');el.textContent=msg}
function pad(n){return String(n).padStart(2,'0')}
function deDate(iso){return String(iso||'').split('-').reverse().join('.')}
function isoFromUTC(d){return d.toISOString().slice(0,10)}
function addDaysISO(iso,days){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return isoFromUTC(d)}
function minutesOf(t){const m=String(t||'').match(/^(\d{1,2})[.:](\d{2})$/);return m?Number(m[1])*60+Number(m[2]):9999}
function add15(t){const n=minutesOf(t)+15;if(!Number.isFinite(n)||n>=1440)return null;return pad(Math.floor(n/60))+'.'+pad(n%60)}
function berlinToday(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const o={};for(const p of parts)if(p.type!=='literal')o[p.type]=p.value;return o.year+'-'+o.month+'-'+o.day;
}
function hamburgEasterSundayUTC(year){
 const a=year%19,b=Math.floor(year/100),cc=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
 const h=(19*a+b-d-g+15)%30,i=Math.floor(cc/4),k=cc%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
 const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;return new Date(Date.UTC(year,month-1,day));
}
function isHoliday(iso){
 const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return false;
 const year=Number(m[1]),md=m[2]+'-'+m[3];
 if(new Set(['01-01','05-01','10-03','10-31','12-25','12-26']).has(md))return true;
 const easter=hamburgEasterSundayUTC(year);
 return [-2,1,39,50].some(offset=>{const d=new Date(easter);d.setUTCDate(d.getUTCDate()+offset);return isoFromUTC(d)===iso});
}
function weekday(iso){return new Date(iso+'T12:00:00').getDay()}
function privateOnly(slot){
 const wd=weekday(slot.date),m=minutesOf(slot.time);
 if(wd===3)return m>=14*60+30&&m<17*60;
 if(wd===4){
   if(isHoliday(slot.date))return false;
   const pm=slot.date>='2026-11-05'&&m>=14*60+30&&m<17*60;
   const am=slot.date>='2026-11-12'&&m>=8*60+30&&m<11*60;
   return am||pm;
 }
 return false;
}
function privateStart(slot){
 const wd=weekday(slot.date),m=minutesOf(slot.time);
 if(wd===3)return m>=14*60+30&&m<=16*60+30;
 if(wd===4){
   if(isHoliday(slot.date))return false;
   const pm=slot.date>='2026-11-05'&&m>=14*60+30&&m<=16*60+30;
   const am=slot.date>='2026-11-12'&&m>=8*60+30&&m<=10*60+30;
   return am||pm;
 }
 return false;
}
function routeAllows(slot,route){
 if(isHoliday(slot.date))return false;
 if(privateOnly(slot))return (route==='PKV'||route==='SELF')&&privateStart(slot);
 return true;
}
function is45(slot){return minutesOf(slot.time)%60===45}
function gkvBucket(slot){
 const d=new Date(slot.date+'T12:00:00'),day=Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000),quarter=Math.floor(minutesOf(slot.time)/15),doctor=GKV_BUCKET[String(slot.doctorKey)];
 if(!Number.isInteger(doctor))return 4;
 return ((day+quarter+doctor)%POLICY.gkvDen+POLICY.gkvDen)%POLICY.gkvDen;
}
function serviceGroup(key){return (bundle?.groups||[]).find(g=>String(g.serviceKey)===String(key))||null}
function flattenGroup(group){
 const out=[];
 for(const row of (group?.availability?.appointmentTimes||[])){
   const date=String(row?.dateTimeStart||'').slice(0,10),doctorKey=String(row?.doctorKey||'');
   for(const tv of (row?.times||[])){
     const time=typeof tv==='string'?tv:String(tv?.time||'');
     const direct=typeof tv==='object'&&tv?tv.direct:null;
     if(!/^\d{1,2}\.\d{2}$/.test(time)||!direct)continue;
     out.push({date,time,doctorKey,serviceKey:String(group.serviceKey),serviceName:String(group.serviceName||group.serviceKey),duration:Number(row.duration||15),calendarWeek:Number(row.calendarWeek||0),direct,trackingNonce:tv.trackingNonce,trackingExp:tv.trackingExp,trackingProof:tv.trackingProof});
   }
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date)||minutesOf(a.time)-minutesOf(b.time)||a.doctorKey.localeCompare(b.doctorKey));
}
function sameTechnical(a,b){return a&&b&&a.date===b.date&&a.doctorKey===b.doctorKey&&a.serviceKey===b.serviceKey}
function following(slot,technical){
 const t=add15(slot.time);return technical.find(x=>sameTechnical(x,slot)&&x.time===t)||null;
}
function popularityScores(slots){
 const days=new Map(),free=new Map();
 for(const x of slots){const wd=weekday(x.date);if(!days.has(wd))days.set(wd,new Set());days.get(wd).add(x.date);const k=wd+'|'+x.time;if(!free.has(k))free.set(k,new Set());free.get(k).add(x.date)}
 const out=new Map();for(const x of slots){const wd=weekday(x.date),k=wd+'|'+x.time;out.set(k,1-(Math.max(1,free.get(k)?.size||1)/Math.max(1,days.get(wd)?.size||1)))}return out;
}
function chooseMax10(daySlots,all){
 if(daySlots.length<=10)return daySlots.slice();
 const scores=popularityScores(all),ranked=daySlots.slice().sort((a,b)=>(scores.get(weekday(b.date)+'|'+b.time)||0)-(scores.get(weekday(a.date)+'|'+a.time)||0)||minutesOf(a.time)-minutesOf(b.time));
 const chosen=ranked.slice(0,4),keys=new Set(chosen.map(x=>x.date+'|'+x.time+'|'+x.doctorKey)),remaining=daySlots.filter(x=>!keys.has(x.date+'|'+x.time+'|'+x.doctorKey)).sort((a,b)=>minutesOf(a.time)-minutesOf(b.time));
 const need=10-chosen.length;
 for(let i=0;i<need&&remaining.length;i++){const idx=Math.round(i*(remaining.length-1)/Math.max(1,need-1));if(remaining[idx]&&!chosen.includes(remaining[idx]))chosen.push(remaining[idx])}
 for(const x of remaining){if(chosen.length>=10)break;if(!chosen.includes(x))chosen.push(x)}
 return chosen.slice(0,10);
}
function privatePool(slots){
 const byDay=new Map(),out=[];for(const x of slots){if(!byDay.has(x.date))byDay.set(x.date,[]);byDay.get(x.date).push(x)}
 for(const xs of byDay.values())out.push(...chooseMax10(xs,slots));return out;
}
function fractionPerDay(slots,share,reference){
 const scores=popularityScores(reference),byDay=new Map(),out=[];
 for(const x of slots){if(!byDay.has(x.date))byDay.set(x.date,[]);byDay.get(x.date).push(x)}
 for(const xs of byDay.values()){const n=Math.max(0,Math.min(xs.length,Math.round(xs.length*share)));out.push(...xs.slice().sort((a,b)=>(scores.get(weekday(b.date)+'|'+b.time)||0)-(scores.get(weekday(a.date)+'|'+a.time)||0)||minutesOf(a.time)-minutesOf(b.time)).slice(0,n))}
 return out;
}
function need30Single(route,patient,topic){
 if(topic==='pregnancy')return route==='PKV'&&patient==='new';
 if(topic==='spirale')return false;
 if(topic==='menopause')return true;
 return route==='SELF'||(route==='PKV'&&patient==='new');
}
function filterSingle(all,{route,patient,topic,doctor}){
 let xs=all.filter(x=>x.date>=berlinToday()&&routeAllows(x,route)&&(doctor==='0'||x.doctorKey===doctor));
 if(topic==='pregnancy'){
   // Schwangerschaft ist ein eigener Freigabekanal: keine GKV-2/5-Quote und kein PKV-Tageslimit.
 }else if(topic==='spirale'){
   // Spirale Einlage: nur der späteste freie Randtermin je Tag.
   const byDay=new Map();
   for(const x of xs){
     const prev=byDay.get(x.date);
     if(!prev||minutesOf(x.time)>minutesOf(prev.time))byDay.set(x.date,x);
   }
   xs=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)||minutesOf(a.time)-minutesOf(b.time));
 }else if(topic==='menopause'){
   // Wechseljahressprechstunde: nur Dr. von Grone und nur Privatsprechstunden.
   xs=xs.filter(x=>x.doctorKey==='vongrone'&&privateStart(x));
 }else if(route==='PKV'){
   const pool=privatePool(xs);xs=patient==='new'?fractionPerDay(pool,POLICY.privateNewShare,all):pool;
 }else if(route==='SELF'){
   const pool=privatePool(xs);xs=fractionPerDay(pool,POLICY.selfPayShare,all);
 }else if(route==='GKV'){
   if(patient==='new')xs=[];else xs=xs.filter(x=>gkvBucket(x)<POLICY.gkvNum);
 }
 const n30=need30Single(route,patient,topic);
 return xs.filter(x=>{
   if(topic!=='spirale'&&is45(x))return false;
   if(!n30)return true;
   const next=following(x,all);return !!next&&!isHoliday(next.date);
 }).sort((a,b)=>a.date.localeCompare(b.date)||minutesOf(a.time)-minutesOf(b.time));
}
function optionText(x,duration){return deDate(x.date)+' · '+x.time.replace('.',':')+' · '+DOCTORS[x.doctorKey]+' · '+duration+' Min.'}
function chainOptionText(x){return deDate(x.date)+' · '+x.time.replace('.',':')+' Uhr'}

async function authState(){
 const r=await fetch('/api/staff-auth',{cache:'no-store',credentials:'same-origin'}),j=await r.json().catch(()=>null);
 return Boolean(r.ok&&j?.authenticated);
}
async function login(){
 const st=$('#loginStatus'),password=$('#password').value;status(st,'Anmeldung wird geprüft …');
 const r=await fetch('/api/staff-auth?action=login',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
 const j=await r.json().catch(()=>null);
 if(!r.ok||!j?.authenticated){status(st,j?.error||'Anmeldung fehlgeschlagen.','bad');return}
 $('#password').value='';await showApp();
}
async function logout(){
 await fetch('/api/staff-auth?action=logout',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
 sessionCache=null;bundle=null;$('#app').classList.add('hidden');$('#loginPanel').classList.remove('hidden');status($('#loginStatus'),'Abgemeldet.','ok');
}
async function showApp(){
 $('#loginPanel').classList.add('hidden');$('#app').classList.remove('hidden');
 await loadBundle();
}
async function loadBundle(){
 if(bundle)return bundle;
 const r=await fetch('/api/medidate?action=liveBundle',{cache:'no-store',credentials:'same-origin'}),j=await r.json().catch(()=>null);
 if(r.status===401){await logout();throw new Error('MA-Anmeldung abgelaufen.')}
 if(!r.ok||!j?.ok)throw new Error(j?.error||'Terminverfügbarkeit konnte nicht geladen werden.');
 bundle=j;return bundle;
}
async function staffSession(force=false){
 if(!force&&sessionCache&&Date.now()-Number(sessionCache.issuedAt||0)<10*60*1000)return sessionCache;
 const u=new URL('/api/staff-session',location.origin);if(force)u.searchParams.set('force','1');
 const r=await fetch(u,{cache:'no-store',credentials:'same-origin'}),j=await r.json().catch(()=>null);
 if(r.status===401){await logout();throw new Error('MA-Anmeldung abgelaufen.')}
 if(!r.ok||!j?.token||!j?.apiBase)throw new Error(j?.error||'mediDate-Sitzung nicht verfügbar.');
 sessionCache=j;return j;
}
async function medidate(path,{method='GET',query=null,body=null}={},retry=true){
 const s=await staffSession(false),u=new URL(String(path).replace(/^\//,''),s.apiBase);
 for(const [k,v] of Object.entries(query||{}))u.searchParams.set(k,String(v));
 const r=await fetch(u,{method,mode:'cors',credentials:'omit',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+s.token},body:body==null?undefined:JSON.stringify(body)});
 if((r.status===401||r.status===403)&&retry){sessionCache=null;await staffSession(true);return medidate(path,{method,query,body},false)}
 const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
 if(!r.ok){const e=new Error('mediDate HTTP '+r.status);e.status=r.status;throw e}return data;
}
function patient(prefix){
 const p={firstName:$(prefix+'First').value.trim(),lastName:$(prefix+'Last').value.trim(),birthDate:$(prefix+'Birth').value,email:$(prefix+'Email').value.trim()};
 if(!p.firstName||!p.lastName||!/^\d{4}-\d{2}-\d{2}$/.test(p.birthDate)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))throw new Error('Bitte Vorname, Nachname, Geburtsdatum und E-Mail vollständig prüfen.');
 return p;
}
async function liveRowFor(slot){
 const rows=await medidate('appointments/appointmenttimes',{query:{clientid:slot.direct.clientId,locationId:slot.direct.locationId,serviceId:slot.direct.serviceId,doctorId:slot.direct.doctorId}});
 let first=null,second=null;
 for(const r of (rows?.appointmentTimes||[])){
   if(String(r?.dateTimeStart||'').slice(0,10)!==slot.date||Number(r?.doctorId)!==Number(slot.direct.doctorId)||Number(r?.duration)!==15)continue;
   const times=(r?.times||[]).map(String);
   if(times.includes(slot.time))first=r;
   if(times.includes(add15(slot.time)))second=r;
 }
 return {first,second};
}
function payload(slot,row,p,comment,email){
 const now=new Date().toISOString();
 return {id:0,appointmentCode:'',mediSoftId:0,clientId:Number(slot.direct.clientId),locationId:Number(slot.direct.locationId),doctorId:Number(slot.direct.doctorId),serviceId:Number(slot.direct.serviceId),listReferenzId:Number(row?.listReferenzId||slot.direct.listReferenzId||0),timeSlotId:0,type:'Online',state:1,dueDate:slot.date+'T'+slot.time.replace('.',':')+':00',duration:15,dayOfYear:0,calenderWeek:Number(row?.calendarWeek||row?.calenderWeek||slot.direct.calendarWeek||0),birthDate:p.birthDate,firstName:p.firstName,lastName:p.lastName,ticketid:'',sex:'Frau',mobilePhone:'',eMailAddress:email?p.email:'',comment,createdOn:now,changedOn:now};
}
async function bookAppointment(slot,duration,p,comment){
 const live=await liveRowFor(slot);if(!live.first)throw new Error(deDate(slot.date)+' '+slot.time.replace('.',':')+' ist inzwischen nicht mehr frei.');
 const blocks=duration===30?2:1;if(blocks===2&&!live.second)throw new Error('Der notwendige Folgeslot für '+deDate(slot.date)+' '+slot.time.replace('.',':')+' ist nicht mehr frei.');
 const firstComment=comment+(blocks===2?' [Block 1/2]':'');
 await medidate('appointments',{method:'POST',body:payload(slot,live.first,p,firstComment,true)});
 if(blocks===2){
   const second={...slot,time:add15(slot.time)};
   try{await medidate('appointments',{method:'POST',body:payload(second,live.second,p,comment+' [Block 2/2]',false)})}
   catch(e){const err=new Error('Erster 15-Minuten-Block wurde gebucht, der zweite konnte nicht sicher gebucht werden. Bitte sofort in mediDate prüfen und nicht erneut automatisch buchen.');err.partial=true;throw err}
 }
 return true;
}

function fillSingleServices(){
 const route=$('#singleRoute').value,sel=$('#singleService'),current=sel.value;
 const list=route==='SELF'
   ?[['MENOPAUSE','Wechseljahressprechstunde','menopause'],['breast','Brustultraschall','regular'],['SPIRALE','Spirale Einlage · 216,69 €','spirale']]
   :route==='GKV'
     ?[['vorsorge','Vorsorge','regular'],['followup','Tumornachsorge','regular'],['vorsorge','Schwangerschaft','pregnancy']]
     :[['vorsorge','Vorsorge','regular'],['contraception','Verhütung – Kontrolltermin','regular'],['followup','Tumornachsorge','regular'],['breast','Brustultraschall','regular'],['vorsorge','Schwangerschaft','pregnancy']];
 sel.innerHTML=list.map((x,i)=>'<option value="'+x[0]+'|'+x[2]+'"'+((x[0]+'|'+x[2])===current?' selected':'')+'>'+esc(x[1])+'</option>').join('');
}
function selectedSingleMeta(){const [key,topic]=$('#singleService').value.split('|');return {key,topic}}
async function dynamicServiceSlots({servicePattern,serviceLabel,serviceKey,doctorPattern=null}){
 const s=await staffSession(false);
 const services=await medidate('clients/'+s.clientId+'/services',{query:{location:s.locationId,KV:'all'}});
 const matches=(Array.isArray(services)?services:[]).filter(x=>servicePattern.test(String(x?.name||''))&&String(x?.state||'active').toLowerCase()!=='inactive');
 if(!matches.length)return [];

 const out=[];
 for(const svc of matches){
   const serviceId=Number(svc.id);
   if(!serviceId)continue;
   const doctors=await medidate('clients/'+s.clientId+'/doctors',{query:{location:s.locationId,service:serviceId}});
   const allowed=(Array.isArray(doctors)?doctors:[]).filter(x=>{
     if(String(x?.state||'active').toLowerCase()==='inactive')return false;
     if(!doctorPattern)return true;
     return doctorPattern.test(String(x?.displayName||x?.fullName||[x?.firstName,x?.lastName].filter(Boolean).join(' ')));
   });

   for(const doc of allowed){
     const doctorId=Number(doc.id);
     const doctorKey=Number(doc?.mediSoftId)===1?'moxter':Number(doc?.mediSoftId)===2?'vongrone':(/moxter/i.test(String(doc?.displayName||doc?.fullName||''))?'moxter':(/von grone/i.test(String(doc?.displayName||doc?.fullName||''))?'vongrone':''));
     if(!doctorId||!doctorKey)continue;
     const rows=await medidate('appointments/appointmenttimes',{query:{clientid:s.clientId,locationId:s.locationId,serviceId,doctorId}});
     for(const row of (rows?.appointmentTimes||[])){
       const date=String(row?.dateTimeStart||'').slice(0,10);
       if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number(row?.duration)!==15)continue;
       for(const raw of (row?.times||[])){
         const time=String(raw||'');
         if(!/^\d{1,2}\.\d{2}$/.test(time))continue;
         out.push({
           date,time,doctorKey,serviceKey:serviceKey+':'+serviceId,serviceName:serviceLabel,duration:15,
           calendarWeek:Number(row?.calendarWeek||row?.calenderWeek||0),
           direct:{
             clientId:s.clientId,locationId:s.locationId,serviceId,doctorId,
             listReferenzId:Number(row?.listReferenzId||0),
             calendarWeek:Number(row?.calendarWeek||row?.calenderWeek||0),duration:15
           }
         });
       }
     }
   }
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date)||minutesOf(a.time)-minutesOf(b.time)||a.doctorKey.localeCompare(b.doctorKey));
}

async function menopauseSlots(){
 const out=[];
 for(const g of (bundle?.groups||[])){
   for(const x of flattenGroup(g)){
     if(x.doctorKey!=='vongrone')continue;
     out.push({...x,serviceName:'Wechseljahressprechstunde'});
   }
 }
 const seen=new Set();
 return out.filter(x=>{
   const key=x.date+'|'+x.time+'|'+x.doctorKey+'|'+x.serviceKey;
   if(seen.has(key))return false;
   seen.add(key);return true;
 }).sort((a,b)=>a.date.localeCompare(b.date)||minutesOf(a.time)-minutesOf(b.time));
}
async function spiraleSlots(){
 return dynamicServiceSlots({
   servicePattern:/spiral|intrauterin|iud/i,
   serviceLabel:'Spirale Einlage',
   serviceKey:'SPIRALE'
 });
}

async function loadSingle(){
 const st=$('#singleStatus');status(st,'Freie Termine werden geladen …');
 try{
   await loadBundle();const route=$('#singleRoute').value,pat=$('#singlePatient').value,doctor=$('#singleDoctor').value,{key,topic}=selectedSingleMeta(),g=serviceGroup(key);
   const all=topic==='menopause'?await menopauseSlots():topic==='spirale'?await spiraleSlots():(g?flattenGroup(g):null);
   if(!all)throw new Error('Diese Terminart ist in der aktuellen mediDate-Konfiguration nicht verfügbar.');
   const xs=filterSingle(all,{route,patient:pat,topic,doctor}),n30=need30Single(route,pat,topic);
   singleSlots=xs;$('#singleSlot').innerHTML=xs.length?xs.map((x,i)=>'<option value="'+i+'">'+esc(optionText(x,n30?30:15))+'</option>').join(''):'<option value="">Kein geeigneter freier Termin</option>';
   const note=$('#singleNote');
   if(topic==='pregnancy'&&route==='PKV'&&pat==='new'){
     note.classList.remove('hidden');note.textContent='PKV-Neupatientin + Schwangerschaft: der erste Termin wird 30 Minuten reserviert.';
   }else if(topic==='spirale'){
     note.classList.remove('hidden');note.textContent='Spirale Einlage: Es wird pro Tag ausschließlich der späteste freie Randtermin angezeigt. Optimaler Zyklustag 2–7.';
   }else note.classList.add('hidden');
   if(topic==='spirale'&&!all.length){
     status(st,'Spirale Einlage ist in mediDate derzeit nicht als buchbarer Termin freigeschaltet.','');
   }else{
     status(st,xs.length+' geeignete freie Termine gefunden.',xs.length?'ok':'');
   }
 }catch(e){status(st,e.message,'bad')}
}
async function bookSingle(){
 const st=$('#singleStatus'),idx=Number($('#singleSlot').value);if(!Number.isInteger(idx)||!singleSlots[idx]){status(st,'Bitte zunächst einen freien Termin auswählen.','bad');return}
 try{
   const p=patient('#single'),route=$('#singleRoute').value,pat=$('#singlePatient').value,{topic}=selectedSingleMeta(),duration=need30Single(route,pat,topic)?30:15,slot=singleSlots[idx];
   $('#bookSingle').disabled=true;status(st,'Termin wird direkt in mediDate gebucht …');
   await bookAppointment(slot,duration,p,'[MA-Buchung | '+(topic==='pregnancy'?'Schwangerschaft':topic==='spirale'?'Spirale Einlage':slot.serviceName)+(duration===30?' | 30 Min.':'')+']');
   status(st,'Termin erfolgreich gebucht: '+deDate(slot.date)+' · '+slot.time.replace('.',':')+' Uhr'+(duration===30?' · 30 Min.':'')+'.','ok');
   bundle=null;singleSlots=[];
 }catch(e){status(st,e.message,e.partial?'warn':'bad')}finally{$('#bookSingle').disabled=false}
}

function weekRange(conception,ssw){const start=addDaysISO(conception,(ssw-2)*7);return {start,end:addDaysISO(start,6)}}
function chainCandidates(all,{route,doctor,range,duration,morning}){
 const technical=all.filter(x=>x.date>=berlinToday()&&x.date>=range.start&&x.date<=range.end&&(doctor==='0'||x.doctorKey===doctor)&&routeAllows(x,route));
 const eligible=technical.filter(x=>{
   if(morning&&minutesOf(x.time)>=12*60)return false;
   if(duration===30&&!following(x,all))return false;
   return true;
 });
 const regular=eligible.filter(x=>!is45(x));
 const chosen=regular.length?regular:eligible.filter(is45);
 return chosen.sort((a,b)=>a.date.localeCompare(b.date)||minutesOf(a.time)-minutesOf(b.time)||a.doctorKey.localeCompare(b.doctorKey));
}
function updateChainBookButton(){
 const confirm=$('#chainConfirm'),btn=$('#bookChain');
 const openAuto=chainRowsState.some(r=>!r.past&&r.plannedSlot&&!r.booked);
 btn.disabled=!(confirm?.checked&&openAuto);
}
function chainRowStatusHtml(row){
 if(row.past)return '<span class="muted">bereits vergangen</span>';
 if(row.booked)return '<span class="booked">✓ Gebucht</span>';
 if(!row.candidates.length)return '<span class="missing">Manuell zu buchen</span>';
 return '<span class="muted">noch nicht gebucht</span>';
}
async function buildChain(){
 const st=$('#chainStatus');status(st,'Schwangerschaftstermine werden berechnet …');
 try{
   await loadBundle();const conception=$('#conceptionDate').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(conception))throw new Error('Bitte das errechnete Empfängnisdatum eingeben.');
   const route=$('#pregRoute').value,pat=$('#pregPatient').value,doctor=$('#pregDoctor').value,test=$('#firstTrimester').checked,g=serviceGroup('vorsorge');
   if(!g)throw new Error('Vorsorge/Schwangerschaft ist in mediDate nicht verfügbar.');
   const all=flattenGroup(g),today=berlinToday(),ranges=CHAIN_WEEKS.map(ssw=>({ssw,...weekRange(conception,ssw)}));
   const firstFuture=ranges.findIndex(r=>r.end>=today);
   chainRowsState=ranges.map((r,i)=>{
     const special30=r.ssw===22||r.ssw===26||(r.ssw===14&&test)||(route==='PKV'&&pat==='new'&&i===firstFuture);
     const duration=special30?30:15,morning=r.ssw===26;
     const candidates=chainCandidates(all,{route,doctor,range:r,duration,morning});
     const plannedSlot=candidates[0]||null;
     return {...r,duration,morning,candidates,plannedSlot,test:r.ssw===14&&test,past:r.end<today,booked:false};
   });
   const chainBody=$('#chainRows');
   chainBody.replaceChildren();
   chainRowsState.forEach((r,i)=>{
     let detail=r.duration+' Min.';
     if(r.test)detail+=' · 1. Trimestertest 199,11 €';
     if(r.ssw===22)detail+=' · 30-Min.-Termin';
     if(r.ssw===26)detail+=' · morgens · Zuckertest';
     if(route==='PKV'&&pat==='new'&&i===firstFuture)detail+=' · PKV-Ersttermin';

     const tr=document.createElement('tr');
     tr.dataset.chainRow=String(i);

     const sswTd=document.createElement('td');
     const sswStrong=document.createElement('strong');
     sswStrong.textContent=r.ssw+'. SSW';
     sswTd.appendChild(sswStrong);

     const rangeTd=document.createElement('td');
     rangeTd.textContent=deDate(r.start)+' – '+deDate(r.end);

     const detailTd=document.createElement('td');
     const detailLine=document.createElement('div');
     detailLine.textContent=detail;
     detailTd.appendChild(detailLine);
     if(!r.past&&!r.plannedSlot){
       const manual=document.createElement('div');
       manual.className='missing';
       manual.textContent='Termin muss manuell gebucht werden';
       detailTd.appendChild(manual);
     }

     const terminTd=document.createElement('td');
     if(r.past){
       const past=document.createElement('span');
       past.className='muted';
       past.textContent='Bereits vergangen';
       terminTd.appendChild(past);
     }else if(r.plannedSlot){
       const time=document.createElement('span');
       time.dataset.chainTime=String(i);
       time.textContent=chainOptionText(r.plannedSlot);
       terminTd.appendChild(time);
       if(is45(r.plannedSlot)){
         const fallback=document.createElement('div');
         fallback.className='fallback';
         fallback.textContent='Ausnahme :45';
         terminTd.appendChild(fallback);
       }
       const bookingStatus=document.createElement('div');
       bookingStatus.dataset.chainStatus=String(i);
       terminTd.appendChild(bookingStatus);
     }

     tr.append(sswTd,rangeTd,detailTd,terminTd);
     chainBody.appendChild(tr);
   });
   $('#chainTable').classList.remove('hidden');$('#chainBookActions').classList.remove('hidden');
   $('#chainConfirm').checked=false;
   $('#chainConfirm').onchange=updateChainBookButton;
   updateChainBookButton();
   status(st,'Terminkette berechnet. Bitte alle Termine prüfen und anschließend bestätigen.','ok');
 }catch(e){status(st,e.message,'bad')}
}
async function bookChain(){
 const st=$('#chainBookStatus');
 try{
   if(!$('#chainConfirm')?.checked)throw new Error('Bitte die Prüfung der Terminkette mit dem Häkchen bestätigen.');
   const p=patient('#preg'),route=$('#pregRoute').value,pat=$('#pregPatient').value;
   const selected=[];
   for(let idx=0;idx<chainRowsState.length;idx++){
     const row=chainRowsState[idx];
     if(row?.past||row?.booked||!row?.plannedSlot)continue;
     selected.push({idx,row,slot:row.plannedSlot});
   }
   if(!selected.length)throw new Error('Es sind keine noch offenen automatisch geplanten Schwangerschaftstermine vorhanden.');

   $('#bookChain').disabled=true;
   status(st,'Die bestätigten Termine werden jetzt einzeln in mediDate gebucht. Für jeden gebuchten SSW-Termin erhält die Patientin eine eigene E-Mailbestätigung.','');
   const bookedNow=[];
   for(const item of selected){
     const {idx,row:r,slot}=item,flags=['MA Schwangerschaft',r.ssw+'. SSW'];
     if(r.test)flags.push('Selbstzahler: 1. Trimestertest 199,11 EUR');
     if(r.ssw===26)flags.push('Zuckertest');
     if(route==='PKV'&&pat==='new'&&!chainRowsState.some(x=>x.booked))flags.push('PKV-Ersttermin');
     if(r.duration===30)flags.push('30 Min.');
     try{
       // Pro SSW-Termin wird die E-Mail-Adresse im ersten 15-Minuten-Block übermittelt.
       // Bei 30 Minuten bleibt der zweite technische Block ohne E-Mail, damit genau
       // eine Patientenbestätigung pro SSW-Termin ausgelöst wird.
       await bookAppointment(slot,r.duration,p,'['+flags.join(' | ')+']');
       r.booked=true;bookedNow.push(r.ssw);
       const cell=$('[data-chain-status="'+idx+'"]');
       if(cell)cell.innerHTML='<span class="booked">✓ Gebucht</span>';
     }catch(e){
       const cell=$('[data-chain-status="'+idx+'"]');
       if(cell)cell.innerHTML='<span class="missing">Nicht gebucht – bitte prüfen</span>';
       const done=bookedNow.length?' Bereits erfolgreich gebucht: '+bookedNow.join(', ')+'. SSW.':'';
       throw new Error(e.message+done);
     }
   }

   $('#chainConfirm').checked=false;
   updateChainBookButton();
   bundle=null;
   const remaining=chainRowsState.filter(r=>!r.past&&r.plannedSlot&&!r.booked).length;
   const manual=chainRowsState.filter(r=>!r.past&&!r.plannedSlot).length;
   let msg='Erfolgreich gebucht: '+bookedNow.join(', ')+'. SSW.';
   if(remaining)msg+=' '+remaining+' automatisch buchbare Termin'+(remaining===1?' ist':'e sind')+' noch offen.';
   if(manual)msg+=' '+manual+' Termin'+(manual===1?' muss':'e müssen')+' weiterhin manuell gebucht werden.';
   status(st,msg,remaining||manual?'warn':'ok');
 }catch(e){
   if($('#chainConfirm'))$('#chainConfirm').checked=false;
   status(st,e.message,'bad');
   updateChainBookButton();
 }finally{
   updateChainBookButton();
 }
}

function switchTab(name){
 $$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
 $('#singleTab').classList.toggle('hidden',name!=='single');$('#pregnancyTab').classList.toggle('hidden',name!=='pregnancy');
}
function initControls(){
 $('#singleRoute').innerHTML='<option value="PKV">PKV</option><option value="GKV">GKV</option><option value="SELF">Selbstzahler</option>';fillSingleServices();
 $('#singleRoute').onchange=()=>{fillSingleServices();singleSlots=[];$('#singleSlot').innerHTML='<option value="">Bitte zuerst Termine laden</option>'};
 $('#singlePatient').onchange=()=>{singleSlots=[]};$('#singleService').onchange=()=>{singleSlots=[]};
 $$('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
 $('#loadSingle').onclick=loadSingle;$('#bookSingle').onclick=bookSingle;$('#buildChain').onclick=buildChain;$('#bookChain').onclick=bookChain;
 for(const id of ['pregRoute','pregPatient','pregDoctor','conceptionDate','firstTrimester']){
   $('#'+id).onchange=()=>{chainRowsState=[];$('#chainTable').classList.add('hidden');$('#chainBookActions').classList.add('hidden');$('#chainBookStatus').textContent='';};
 }
 $('#login').onclick=login;$('#password').onkeydown=e=>{if(e.key==='Enter')login()};$('#logout').onclick=logout;
}

(async function(){
 initControls();
 try{if(await authState())await showApp()}catch{}
})();
