'use strict';
const {buildFastPublicBundle}=require('../lib/medidate-core');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.statusCode=405;return res.end(JSON.stringify({ok:false}))}
  try{
    const bundle=await buildFastPublicBundle('vorsorge',{waitAll:true});
    const groups=bundle?.groups||[];
    const freeSlots=groups.reduce((n,g)=>n+(g?.availability?.appointmentTimes||[]).reduce((m,row)=>m+(row.times||[]).length,0),0);
    return res.end(JSON.stringify({ok:true,mode:'sandbox-readonly',provider:'mediDate',service:'vorsorge',receivedGroups:groups.length,freeSlots,generatedAt:bundle.generatedAt||null}));
  }catch(e){
    console.warn('Sandbox mediDate health test failed',String(e?.message||'').slice(0,120));
    res.statusCode=503;
    return res.end(JSON.stringify({ok:false,mode:'sandbox-readonly',provider:'mediDate',error:'Live-Terminabfrage fehlgeschlagen'}));
  }
};
