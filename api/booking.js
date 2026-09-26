module.exports=async function handler(req,res){
  res.statusCode=410;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.end(JSON.stringify({
    ok:false,
    error:'Dieser Endpunkt verarbeitet keine Patientendaten mehr. Die Buchung erfolgt direkt vom Browser zu mediDate.'
  }));
};
