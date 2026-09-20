const fs=require('fs');
const path=require('path');

const API_BASE='https://medidatestagingapi.azurewebsites.net/api/v1/';
const PRACTICE_HOME='https://www.frauenarztpraxis-vongrone.de/';
const SERVICE_IDS=[1950,1952,1973,1974];
const NAMES={
  1950:'Vorsorge',
  1952:'regelmäßige Kontrolle bei Antikonzeption',
  1973:'Nachsorge',
  1974:'Brustultraschall'
};

function timeoutSignal(ms){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),ms);
  return {signal:c.signal,clear:()=>clearTimeout(timer)};
}
async function fetchText(url,options={},timeoutMs=90000){
  const t=timeoutSignal(timeoutMs);
  try{
    const r=await fetch(url,{
      redirect:'follow',
      ...options,
      signal:t.signal,
      headers:{'User-Agent':'Frauenarztpraxis-von-Grone-BuildSeed/1.0',...(options.headers||{})}
    });
    const text=await r.text();
    if(!r.ok)throw new Error(`HTTP ${r.status}: ${url}`);
    return text;
  }finally{t.clear()}
}
function decode(s){return String(s||'').replace(/&amp;/g,'&').replace(/&#38;/g,'&')}
async function bookingUrl(){
  const env=String(process.env.MEDIDATE_PUBLIC_BOOKING_URL||'').trim();
  if(env)return env;

  const page=await fetchText(PRACTICE_HOME,{},30000);
  const matches=[
    ...page.matchAll(/href=["']([^"']*order\.medidate\.org[^"']*)["']/ig),
    ...page.matchAll(/(https:\/\/order\.medidate\.org\/\?[^"'<>\\s]+)/ig)
  ];

  for(const m of matches){
    const raw=decode(m[1]||m[0]);
    try{
      const u=new URL(raw.startsWith('http')?raw:new URL(raw,PRACTICE_HOME));
      if(u.hostname==='order.medidate.org')return u.toString();
    }catch{}
  }
  throw new Error('Öffentlicher mediDate-Link nicht gefunden.');
}
async function session(){
  const url=await bookingUrl();
  const page=await fetchText(url,{},90000);
  const c=page.match(/var\s+ClientID\s*=\s*'([0-9]+)'/);
  const l=page.match(/var\s+LocationID\s*=\s*'([0-9]+)'/);
  const t=page.match(/var\s+token\s*=\s*'([^']+)'/);

  if(!c||!l||!t)throw new Error('mediDate-Sessiondaten nicht lesbar.');

  return {
    clientId:Number(c[1]),
    locationId:Number(l[1]),
    token:t[1],
    bookingUrl:url
  };
}
async function availability(s,serviceId){
  const u=new URL('appointments/appointmenttimes',API_BASE);
  u.searchParams.set('clientid',String(s.clientId));
  u.searchParams.set('locationId',String(s.locationId));
  u.searchParams.set('serviceId',String(serviceId));
  u.searchParams.set('doctorId','0');

  const text=await fetchText(u.toString(),{
    headers:{'Accept':'application/json','Authorization':`Bearer ${s.token}`}
  },90000);

  const data=JSON.parse(text);
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
async function generate(){
  const s=await session();
  const groups=await Promise.all(SERVICE_IDS.map(async id=>({
    serviceId:id,
    serviceName:NAMES[id],
    availability:await availability(s,id)
  })));

  const seed={
    generatedAt:new Date().toISOString(),
    groups,
    partial:false,
    failedServices:0
  };

  fs.writeFileSync(
    path.join(process.cwd(),'seed-data.js'),
    'window.__MEDIDATE_SEED__='+JSON.stringify(seed)+';\n',
    'utf8'
  );

  fs.writeFileSync(
    path.join(process.cwd(),'api','seed-session.json'),
    JSON.stringify({...s,generatedAt:seed.generatedAt},null,2)+'\n',
    'utf8'
  );

  // Identical deployment-local fallback for the browser. This is only public
  // appointment availability; it contains no patient data.
  fs.writeFileSync(
    path.join(process.cwd(),'api','seed-bundle.json'),
    JSON.stringify(seed,null,2)+'\n',
    'utf8'
  );

  // Vercel project expects the static build output in /public.
  // Copy only public website assets there; API/server files stay outside.
  const publicDir=path.join(process.cwd(),'public');
  fs.rmSync(publicDir,{recursive:true,force:true});
  fs.mkdirSync(publicDir,{recursive:true});

  // Put the current availability snapshot directly into the delivered index.html.
  // This removes the first-paint dependency on a separate /seed-data.js request.
  const sourceIndex=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
  const marker='window.__MEDIDATE_SEED__=null;';
  if(!sourceIndex.includes(marker))throw new Error('Seed marker in index.html fehlt.');
  const builtIndex=sourceIndex.replace(
    marker,
    'window.__MEDIDATE_SEED__='+JSON.stringify(seed)+';'
  );
  fs.writeFileSync(path.join(publicDir,'index.html'),builtIndex,'utf8');

  for(const file of ['admin.html','privacy-booking.html','tracking.html','robots.txt']){
    fs.copyFileSync(
      path.join(process.cwd(),file),
      path.join(publicDir,file)
    );
  }

  console.log(`Build seed generated: ${seed.generatedAt}; services=${groups.length}`);
  console.log('Current availability inlined into /public/index.html');
}

(async()=>{
  let lastError;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      await generate();
      return;
    }catch(e){
      lastError=e;
      console.error(`Seed attempt ${attempt} failed: ${e.message}`);
      if(attempt<2)await new Promise(r=>setTimeout(r,3000));
    }
  }

  console.error('Deployment aborted: no current mediDate seed could be generated.',lastError?.message||'');
  process.exit(1);
})();