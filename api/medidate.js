/*
 * V54 public-only mediDate bridge.
 *
 * First calendar paint does NOT call this function; current public availability
 * is generated during deployment into /seed-data.js.
 *
 * This function only performs background refreshes and supplies the public
 * mediDate browser session. There is no patient-data POST endpoint.
 */

const fs=require('fs');
const path=require('path');

const API_BASE='https://medidatestagingapi.azurewebsites.net/api/v1/';
const PRACTICE_HOME='https://www.frauenarztpraxis-vongrone.de/';
const DEFAULT_MEDIDATE_BOOKING_URL='https://order.medidate.org/?pid=cf9289f9-342d-4692-a047-7327144797dc&ptok=6976306d715a4c46383038522f586d6f4d61376e754a4e716e4f6a303367384b4251635743556455425962413371374c5a5736544d4f676f65477752486f4d7a764d6f53335271364670536b505661736b6e55617069566837535255456d3763426773393962313635414f4935706e70585256544e6464546b6f47543464786733542b32754b5045315a7335736d516955334578625175694470617a73726c737a375452664f62425157513d';
const FIXED_SERVICE_IDS=[1950,1952,1973,1974];
const FIXED_SERVICE_NAMES={
  1950:'Vorsorge',
  1952:'regelmäßige Kontrolle bei Antikonzeption',
  1973:'Nachsorge',
  1974:'Brustultraschall'
};

let bookingUrlCache={value:null,at:0};
let bootstrapCache={value:null,at:0};
const BOOKING_URL_CACHE_MS=10*60*1000;
const SESSION_CACHE_MS=20*60*1000;
const SEED_SESSION_PATH=path.join(__dirname,'seed-session.json');
const SEED_BUNDLE_PATH=path.join(__dirname,'seed-bundle.json');

function send(res,status,body,{cache='no-store',cdn=null,vercel=null}={}){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control',cache);
  if(cdn)res.setHeader('CDN-Cache-Control',cdn);
  if(vercel)res.setHeader('Vercel-CDN-Cache-Control',vercel);
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
function withTimeout(ms){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  return {signal:controller.signal,clear:()=>clearTimeout(timer)};
}
async function fetchText(url,options={},timeoutMs=60000){
  const t=withTimeout(timeoutMs);
  try{
    const r=await fetch(url,{
      redirect:'follow',
      ...options,
      signal:t.signal,
      headers:{'User-Agent':'Frauenarztpraxis-von-Grone-Refresh/4.0',...(options.headers||{})}
    });
    const text=await r.text();
    if(!r.ok)throw new Error(`HTTP ${r.status} bei ${new URL(url).hostname}`);
    return text;
  }finally{t.clear()}
}
function htmlDecode(s){return String(s||'').replace(/&amp;/g,'&').replace(/&#38;/g,'&')}
function readSeedSession(){
  try{
    const s=JSON.parse(fs.readFileSync(SEED_SESSION_PATH,'utf8'));
    if(s?.token&&s?.clientId&&s?.locationId&&s?.bookingUrl){
      const parsedGeneratedAt=Date.parse(String(s.generatedAt||''));
      const issuedAt=Number.isFinite(Number(s.issuedAt))&&Number(s.issuedAt)>0
        ?Number(s.issuedAt)
        :(Number.isFinite(parsedGeneratedAt)?parsedGeneratedAt:0);
      return {...s,issuedAt,apiBase:API_BASE};
    }
  }catch{}
  return null;
}
function readSeedBundle(){
  try{
    const b=JSON.parse(fs.readFileSync(SEED_BUNDLE_PATH,'utf8'));
    if(Array.isArray(b?.groups)&&b.groups.length)return b;
  }catch{}
  return null;
}
async function discoverBookingUrl(force=false){
  const env=String(process.env.MEDIDATE_PUBLIC_BOOKING_URL||'').trim();
  if(env){
    const u=new URL(env);
    if(u.hostname!=='order.medidate.org')throw new Error('MEDIDATE_PUBLIC_BOOKING_URL verweist nicht auf order.medidate.org.');
    return u.toString();
  }
  if(!force&&bookingUrlCache.value&&Date.now()-bookingUrlCache.at<BOOKING_URL_CACHE_MS)return bookingUrlCache.value;

  // Die Praxiswebsite verlinkt inzwischen auf die eigene Vercel-Buchungsoberfläche.
  // Deshalb darf die mediDate-Session nicht mehr davon abhängen, dort erneut einen
  // order.medidate.org-Link zu finden.
  if(DEFAULT_MEDIDATE_BOOKING_URL){
    bookingUrlCache={value:DEFAULT_MEDIDATE_BOOKING_URL,at:Date.now()};
    return bookingUrlCache.value;
  }

  const page=await fetchText(PRACTICE_HOME,{},20000);
  const candidates=[
    ...page.matchAll(/href=["']([^"']*order\.medidate\.org[^"']*)["']/ig),
    ...page.matchAll(/(https:\/\/order\.medidate\.org\/\?[^"'<>\\s]+)/ig)
  ];
  for(const m of candidates){
    const raw=htmlDecode(m[1]||m[0]);
    try{
      const u=new URL(raw.startsWith('http')?raw:new URL(raw,PRACTICE_HOME));
      if(u.hostname==='order.medidate.org'){
        bookingUrlCache={value:u.toString(),at:Date.now()};
        return bookingUrlCache.value;
      }
    }catch{}
  }
  throw new Error('Der öffentliche mediDate-Link konnte nicht gefunden werden.');
}
async function bootstrap(force=false){
  if(!force&&bootstrapCache.value&&Date.now()-bootstrapCache.at<SESSION_CACHE_MS)return bootstrapCache.value;

  // Direkt nach einem Deployment ist bereits eine beim Build erfolgreich
  // ermittelte mediDate-Sitzung vorhanden. Diese zuerst nutzen, damit der erste
  // Buchungsklick nicht auf zwei externe HTML-Aufrufe warten muss.
  if(!force){
    const seed=readSeedSession();
    if(seed?.issuedAt&&Date.now()-seed.issuedAt<15*60*1000){
      bootstrapCache={value:seed,at:Date.now()};
      return seed;
    }
  }

  const bookingUrl=await discoverBookingUrl(force);
  const page=await fetchText(bookingUrl,{},30000);
  const c=page.match(/var\s+ClientID\s*=\s*'([0-9]+)'/);
  const l=page.match(/var\s+LocationID\s*=\s*'([0-9]+)'/);
  const t=page.match(/var\s+token\s*=\s*'([^']+)'/);
  if(!c||!l||!t)throw new Error('Die mediDate-Startdaten konnten nicht gelesen werden.');

  const value={clientId:Number(c[1]),locationId:Number(l[1]),token:t[1],bookingUrl,apiBase:API_BASE,issuedAt:Date.now()};
  bootstrapCache={value,at:Date.now()};
  return value;
}
async function apiGet(session,serviceId){
  const u=new URL('appointments/appointmenttimes',API_BASE);
  u.searchParams.set('clientid',String(session.clientId));
  u.searchParams.set('locationId',String(session.locationId));
  u.searchParams.set('serviceId',String(serviceId));
  u.searchParams.set('doctorId','0');

  const t=withTimeout(60000);
  try{
    const r=await fetch(u,{
      signal:t.signal,
      headers:{
        'Accept':'application/json',
        'Authorization':`Bearer ${session.token}`,
        'User-Agent':'Frauenarztpraxis-von-Grone-Refresh/4.0'
      }
    });
    const text=await r.text();
    let data=null;if(text){try{data=JSON.parse(text)}catch{data=text}}
    if(!r.ok)throw new Error(`mediDate API HTTP ${r.status}`);
    return data;
  }finally{t.clear()}
}
function compactAvailability(data){
  const rows=Array.isArray(data?.appointmentTimes)?data.appointmentTimes:[];
  return {
    appointmentTimes:rows.map(r=>({
      dateTimeStart:String(r.dateTimeStart||''),
      duration:Number(r.duration||0),
      doctorId:Number(r.doctorId||0),
      calendarWeek:Number(r.calendarWeek||r.calenderWeek||0),
      listReferenzId:Number(r.listReferenzId||0),
      times:Array.isArray(r.times)?r.times:[]
    }))
  };
}
async function buildLiveBundle(){
  let session=await bootstrap(false);

  let settled=await Promise.allSettled(FIXED_SERVICE_IDS.map(async serviceId=>{
    const data=await apiGet(session,serviceId);
    return {serviceId,serviceName:FIXED_SERVICE_NAMES[serviceId],availability:compactAvailability(data)};
  }));

  if(settled.every(x=>x.status==='rejected')){
    session=await bootstrap(true);
    settled=await Promise.allSettled(FIXED_SERVICE_IDS.map(async serviceId=>{
      const data=await apiGet(session,serviceId);
      return {serviceId,serviceName:FIXED_SERVICE_NAMES[serviceId],availability:compactAvailability(data)};
    }));
  }

  const groups=settled.filter(x=>x.status==='fulfilled').map(x=>x.value);
  const ids=new Set(groups.map(g=>Number(g.serviceId)));
  const complete=FIXED_SERVICE_IDS.every(id=>ids.has(id));
  if(!complete){
    throw new Error('Die Live-Aktualisierung ist unvollständig; der letzte vollständige Terminstand bleibt erhalten.');
  }

  return {
    ok:true,
    generatedAt:new Date().toISOString(),
    groups,
    partial:false,
    failedServices:0,
    session
  };
}

const medidateHandler=async function handler(req,res){
  const started=Date.now();
  try{
    if(!sameOrigin(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'});
    if(req.method!=='GET'){
      return send(res,405,{ok:false,error:'Dieser Server verarbeitet keine Patientendaten.'});
    }

    const action=String(req.query?.action||'health');

    if(action==='health'){
      const seed=readSeedSession();
      const bundle=readSeedBundle();
      return send(res,200,{
        ok:true,
        buildSeedReady:Boolean(seed),
        buildBundleReady:Boolean(bundle),
        generatedAt:bundle?.generatedAt||null,
        groups:Array.isArray(bundle?.groups)?bundle.groups.length:0,
        elapsedMs:Date.now()-started
      });
    }

    if(action==='publicBundle'){
      const bundle=readSeedBundle();
      const seed=readSeedSession();
      if(!bundle)return send(res,503,{ok:false,error:'Deployment-Snapshot fehlt.'});
      return send(res,200,{
        ok:true,
        ...bundle,
        session:seed?{...seed,apiBase:API_BASE}:undefined,
        elapsedMs:Date.now()-started
      },{
        cache:'public, max-age=60',
        cdn:'public, s-maxage=600, stale-while-revalidate=86400',
        vercel:'public, s-maxage=600, stale-while-revalidate=86400'
      });
    }

    if(action==='publicSession'){
      const session=await bootstrap(false);
      return send(res,200,{ok:true,...session,apiBase:API_BASE});
    }

    if(action==='liveSession'){
      const s=await bootstrap(true);
      return send(res,200,{ok:true,...s,apiBase:API_BASE});
    }

    if(action==='liveBundle'){
      const bundle=await buildLiveBundle();
      return send(res,200,{...bundle,elapsedMs:Date.now()-started},{
        cache:'public, max-age=30, stale-while-revalidate=120',
        cdn:'public, s-maxage=600, stale-while-revalidate=86400, stale-if-error=86400',
        vercel:'public, s-maxage=600, stale-while-revalidate=86400, stale-if-error=86400'
      });
    }

    return send(res,404,{ok:false,error:'Unbekannte Aktion.'});
  }catch(e){
    console.error('V54 live refresh error',{action:req.query?.action,message:e?.message,elapsedMs:Date.now()-started});
    return send(res,502,{ok:false,error:e?.message||'Unbekannter Fehler'});
  }
};

module.exports=medidateHandler;
module.exports.buildLiveBundle=buildLiveBundle;
