const tracking=require('./tracking');

const EXPECTED_SCHEDULE='15 4 * * *';

function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.end(JSON.stringify(body));
}

module.exports=async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{ok:false});

  const schedule=String(req.headers['x-vercel-cron-schedule']||'');
  if(schedule!==EXPECTED_SCHEDULE)return send(res,404,{ok:false});

  try{
    const result=await tracking.reconcileTrackedBookings({force:false});
    return send(res,200,{ok:true,skipped:Boolean(result?.skipped)});
  }catch(e){
    console.error('Daily cancellation reconciliation failed',{message:e?.message});
    return send(res,500,{ok:false});
  }
};
