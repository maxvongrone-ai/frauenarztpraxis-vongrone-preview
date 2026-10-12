const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const esbuild=require('esbuild');

// A deployment must include a verified, anonymous slot snapshot, or fail safely.
const secretPath=path.join(process.cwd(),'api','security-secret.json');
if(!process.env.BOOKING_TOKEN_SECRET&&!fs.existsSync(secretPath)){
  fs.writeFileSync(secretPath,JSON.stringify({secret:crypto.randomBytes(48).toString('base64url')},null,2)+'\n','utf8');
}

// The sanitizer is shared by the private-store and the build-time mediDate path.
async function readBundledSnapshot(providerRaw=null){
  try{
    const {get}=providerRaw?{get:null}:await import('@vercel/blob');
    for(const key of providerRaw?['live']:['latest','all']){
      let timer;
      try{
        let raw=providerRaw;
        if(!raw){
          const blob=await Promise.race([
            get('medidate-anonymous-preview/v2/'+key+'.json',{
              access:'private',useCache:false,
              ...(process.env.BLOB_READ_WRITE_TOKEN?{token:process.env.BLOB_READ_WRITE_TOKEN}:{})
            }),
            new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2500)})
          ]);
          if(!blob||blob.statusCode!==200)continue;
          raw=JSON.parse(await new Response(blob.stream).text());
        }
        const validServices=new Set(['vorsorge','contraception','followup','breast']);
        const validDoctors=new Set(['moxter','vongrone']);
        const stamp=Date.parse(raw?.generatedAt||'');
        if(raw?.source!=='verified-mediDate-anonymous-preview'||
          !Array.isArray(raw.groups)||!Number.isFinite(stamp)||stamp>Date.now())continue;
        const groups=raw.groups.filter(g=>
          validServices.has(g?.serviceKey)&&Array.isArray(g.availability?.appointmentTimes))
          .map(g=>({
            serviceKey:g.serviceKey,
            serviceName:String(g.serviceName||g.serviceKey),
            verifiedAt:String(g.verifiedAt||raw.generatedAt),
            doctorKeys:Array.isArray(g.doctorKeys)?g.doctorKeys.filter(k=>validDoctors.has(k)):[],
            availability:{appointmentTimes:g.availability.appointmentTimes
              .filter(r=>validDoctors.has(r?.doctorKey)&&
                /^\d{4}-\d{2}-\d{2}/.test(String(r?.dateTimeStart||''))&&
                Number(r.duration)===15&&Array.isArray(r.times))
              .map(r=>({
                dateTimeStart:String(r.dateTimeStart),duration:15,
                doctorKey:r.doctorKey,calendarWeek:Number(r.calendarWeek||0),
                times:r.times.filter(t=>/^([01]?\d|2[0-3])\.[0-5]\d$/.test(String(t?.time||''))&&
                  t.direct&&Number(t.direct.clientId)>0&&Number(t.direct.locationId)>0&&
                  Number(t.direct.serviceId)>0&&Number(t.direct.doctorId)>0)
                  .map(t=>({time:String(t.time),direct:{
                    clientId:Number(t.direct.clientId),locationId:Number(t.direct.locationId),
                    serviceId:Number(t.direct.serviceId),doctorId:Number(t.direct.doctorId),
                    listReferenzId:Number(t.direct.listReferenzId||0),
                    calendarWeek:Number(t.direct.calendarWeek||0),duration:15
                  }}))
              }))}
          }));
        if(groups.length)return {ok:true,source:'verified-mediDate-anonymous-preview',
          generatedAt:raw.generatedAt,groups};
      }finally{if(timer)clearTimeout(timer)}
    }
  }catch(e){
    console.warn('Anonymous calendar preload unavailable:',String(e?.message||e).slice(0,110));
  }
  return null;
}

function hasFutureAvailability(bundle){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date());
  const today=['year','month','day'].map(k=>parts.find(p=>p.type===k)?.value).join('-');
  return Boolean(bundle?.groups?.some(g=>g.availability?.appointmentTimes?.some(r=>
    String(r.dateTimeStart||'').slice(0,10)>=today&&r.times?.length)));
}
async function readFreshDeploymentSnapshot(){
  try{
    const {buildFastPublicBundle}=require('../lib/medidate-core');
    const live=await buildFastPublicBundle();
    const safe=await readBundledSnapshot({
      ...live,source:'verified-mediDate-anonymous-preview'
    });
    if(!hasFutureAvailability(safe))return null;
    console.log('Deployment mediDate availability ready, services:',safe.groups.length);
    return safe;
  }catch(e){
    console.warn('Deployment live availability failed:',String(e?.message||e).slice(0,170));
    return null;
  }
}
async function storeFreshDeploymentSnapshot(snapshot){
  if(!snapshot)return;
  try{
    const {put}=await import('@vercel/blob');
    await put('medidate-anonymous-preview/v2/latest.json',JSON.stringify({
      ...snapshot,serviceKey:'latest'
    }),{
      access:'private',contentType:'application/json; charset=utf-8',
      addRandomSuffix:false,allowOverwrite:true,
      ...(process.env.BLOB_READ_WRITE_TOKEN?{token:process.env.BLOB_READ_WRITE_TOKEN}:{})
    });
    console.log('Deployment: anonymous shared calendar storage updated');
  }catch(e){
    console.warn('Deployment Blob write unavailable:',String(e?.message||e).slice(0,130));
  }
}

async function buildStaticAssets(){
  const publicDir=path.join(process.cwd(),'public');
  fs.rmSync(publicDir,{recursive:true,force:true});
  fs.mkdirSync(publicDir,{recursive:true});

  const sourceIndex=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
  const marker='window.__MEDIDATE_SEED__=null;';
  if(!sourceIndex.includes(marker))throw new Error('Seed marker in index.html fehlt.');
  const styleMatch=sourceIndex.match(/<style>([\s\S]*?)<\/style>/i);
  const scriptMatches=[...sourceIndex.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  if(!styleMatch||scriptMatches.length!==2||!scriptMatches[0][1].includes(marker))throw new Error('Booking-Assets konnten nicht sicher extrahiert werden.');

  fs.writeFileSync(path.join(publicDir,'styles.css'),styleMatch[1].trim()+'\n','utf8');
  const storedSeed=await readBundledSnapshot();
  // This query happens at BUILD time, not while a patient is opening a calendar.
  const liveSeed=await readFreshDeploymentSnapshot();
  const anonymousSeed=liveSeed||storedSeed;
  if(process.env.VERCEL==='1'&&!hasFutureAvailability(anonymousSeed)){
    throw new Error('Build verweigert: kein aktueller, anonymisierter mediDate-Terminstand vorhanden. Vorherige Produktion bleibt bestehen.');
  }
  if(liveSeed)await storeFreshDeploymentSnapshot(liveSeed);
  // Only anonymous, provider-verified technical free slots are bundled here.
  // No tracking proof, patient identity or booking token is included.
  fs.writeFileSync(path.join(publicDir,'seed-data.js'),
    'window.__MEDIDATE_SEED__='+JSON.stringify(anonymousSeed)+';\n','utf8');
  fs.writeFileSync(path.join(publicDir,'app.js'),scriptMatches[1][1].trim()+'\n','utf8');

  esbuild.buildSync({
    entryPoints:[path.join(process.cwd(),'botid-client-entry.js')],
    bundle:true,
    format:'iife',
    platform:'browser',
    target:['es2020'],
    minify:true,
    legalComments:'none',
    define:{'process.env.NODE_ENV':'"production"'},
    outfile:path.join(publicDir,'botid-client.js')
  });

  let builtIndex=sourceIndex.replace(styleMatch[0],'<link rel="stylesheet" href="/styles.css">');
  builtIndex=builtIndex.replace(scriptMatches[0][0],'<script src="/seed-data.js"></script>');
  builtIndex=builtIndex.replace(scriptMatches[1][0],'<script src="/app.js"></script>');
  fs.writeFileSync(path.join(publicDir,'index.html'),builtIndex,'utf8');

  for(const file of [
    'admin.html','admin.css','admin.js',
    'privacy-booking.html',
    'tracking.html','tracking.css','tracking.js',
    'staff-booking.html','staff-booking.css','staff-booking.js',
    'robots.txt'
  ]){
    fs.copyFileSync(path.join(process.cwd(),file),path.join(publicDir,file));
  }

  // Explicit empty placeholder. The API treats this as "no cached bundle" and
  // fetches a fresh, server-validated bundle on first runtime request.
  fs.writeFileSync(path.join(process.cwd(),'api','seed-bundle.json'),JSON.stringify({ok:false,generatedAt:null,groups:[],runtimeBootstrap:true},null,2)+'\n','utf8');
  console.log('Secure static build; anonymous calendar preloaded:',Boolean(anonymousSeed));
}

buildStaticAssets().catch(e=>{
  console.error('Static build failed:',e?.stack||e?.message||e);
  process.exit(1);
});
