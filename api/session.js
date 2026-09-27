const {bootstrap,API_BASE}=require('../lib/medidate-core');

function sameOrigin(req){
  const site=String(req.headers['sec-fetch-site']||'').toLowerCase();
  return site==='same-origin';
}

function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.end(JSON.stringify(body));
}

module.exports=async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{ok:false,error:'Methode nicht erlaubt.'});
  if(!sameOrigin(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'});

  try{
    const {checkBotId}=await import('botid/server');
    const verdict=await checkBotId({
      advancedOptions:{
        checkLevel:'basic',
        headers:req.headers
      }
    });
    if(verdict?.isBot){
      return send(res,403,{ok:false,error:'Automatisierte Buchungsanfragen sind nicht zugelassen.'});
    }

    const force=String(req.query?.force||'')==='1';
    const s=await bootstrap(force);
    return send(res,200,{
      ok:true,
      token:s.token,
      clientId:s.clientId,
      locationId:s.locationId,
      apiBase:API_BASE,
      issuedAt:s.issuedAt||Date.now(),
      securityMode:'browser-direct-medidate-botid-basic'
    });
  }catch(e){
    return send(res,503,{ok:false,error:'Die sichere mediDate-Sitzung ist derzeit nicht verfügbar. Bitte versuchen Sie es erneut.'});
  }
};
