/* mediDate availability/session bridge for browser-direct booking.
 * Patient identity data is never accepted or processed by this endpoint.
 */
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {buildPublicBundle,buildFastPublicBundle,bootstrap,API_BASE,SERVICE_RULES,readSecret}=require('../lib/medidate-core');
const SEED_BUNDLE_PATH=path.join(__dirname,'seed-bundle.json');
let liveBundlePromise=null;
async function getLiveBundle(){
  if(liveBundlePromise)return liveBundlePromise;
  liveBundlePromise=buildPublicBundle().finally(()=>{liveBundlePromise=null});
  return liveBundlePromise;
}

function requestAllowed(req){
  // Deliberately do not read, hash, store or rate-limit by client IP.
  // Sensitive bridge actions require the browser-generated Fetch Metadata signal.
  // Requests with a missing signal are rejected instead of being treated as trusted.
  const site=String(req.headers['sec-fetch-site']||'').toLowerCase();
  return site==='same-origin';
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
      return send(res,200,{ok:true,buildBundleReady:Boolean(bundle),generatedAt:bundle?.generatedAt||null,groups:Array.isArray(bundle?.groups)?bundle.groups.length:0,securityMode:'browser-direct-medidate-no-pii-proxy',elapsedMs:Date.now()-started});
    }
    if(action==='publicSession'||action==='liveSession'){
      return send(res,410,{ok:false,error:'Die mediDate-Sitzung wird nur noch über den BotID-geschützten Sitzungsendpunkt ausgegeben.'},{cache:'no-store'});
    }
    if(action==='diagnostics'){
      if(!requestAllowed(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'},{cache:'no-store'});
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
        if(!requestAllowed(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'},{cache:'no-store'});
        bundle=await getLiveBundle();
      }
      return send(res,200,{ok:true,...bundle,elapsedMs:Date.now()-started},{cache:'public, max-age=60',cdn:'public, s-maxage=600, stale-while-revalidate=900, stale-if-error=21600',vercel:'public, s-maxage=600, stale-while-revalidate=900, stale-if-error=21600'});
    }
    if(action==='trackingProof'){
      if(!requestAllowed(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'},{cache:'no-store'});
      // Issue a single, unique, short-lived, content-free tracking token. This
      // endpoint does not receive patient identity, appointment date or time.
      // The proof is fetched only when a patient actually selects a time.
      const nonce=crypto.randomBytes(18).toString('base64url');
      const exp=Date.now()+12*60*60*1000;
      const proof=crypto.createHmac('sha256',readSecret()).update('tracking:'+nonce+':'+exp).digest('base64url');
      return send(res,200,{ok:true,trackingNonce:nonce,trackingExp:exp,trackingProof:proof},{cache:'no-store, max-age=0'});
    }
    if(action==='liveService'){
      if(!requestAllowed(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'},{cache:'no-store'});
      const serviceKey=String(req.query?.serviceKey||'');
      if(!SERVICE_RULES.some(rule=>rule.key===serviceKey))return send(res,400,{ok:false,error:'Terminart nicht freigegeben.'},{cache:'no-store'});
      const bundle=await buildFastPublicBundle(serviceKey);
      return send(res,200,{...bundle,elapsedMs:Date.now()-started},{cache:'no-store, max-age=0',cdn:'no-store',vercel:'no-store'});
    }
    if(action==='liveSelection'){
      if(!requestAllowed(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'},{cache:'no-store'});
      const bundle=await buildFastPublicBundle();
      return send(res,200,{...bundle,elapsedMs:Date.now()-started},{cache:'no-store, max-age=0',cdn:'no-store',vercel:'no-store'});
    }
    if(action==='liveBundle'){
      if(!requestAllowed(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'},{cache:'no-store'});
      const bundle=await getLiveBundle();
      return send(res,200,{...bundle,elapsedMs:Date.now()-started},{cache:'no-store, max-age=0',cdn:'no-store',vercel:'no-store'});
    }
    return send(res,404,{ok:false,error:'Unbekannte oder nicht freigegebene Aktion.'});
  }catch(e){
    console.error('Secure availability refresh error',{action:req.query?.action,message:e?.message,elapsedMs:Date.now()-started});
    return send(res,502,{ok:false,error:'Die Terminverfügbarkeit konnte nicht aktualisiert werden.'});
  }
};
