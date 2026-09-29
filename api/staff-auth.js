const {verifyPassword,makeSessionCookie,clearSessionCookie,isAuthenticated,sameOrigin}=require('../lib/staff-auth');

function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.end(JSON.stringify(body));
}
async function readBody(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string')return JSON.parse(req.body||'{}');
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw new Error('Payload zu groß.')}
  return JSON.parse(raw||'{}');
}
module.exports=async function handler(req,res){
  try{
    if(!sameOrigin(req))return send(res,403,{ok:false,error:'Ungültige Herkunft.'});
    if(req.method==='GET')return send(res,200,{ok:true,authenticated:isAuthenticated(req)});
    if(req.method!=='POST')return send(res,405,{ok:false,error:'Methode nicht erlaubt.'});

    const action=String(req.query?.action||'login');
    if(action==='logout'){
      res.setHeader('Set-Cookie',clearSessionCookie());
      return send(res,200,{ok:true,authenticated:false});
    }
    if(action!=='login')return send(res,404,{ok:false,error:'Unbekannte Aktion.'});

    const {checkBotId}=await import('botid/server');
    const verdict=await checkBotId({advancedOptions:{checkLevel:'basic',headers:req.headers}});
    if(verdict?.isBot)return send(res,403,{ok:false,error:'Automatisierte Anmeldeversuche sind nicht zugelassen.'});

    const body=await readBody(req);
    if(!verifyPassword(body?.password))return send(res,401,{ok:false,error:'Passwort nicht korrekt.'});
    res.setHeader('Set-Cookie',makeSessionCookie());
    return send(res,200,{ok:true,authenticated:true});
  }catch(e){
    return send(res,400,{ok:false,error:e?.message||'Anmeldung fehlgeschlagen.'});
  }
};
