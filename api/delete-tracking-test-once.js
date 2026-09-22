const TRACKING_PREFIX='medidate-booking-tracking/v3/events/';
const TARGET_DATE='2026-09-22';
const TARGET_TIME='08:26:07';

let _blobApiPromise;
async function blobApi(){
  if(!_blobApiPromise)_blobApiPromise=import('@vercel/blob');
  return _blobApiPromise;
}
function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.end(JSON.stringify(body));
}
function berlinStamp(value){
  const d=new Date(String(value||''));
  if(!Number.isFinite(d.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Berlin',
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',
    hourCycle:'h23'
  }).formatToParts(d);
  const o={};for(const p of parts)if(p.type!=='literal')o[p.type]=p.value;
  return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}:${o.second}`;
}
async function streamToText(stream){return stream?await new Response(stream).text():''}
async function readOne(get,blob){
  try{
    const r=await get(blob.url||blob.pathname,{access:'private',useCache:false});
    if(!r||r.statusCode!==200)return null;
    return JSON.parse(await streamToText(r.stream));
  }catch{return null}
}
async function listAll(list,prefix){
  const out=[];let cursor;
  do{
    const r=await list({prefix,limit:1000,cursor});
    if(Array.isArray(r?.blobs))out.push(...r.blobs);
    cursor=r?.hasMore?r.cursor:undefined;
  }while(cursor&&out.length<20000);
  return out;
}

module.exports=async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{ok:false});
  if(!process.env.BLOB_STORE_ID&&!process.env.BLOB_READ_WRITE_TOKEN){
    return send(res,503,{ok:false,error:'Blob store not configured'});
  }
  try{
    const {list,get,del,put}=await blobApi();
    const records=[];
    const blobs=await listAll(list,TRACKING_PREFIX);
    for(let i=0;i<blobs.length;i+=40){
      const batch=await Promise.all(blobs.slice(i,i+40).map(async blob=>({blob,event:await readOne(get,blob)})));
      records.push(...batch.filter(x=>x.event));
    }

    const matches=records.filter(({event})=>berlinStamp(event?.recordedAt)===TARGET_DATE+' '+TARGET_TIME);
    if(matches.length!==1){
      return send(res,409,{ok:false,error:'Expected exactly one matching tracking event',matches:matches.length});
    }

    const target=matches[0];
    const deletedEventId=String(target.event.eventId||'');
    await del(target.blob.url||target.blob.pathname);

    let cleanedLinks=0;
    for(const record of records){
      if(record===target)continue;
      const e=record.event;
      let changed=false;
      const next={...e};
      if(deletedEventId&&next.previousBookingEventId===deletedEventId){
        delete next.previousBookingEventId;
        delete next.previousBookingRecordedAt;
        changed=true;
      }
      if(deletedEventId&&next.rebookedByEventId===deletedEventId){
        delete next.rebookedByEventId;
        delete next.releaseConfirmedByRebookingAt;
        if(next.releaseEvidence==='slot_rebooked'){
          delete next.releaseEvidence;
          delete next.releaseDetectedAt;
          delete next.bookingStatus;
        }
        changed=true;
      }
      if(changed){
        await put(record.blob.pathname,JSON.stringify(next),{
          access:'private',contentType:'application/json; charset=utf-8',
          addRandomSuffix:false,allowOverwrite:true
        });
        cleanedLinks++;
      }
    }

    return send(res,200,{
      ok:true,
      deleted:1,
      cleanedLinks,
      recordedAt:target.event.recordedAt,
      appointmentDate:target.event.appointmentDate,
      appointmentTime:target.event.appointmentTime,
      serviceName:target.event.serviceName,
      doctorName:target.event.doctorName
    });
  }catch(e){
    return send(res,500,{ok:false,error:String(e?.message||e)});
  }
};
