'use strict';

// Anonyme, nur serverseitig berechnete und fuer jeden Berliner Kalendertag
// eingefrorene Nachfreigabe. Keine Patientendaten und keine Buchungseingriffe.
const FLOOR_START_MONTH='2027-01';
const MIN_GKV_MONTHLY_VISIBLE=10;
// Einmalige Januar-Erweiterung: zehn weitere freie Starts zusätzlich zum bestehenden Kontingent.
const JANUARY_2027_BONUS_COUNT=10;
const JANUARY_2027_FIXED=new Set([
 '2027-01-05|14.30|moxter',
 '2027-01-11|09.30|moxter',
 '2027-01-13|13.15|vongrone',
 '2027-01-18|10.15|moxter',
 '2027-01-20|13.00|vongrone',
 '2027-01-22|12.15|vongrone',
 '2027-01-25|11.00|moxter',
 '2027-01-26|10.30|vongrone',
 '2027-01-26|14.00|moxter',
 '2027-01-29|10.30|vongrone'
]);
const BY_DOCTOR={moxter:2,vongrone:3};
const RELEASE_RULES=[
 {days:7,reserve:15,cap:20},{days:14,reserve:20,cap:12},
 {days:28,reserve:25,cap:6}
];
const minOf=t=>{
 const m=String(t||'').match(/^([01]?\d|2[0-3])\.([0-5]\d)$/);
 return m?Number(m[1])*60+Number(m[2]):NaN;
};
const berlinDay=(time=Date.now())=>
 new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
const key=x=>x.date+'|'+x.time+'|'+x.doctor;
const isoDayNumber=d=>Math.floor(Date.parse(d+'T00:00:00Z')/86400000);
const weekday=d=>new Date(d+'T12:00:00Z').getUTCDay();
function weekStart(d){
 const x=new Date(d+'T12:00:00Z');
 x.setUTCDate(x.getUTCDate()-(weekday(d)+6)%7);
 return x.toISOString().slice(0,10);
}
function isHamburgHoliday(d){
 const md=d.slice(5),year=Number(d.slice(0,4));
 if(['01-01','05-01','10-03','10-31','12-25','12-26'].includes(md))return true;
 const a=year%19,b=Math.floor(year/100),c=year%100;
 const dd=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
 const h=(19*a+b-dd-g+15)%30,i=Math.floor(c/4),k=c%4;
 const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
 const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
 const easter=new Date(Date.UTC(year,month-1,day));
 for(const offset of [-2,1,39,50]){
  const x=new Date(easter);x.setUTCDate(x.getUTCDate()+offset);
  if(x.toISOString().slice(0,10)===d)return true;
 }
 return false;
}
function privateWindow(x){
 const wd=weekday(x.date),t=minOf(x.time);
 if(wd===3)return t>=870&&t<1020;
 if(wd===4){
  if(isHamburgHoliday(x.date))return false;
  return (x.date>='2026-10-29'&&t>=870&&t<1020)||
    (x.date>='2026-11-12'&&t>=510&&t<660);
 }
 return false;
}
const baseGkv=x=>
 ((isoDayNumber(x.date)+Math.floor(minOf(x.time)/15)+BY_DOCTOR[x.doctor])%5+5)%5<2;

function freeStarts(snapshot,today){
 const dedupe=new Set(),out=[];
 for(const group of snapshot?.groups||[]){
  for(const row of group.availability?.appointmentTimes||[]){
   const date=String(row.dateTimeStart||'').slice(0,10),doctor=String(row.doctorKey||'');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<today||
     !Object.hasOwn(BY_DOCTOR,doctor)||isHamburgHoliday(date)||Number(row.duration)!==15)continue;
   for(const t of row.times||[]){
    const time=String(typeof t==='string'?t:t?.time||'');
    const mins=minOf(time);
    if(!Number.isFinite(mins)||mins%60===45)continue;
    const x={date,time,doctor},unique=date+'|'+time; // gleiche Deduplizierung wie im Frontend
    if(dedupe.has(unique))continue;
    dedupe.add(unique);
    x.private=privateWindow(x);
    x.base=!x.private&&baseGkv(x);
    out.push(x);
   }
  }
 }
 return out;
}
function popularityScores(slots){
 const weekdays=new Map(),free=new Map();
 for(const x of slots){
  const wd=weekday(x.date),k=wd+'|'+x.time;
  if(!weekdays.has(wd))weekdays.set(wd,new Set());
  if(!free.has(k))free.set(k,new Set());
  weekdays.get(wd).add(x.date);free.get(k).add(x.date);
 }
 const scores=new Map();
 for(const x of slots){
  const wd=weekday(x.date),k=wd+'|'+x.time;
  scores.set(k,1-(free.get(k).size/Math.max(1,weekdays.get(wd).size)));
 }
 return scores;
}
function baselineForMonth(slots,today,month){
 const scores=popularityScores(slots.filter(x=>!x.private));
 const byWeek=new Map();
 for(const x of slots){
  const week=weekStart(x.date);
  if(!byWeek.has(week))byWeek.set(week,[]);
  byWeek.get(week).push(x);
 }
 const visible=new Set();
 for(const [week,all] of byWeek){
  const reg=all.filter(x=>!x.private),base=reg.filter(x=>x.base);
  for(const x of base)visible.add(key(x));
  for(const x of reg)if(JANUARY_2027_FIXED.has(key(x)))visible.add(key(x));
  if(base.length)continue;
  const lead=Math.max(0,isoDayNumber(week)-isoDayNumber(today));
  const rule=RELEASE_RULES.find(r=>lead<=r.days);
  if(!rule)continue;
  const protectedReg=reg.filter(x=>!x.base);
  const availableProtected=protectedReg.length+all.filter(x=>x.private).length;
  const releaseCount=Math.min(rule.cap,Math.max(0,availableProtected-rule.reserve),protectedReg.length);
  protectedReg.sort((a,b)=>
    ((scores.get(weekday(a.date)+'|'+a.time)||0)-(scores.get(weekday(b.date)+'|'+b.time)||0))||
    minOf(a.time)-minOf(b.time));
  for(const x of protectedReg.slice(0,releaseCount))visible.add(key(x));
 }
 return new Set([...visible].filter(k=>k.startsWith(month+'-')));
}
function computeMonthlyFloor(snapshot,month,today=berlinDay()){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<FLOOR_START_MONTH)
  throw new Error('Ungültiger GKV-Freigabemonat');
 const slots=freeStarts(snapshot,today);
 const regular=slots.filter(x=>!x.private&&x.date.startsWith(month+'-'));
 const base=baselineForMonth(slots,today,month);
 const activeBaseline=new Set(regular.filter(x=>base.has(key(x))).map(key));
 const deficit=regular.length>MIN_GKV_MONTHLY_VISIBLE
   ?Math.max(0,MIN_GKV_MONTHLY_VISIBLE-activeBaseline.size):0;
 const remaining=regular.filter(x=>!activeBaseline.has(key(x)));
 // Ausgewogene Verteilung auf noch unterversorgte Kalenderwochen.
 const byWeek=new Map(),coverage=new Map(),scores=popularityScores(slots.filter(x=>!x.private));
 for(const x of regular)if(activeBaseline.has(key(x)))
  coverage.set(weekStart(x.date),(coverage.get(weekStart(x.date))||0)+1);
 for(const x of remaining){
  const wk=weekStart(x.date);
  if(!byWeek.has(wk))byWeek.set(wk,[]);
  byWeek.get(wk).push(x);
 }
 for(const list of byWeek.values())list.sort((a,b)=>{
  const sa=scores.get(weekday(a.date)+'|'+a.time)||0;
  const sb=scores.get(weekday(b.date)+'|'+b.time)||0;
  return sa-sb||a.date.localeCompare(b.date)||minOf(a.time)-minOf(b.time);
 });
 const selected=[];
 while(selected.length<deficit&&[...byWeek.values()].some(a=>a.length)){
  const week=[...byWeek.keys()].filter(k=>byWeek.get(k).length)
    .sort((a,b)=>(coverage.get(a)||0)-(coverage.get(b)||0)||a.localeCompare(b))[0];
  const choice=byWeek.get(week).shift();
  selected.push(key(choice));
  coverage.set(week,(coverage.get(week)||0)+1);
 }
 // Zusaetzlich zur bestehenden GKV-Monatsuntergrenze und zu den fest
 // freigegebenen Januarterminen bis zu zehn weitere, technisch freie Starts.
 // Weniger nachgefragte Uhrzeiten werden anhand wiederkehrender Verfuegbarkeit
 // bevorzugt. Je Kalendertag werden hoechstens neun GKV-Starts vorausgeplant,
 // damit die spaetere harte Tagesobergrenze diese Bonusstarts nicht verdraengt.
 const bonusSlots=[];
 if(month==='2027-01'){
  const shown=new Set([...activeBaseline,...selected]);
  const byDayVisible=new Map();
  for(const x of regular)if(shown.has(key(x)))
   byDayVisible.set(x.date,(byDayVisible.get(x.date)||0)+1);
  const weekBonus=new Map();
  const candidates=regular.filter(x=>!shown.has(key(x))&&!JANUARY_2027_FIXED.has(key(x)));
  while(bonusSlots.length<JANUARY_2027_BONUS_COUNT){
   const options=candidates.filter(x=>(byDayVisible.get(x.date)||0)<9);
   if(!options.length)break;
   options.sort((a,b)=>{
    const sa=scores.get(weekday(a.date)+'|'+a.time)||0;
    const sb=scores.get(weekday(b.date)+'|'+b.time)||0;
    return sa-sb||
      (weekBonus.get(weekStart(a.date))||0)-(weekBonus.get(weekStart(b.date))||0)||
      (byDayVisible.get(a.date)||0)-(byDayVisible.get(b.date)||0)||
      a.date.localeCompare(b.date)||minOf(a.time)-minOf(b.time);
   });
   const x=options[0],id=key(x);
   bonusSlots.push(id);
   byDayVisible.set(x.date,(byDayVisible.get(x.date)||0)+1);
   const wk=weekStart(x.date);
   weekBonus.set(wk,(weekBonus.get(wk)||0)+1);
   candidates.splice(candidates.findIndex(c=>key(c)===id),1);
  }
 }
 return {
  v:2,day:today,month,extraSlots:selected,bonusSlots,
  freeRegular:regular.length,existingVisible:activeBaseline.size,
  target:MIN_GKV_MONTHLY_VISIBLE,bonusTarget:month==='2027-01'?JANUARY_2027_BONUS_COUNT:0,
  sourceAt:String(snapshot?.generatedAt||'')
 };
}
function validStoredPlan(x,day,month){
 const validKeys=a=>Array.isArray(a)&&a.every(k=>typeof k==='string'&&
   /^\d{4}-\d{2}-\d{2}\|\d{2}\.\d{2}\|(moxter|vongrone)$/.test(k)&&k.startsWith(month+'-'));
 return x&&x.v===2&&x.day===day&&x.month===month&&
  validKeys(x.extraSlots)&&x.extraSlots.length<=MIN_GKV_MONTHLY_VISIBLE&&
  validKeys(x.bonusSlots)&&x.bonusSlots.length<=(month==='2027-01'?JANUARY_2027_BONUS_COUNT:0)&&
  new Set([...x.extraSlots,...x.bonusSlots]).size===x.extraSlots.length+x.bonusSlots.length;
}
module.exports={computeMonthlyFloor,validStoredPlan,berlinDay,freeStarts,privateWindow,baselineForMonth,
 FLOOR_START_MONTH,MIN_GKV_MONTHLY_VISIBLE,JANUARY_2027_FIXED,JANUARY_2027_BONUS_COUNT};
