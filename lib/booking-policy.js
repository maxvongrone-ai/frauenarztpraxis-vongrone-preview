'use strict';

const SPECIAL_OPEN_DATE='2026-09-28';
const BOOKING_POLICY=Object.freeze({
  privateDailyMax:10,
  privateNewShare:2/3,
  selfPayShare:2/3,
  gkvBaseNumerator:2,
  gkvBaseDenominator:5,
  dynamicGkvRelease:[
    {maxLeadDays:7,protectedReserve:15,releaseCap:20},
    {maxLeadDays:14,protectedReserve:20,releaseCap:12},
    {maxLeadDays:28,protectedReserve:25,releaseCap:6}
  ]
});
const DOCTOR_GKV_BUCKET=Object.freeze({moxter:2,vongrone:3});

function minutesOf(t){const m=String(t||'').match(/^(\d{1,2})\.(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):9999}
function localISO(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function addDays(date,days){const d=new Date(date.getFullYear(),date.getMonth(),date.getDate());d.setDate(d.getDate()+days);return d}
function quarterEnd(d){const m=Math.ceil((d.getMonth()+1)/3)*3;return new Date(d.getFullYear(),m,0)}
function daysBetween(a,b){const A=new Date(a.getFullYear(),a.getMonth(),a.getDate()),B=new Date(b.getFullYear(),b.getMonth(),b.getDate());return Math.round((B-A)/86400000)}
function berlinNowParts(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const o={};for(const p of parts)if(p.type!=='literal')o[p.type]=p.value;
  return {date:`${o.year}-${o.month}-${o.day}`,time:`${o.hour}.${o.minute}`,dateObj:new Date(Number(o.year),Number(o.month)-1,Number(o.day),12,0,0)};
}
function isIgelMode(mode){return String(mode||'').startsWith('igel')}
function currentRule(context,now=new Date()){
  const today=berlinNowParts(now).dateObj,route=String(context?.route||''),topic=String(context?.topicMode||''),patientType=String(context?.patientType||'');
  if(isIgelMode(topic)||topic==='pregnancy'||topic==='acute'||route==='PKV'||route==='SELF'||route==='ACUTE')return {earliest:localISO(today),waitDays:0};
  if(route==='GKV'&&patientType==='new'){const e=addDays(today,91);return {earliest:localISO(e),waitDays:91}}
  if(route==='GKV'&&patientType==='existing'){
    const qe=quarterEnd(today),rem=Math.max(0,daysBetween(today,qe));let wait;if(rem>14)wait=14;else if(rem>7)wait=7;else wait=rem;
    const e=addDays(today,wait);return {earliest:localISO(e),waitDays:wait};
  }
  return {earliest:localISO(today),waitDays:0};
}
function slotWeekday(slot){return new Date(slot.date+'T12:00:00').getDay()}
function inStartWindow(mins,startHour,startMinute,lastHour,lastMinute){return mins>=startHour*60+startMinute&&mins<=lastHour*60+lastMinute}
function isPrivateOnlyWindow(slot){
  const wd=slotWeekday(slot),mins=minutesOf(slot.time);
  if(wd===3)return inStartWindow(mins,14,30,15,30)||inStartWindow(mins,16,0,16,30);
  if(wd===4)return inStartWindow(mins,8,30,9,30)||inStartWindow(mins,10,0,10,30)||inStartWindow(mins,14,30,15,30)||inStartWindow(mins,16,0,16,30);
  return false;
}
function maySeeSlot(slot,context){
  if(isPrivateOnlyWindow(slot))return context.route==='PKV'||context.route==='SELF';
  if(context.topicMode==='acute'||context.topicMode==='pregnancy')return true;
  return true;
}
function gkvStableBucket(slot){
  const d=new Date(slot.date+'T12:00:00'),day=Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000),quarter=Math.floor(minutesOf(slot.time)/15);
  const doctor=DOCTOR_GKV_BUCKET[String(slot.doctorId)];
  if(!Number.isInteger(doctor))return 4;
  return ((day+quarter+doctor)%BOOKING_POLICY.gkvBaseDenominator+BOOKING_POLICY.gkvBaseDenominator)%BOOKING_POLICY.gkvBaseDenominator;
}
function isBaseGkvSlot(slot){return gkvStableBucket(slot)<BOOKING_POLICY.gkvBaseNumerator}
function weekStartISO(iso){const d=new Date(iso+'T12:00:00'),back=(d.getDay()+6)%7;d.setDate(d.getDate()-back);return localISO(d)}
function leadDaysToWeek(iso,now=new Date()){const today=berlinNowParts(now).dateObj,monday=new Date(weekStartISO(iso)+'T12:00:00');return Math.max(0,daysBetween(today,monday))}
function dynamicReleaseRule(leadDays){return BOOKING_POLICY.dynamicGkvRelease.find(r=>leadDays<=r.maxLeadDays)||null}
function add15DotTime(t){const m=String(t||'').match(/^(\d{1,2})\.(\d{2})$/);if(!m)return null;const mins=Number(m[1])*60+Number(m[2])+15;if(mins>=1440)return null;return `${String(Math.floor(mins/60)).padStart(2,'0')}.${String(mins%60).padStart(2,'0')}`}
function hasFreeFollowingSlot(slot,items){const next=add15DotTime(slot?.time);return !!next&&(items||[]).some(x=>x.date===slot.date&&String(x.doctorId)===String(slot.doctorId)&&String(x.serviceId)===String(slot.serviceId)&&Number(x.duration)===15&&x.time===next)}
function isSpecialOpenWindow(slot){const mins=minutesOf(slot?.time);return slot?.date===SPECIAL_OPEN_DATE&&mins>=12*60&&mins<13*60}
function specialOpenAudienceAllowed(context){if(context.topicMode==='acute'||context.topicMode==='pregnancy')return false;if(!['PKV','GKV','SELF'].includes(context.route))return false;if(context.route==='GKV'&&context.patientType==='new')return false;return true}
function popularityScores(allSlots){
  const daysByWeekday=new Map(),freeDaysByWeekdayTime=new Map();
  for(const x of allSlots){const wd=slotWeekday(x);if(!daysByWeekday.has(wd))daysByWeekday.set(wd,new Set());daysByWeekday.get(wd).add(x.date);const key=wd+'|'+x.time;if(!freeDaysByWeekdayTime.has(key))freeDaysByWeekdayTime.set(key,new Set());freeDaysByWeekdayTime.get(key).add(x.date)}
  const scores=new Map();for(const x of allSlots){const wd=slotWeekday(x),key=wd+'|'+x.time,comparable=Math.max(1,daysByWeekday.get(wd)?.size||1),free=Math.max(1,freeDaysByWeekdayTime.get(key)?.size||1);scores.set(key,1-(free/comparable))}return scores;
}
function chooseMax10PerDay(daySlots,allSlots){
  if(daySlots.length<=10)return daySlots.slice().sort((a,b)=>minutesOf(a.time)-minutesOf(b.time));
  const scores=popularityScores(allSlots),byPopularity=daySlots.slice().sort((a,b)=>{const sa=scores.get(slotWeekday(a)+'|'+a.time)||0,sb=scores.get(slotWeekday(b)+'|'+b.time)||0;return (sb-sa)||(minutesOf(a.time)-minutesOf(b.time))}),chosen=byPopularity.slice(0,4),chosenKeys=new Set(chosen.map(x=>x.time)),remaining=daySlots.filter(x=>!chosenKeys.has(x.time)).sort((a,b)=>minutesOf(a.time)-minutesOf(b.time)),need=10-chosen.length;
  if(need>0&&remaining.length){if(remaining.length<=need)chosen.push(...remaining);else{const used=new Set();for(let i=0;i<need;i++){const idx=Math.round(i*(remaining.length-1)/Math.max(1,need-1));if(!used.has(idx)){used.add(idx);chosen.push(remaining[idx])}}for(let i=0;chosen.length<10&&i<remaining.length;i++)if(!used.has(i)){used.add(i);chosen.push(remaining[i])}}}
  return chosen.slice(0,10).sort((a,b)=>minutesOf(a.time)-minutesOf(b.time));
}
function privateDailyPool(slots){const byDay=new Map(),out=[];for(const x of slots){if(!byDay.has(x.date))byDay.set(x.date,[]);byDay.get(x.date).push(x)}for(const daySlots of byDay.values())out.push(...chooseMax10PerDay(daySlots,slots).slice(0,BOOKING_POLICY.privateDailyMax));return out.sort((a,b)=>a.date.localeCompare(b.date)||minutesOf(a.time)-minutesOf(b.time))}
function keepPopularFractionPerDay(slots,share,referenceSlots=slots){const scores=popularityScores(referenceSlots),byDay=new Map(),out=[];for(const x of slots){if(!byDay.has(x.date))byDay.set(x.date,[]);byDay.get(x.date).push(x)}for(const daySlots of byDay.values()){const keep=Math.max(0,Math.min(daySlots.length,Math.round(daySlots.length*share))),ranked=daySlots.slice().sort((a,b)=>{const sa=scores.get(slotWeekday(a)+'|'+a.time)||0,sb=scores.get(slotWeekday(b)+'|'+b.time)||0;return (sb-sa)||(minutesOf(a.time)-minutesOf(b.time))});out.push(...ranked.slice(0,keep))}return out.sort((a,b)=>a.date.localeCompare(b.date)||minutesOf(a.time)-minutesOf(b.time))}
function selectGkvContingent(allSlots,now=new Date()){
  const regular=allSlots.filter(x=>!isPrivateOnlyWindow(x)),privateOnly=allSlots.filter(isPrivateOnlyWindow),scores=popularityScores(regular),byWeek=new Map(),privateOnlyByWeek=new Map(),out=[];
  for(const x of regular){const wk=weekStartISO(x.date);if(!byWeek.has(wk))byWeek.set(wk,[]);byWeek.get(wk).push(x)}for(const x of privateOnly){const wk=weekStartISO(x.date);if(!privateOnlyByWeek.has(wk))privateOnlyByWeek.set(wk,[]);privateOnlyByWeek.get(wk).push(x)}
  for(const [wk,weekSlots] of byWeek){const baseFree=weekSlots.filter(isBaseGkvSlot);if(baseFree.length){out.push(...baseFree);continue}const rule=dynamicReleaseRule(leadDaysToWeek(wk,now));if(!rule)continue;const protectedRegular=weekSlots.filter(x=>!isBaseGkvSlot(x)),protectedPrivateOnly=privateOnlyByWeek.get(wk)||[],protectedFreeTotal=protectedRegular.length+protectedPrivateOnly.length,surplus=Math.max(0,protectedFreeTotal-rule.protectedReserve),releaseCount=Math.min(rule.releaseCap,surplus,protectedRegular.length);if(releaseCount<=0)continue;const release=protectedRegular.slice().sort((a,b)=>{const sa=scores.get(slotWeekday(a)+'|'+a.time)||0,sb=scores.get(slotWeekday(b)+'|'+b.time)||0;return (sa-sb)||(minutesOf(a.time)-minutesOf(b.time))}).slice(0,releaseCount);out.push(...release)}
  return out.sort((a,b)=>a.date.localeCompare(b.date)||minutesOf(a.time)-minutesOf(b.time));
}
function audienceVisibleSlots(allSlots,technicalSlots,context,now=new Date()){
  const special=specialOpenAudienceAllowed(context)?allSlots.filter(x=>isSpecialOpenWindow(x)&&hasFreeFollowingSlot(x,technicalSlots)):[];
  let normal;if(context.topicMode==='acute'||context.topicMode==='pregnancy')normal=allSlots.filter(x=>maySeeSlot(x,context));else if(context.route==='PKV'){const pool=privateDailyPool(allSlots.filter(x=>maySeeSlot(x,context)));normal=context.patientType==='new'?keepPopularFractionPerDay(pool,BOOKING_POLICY.privateNewShare,allSlots):pool}else if(context.route==='SELF'){const pool=privateDailyPool(allSlots.filter(x=>maySeeSlot(x,context)));normal=keepPopularFractionPerDay(pool,BOOKING_POLICY.selfPayShare,allSlots)}else if(context.route==='GKV')normal=context.patientType==='new'?[]:selectGkvContingent(allSlots,now);else normal=[];
  if(!special.length)return normal;const out=normal.slice(),seen=new Set(out.map(x=>`${x.date}|${x.time}|${x.doctorId}|${x.serviceId}`));for(const x of special){const k=`${x.date}|${x.time}|${x.doctorId}|${x.serviceId}`;if(!seen.has(k)){seen.add(k);out.push(x)}}return out.sort((a,b)=>a.date.localeCompare(b.date)||minutesOf(a.time)-minutesOf(b.time));
}
function isFutureOrNow(slot,now=new Date()){const b=berlinNowParts(now);if(slot.date>b.date)return true;if(slot.date<b.date)return false;return minutesOf(slot.time)>=minutesOf(b.time)}
function visibleForContext(candidateSlots,technicalSlots,context,now=new Date()){
  const rule=currentRule(context,now),allBookable=[],seen=new Set();
  for(const x of candidateSlots){if(!isFutureOrNow(x,now))continue;if(x.date<rule.earliest&&x.date!==SPECIAL_OPEN_DATE)continue;if(x.date<rule.earliest&&!isSpecialOpenWindow(x)&&!(x.date===SPECIAL_OPEN_DATE&&minutesOf(x.time)===13*60))continue;const key=`${x.date}|${x.time}`;if(seen.has(key))continue;seen.add(key);allBookable.push(x)}
  return audienceVisibleSlots(allBookable,technicalSlots,context,now).filter(x=>x.date>=rule.earliest||(isSpecialOpenWindow(x)&&specialOpenAudienceAllowed(context)));
}

module.exports={SPECIAL_OPEN_DATE,BOOKING_POLICY,DOCTOR_GKV_BUCKET,minutesOf,currentRule,isPrivateOnlyWindow,gkvStableBucket,audienceVisibleSlots,visibleForContext,add15DotTime,specialOpenAudienceAllowed,isSpecialOpenWindow};