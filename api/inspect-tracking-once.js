const PREFIX='medidate-booking-tracking/v3/events/';

let blobApiPromise;
async function blobApi(){
  if(!blobApiPromise)blobApiPromise=import('@vercel/blob');
  return blobApiPromise;
}
function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  res.end(JSON.stringify(body));
}
async function listAll(){
  const {list}=await blobApi();
  const out=[];let cursor;
  do{
    const r=await list({prefix:PREFIX,limit:1000,cursor});
    if(Array.isArray(r?.blobs))out.push(...r.blobs);
    cursor=r?.hasMore?r.cursor:undefined;
  }while(cursor);
  return out;
}
async function readJson(blob){
  const {get}=await blobApi();
  const r=await get(blob.url||blob.pathname,{access:'private',useCache:false});
  if(!r||r.statusCode!==200)return null;
  const text=await new Response(r.stream).text();
  return JSON.parse(text);
}

module.exports=async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{ok:false});
  try{
    const blobs=await listAll();
    const rows=[];
    for(let i=0;i<blobs.length;i+=30){
      const batch=await Promise.all(blobs.slice(i,i+30).map(async blob=>{
        try{return {blob,event:await readJson(blob)}}catch{return null}
      }));
      rows.push(...batch.filter(Boolean));
    }
    rows.sort((a,b)=>String(a.event?.recordedAt||'').localeCompare(String(b.event?.recordedAt||'')));

    const summary=rows.map(({blob,event})=>({
      eventId:event?.eventId||'',
      appointmentDate:event?.appointmentDate||'',
      appointmentTime:event?.appointmentTime||'',
      doctorName:event?.doctorName||'',
      serviceName:event?.serviceName||'',
      bookingStatus:event?.bookingStatus||'booked',
      recordedAt:event?.recordedAt||'',
      pathname:blob?.pathname||''
    }));

    const confirm=String(req.query?.confirm||'');
    if(confirm!=='delete-five-tests-keep-2026-12-04'){
      return send(res,404,{ok:false});
    }

    // One-time cleanup requested by the practice owner:
    // exactly five released test bookings, followed by one final booking for 04.12.2026.
    const firstFive=rows.slice(0,5);
    const keep=rows[5];
    const safe=
      rows.length===6 &&
      firstFive.length===5 &&
      firstFive.every(x=>x.event?.bookingStatus==='released') &&
      keep?.event?.appointmentDate==='2026-12-04';

    if(!safe){
      return send(res,409,{ok:false,error:'Sicherheitsprüfung nicht erfüllt; nichts gelöscht.',count:rows.length,events:summary});
    }

    const {del,put}=await blobApi();
    const deleteTargets=firstFive.map(x=>x.blob?.url||x.blob?.pathname).filter(Boolean);
    if(deleteTargets.length!==5){
      return send(res,409,{ok:false,error:'Nicht alle fünf Testdatensätze eindeutig adressierbar; nichts gelöscht.'});
    }

    await del(deleteTargets);

    // Remove test-history links from the one retained real booking.
    const cleaned={...keep.event};
    cleaned.schemaVersion=Math.max(4,Number(cleaned.schemaVersion)||0);
    cleaned.bookingStatus='booked';
    delete cleaned.releaseDetectedAt;
    delete cleaned.releaseEvidence;
    delete cleaned.releaseConfirmedByRebookingAt;
    delete cleaned.rebookedByEventId;
    delete cleaned.previousBookingEventId;
    delete cleaned.previousBookingRecordedAt;

    await put(keep.blob.pathname,JSON.stringify(cleaned),{
      access:'private',
      contentType:'application/json; charset=utf-8',
      addRandomSuffix:false,
      allowOverwrite:true
    });

    return send(res,200,{
      ok:true,
      deleted:5,
      retained:{
        eventId:cleaned.eventId,
        appointmentDate:cleaned.appointmentDate,
        appointmentTime:cleaned.appointmentTime,
        doctorName:cleaned.doctorName,
        serviceName:cleaned.serviceName,
        bookingStatus:cleaned.bookingStatus,
        recordedAt:cleaned.recordedAt
      }
    });
  }catch(e){
    console.error('inspect tracking failed',{message:e?.message});
    return send(res,500,{ok:false,error:'inspection failed'});
  }
};
