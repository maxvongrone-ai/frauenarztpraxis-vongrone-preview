/* Public, read-only mediDate availability bridge.
 * No bearer token, client/location ids or mediDate write capability are exposed.
 */
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {buildPublicBundle,readSecret}=require('../lib/medidate-core');
const SEED_BUNDLE_PATH=path.join(__dirname,'seed-bundle.json');
let liveBundlePromise=null;
async function getLiveBundle(){
  if(liveBundlePromise)return liveBundlePromise;
  liveBundlePromise=buildPublicBundle().finally(()=>{liveBundlePromise=null});
  return liveBundlePromise;
}

const REFRESH_WINDOW_MS=10*60*1000;
const REFRESH_MAX_PER_IP=12;
const refreshAttempts=global.__MEDIDATE_REFRESH_RATE__||(global.__MEDIDATE_REFRESH_RATE__=new Map());
function refreshClientKey(req){const ip=String(req.headers['x-forwarded-for']||req.headers['x-real-ip']||'unknown').split(',')[0].trim();return crypto.createHmac('sha256',readSecret()).update(ip).digest('hex').slice(0,32)}
function refreshAllowed(req){
  const site=String(req.headers['sec-fetch-site']||'');if(site&&site!=='same-origin')return false;
  const now=Date.now(),key=refreshClientKey(req),old=refreshAttempts.get(key),rec=!old||now-old.start>REFRESH_WINDOW_MS?{start:now,count:0}:old;rec.count++;refreshAttempts.set(key,rec);
  if(refreshAttempts.size>1000)for(const [k,v] of refreshAttempts)if(now-v.start>REFRESH_WINDOW_MS)refreshAttempts.delete(k);
  return rec.count<=REFRESH_MAX_PER_IP;
}

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
function readSeedBundle(){try{const b=JSON.parse(fs.readFileSync(SEED_BUNDLE_PATH,'utf8'));return Array.isArray(b?.groups)&&b.groups.length?b:null}catch{return null}}

module.exports=async function handler(req,res){
  const started=Date.now();
  try{
    if(req.method!=='GET')return send(res,405,{ok:false,error:'Nur lesender Zugriff erlaubt.'});
    const action=String(req.query?.action||'health');
    if(action==='health'){
      const bundle=readSeedBundle();
      return send(res,200,{ok:true,buildBundleReady:Boolean(bundle),generatedAt:bundle?.generatedAt||null,groups:Array.isArray(bundle?.groups)?bundle.groups.length:0,securityMode:'opaque-slot-tokens',elapsedMs:Date.now()-started});
    }
    if(action==='diagnostics'){
      if(!refreshAllowed(req))return send(res,429,{ok:false,error:'Zu viele Diagnoseanfragen.'},{cache:'no-store'});
      try{
        const bundle=await getLiveBundle();
        return send(res,200,{ok:true,runtimeBootstrap:true,services:(bundle.groups||[]).map(g=>({key:g.serviceKey,blocks:Array.isArray(g?.availability?.appointmentTimes)?g.availability.appointmentTimes.length:0})),generatedAt:bundle.generatedAt||null,elapsedMs:Date.now()-started},{cache:'no-store'});
      }catch(e){
        return send(res,502,{ok:false,runtimeBootstrap:true,stage:'medidate-runtime-bootstrap',error:'mediDate-Liveabruf fehlgeschlagen.',detail:String(e?.message||'Unbekannter Fehler').slice(0,180),elapsedMs:Date.now()-started},{cache:'no-store'});
      }
    }
    if(action==='publicBundle'){
      let bundle=readSeedBundle();
      if(!bundle){
        if(!refreshAllowed(req))return send(res,429,{ok:false,error:'Zu viele Aktualisierungsanfragen. Bitte später erneut versuchen.'},{cache:'no-store'});
        bundle=await getLiveBundle();
      }
      return send(res,200,{ok:true,...bundle,elapsedMs:Date.now()-started},{cache:'public, max-age=60',cdn:'public, s-maxage=600, stale-while-revalidate=86400, stale-if-error=86400',vercel:'public, s-maxage=600, stale-while-revalidate=86400, stale-if-error=86400'});
    }
    if(action==='liveBundle'){
      if(!refreshAllowed(req))return send(res,429,{ok:false,error:'Zu viele Aktualisierungsanfragen. Bitte später erneut versuchen.'},{cache:'no-store'});
      const bundle=await getLiveBundle();
      return send(res,200,{...bundle,elapsedMs:Date.now()-started},{cache:'public, max-age=30, stale-while-revalidate=120',cdn:'public, s-maxage=600, stale-while-revalidate=86400, stale-if-error=86400',vercel:'public, s-maxage=600, stale-while-revalidate=86400, stale-if-error=86400'});
    }
    // Deliberately removed: publicSession/liveSession. Browser never gets mediDate bearer token.
    return send(res,404,{ok:false,error:'Unbekannte oder nicht freigegebene Aktion.'});
  }catch(e){
    console.error('Secure availability refresh error',{action:req.query?.action,message:e?.message,elapsedMs:Date.now()-started});
    return send(res,502,{ok:false,error:'Die Terminverfügbarkeit konnte nicht aktualisiert werden.'});
  }
};
