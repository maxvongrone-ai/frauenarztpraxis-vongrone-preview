const fs=require('fs');
const assert=require('assert');

const read=p=>fs.readFileSync(p,'utf8');
const index=read('index.html');
const tracking=read('api/tracking.js');
const medidate=read('api/medidate.js');
const booking=read('api/booking.js');
const vercel=read('vercel.json');
const dashboard=read('tracking.html');
const core=read('lib/medidate-core.js');

assert(booking.includes('res.statusCode=410'),'Legacy /api/booking must stay disabled');
assert(!index.includes("fetch('/api/booking'"),'Frontend must not send patient booking data to Vercel');
assert(index.includes("directMediDateRequest('appointments',{method:'POST',body:payload})"),'Patient booking must remain browser-direct to mediDate');

assert(index.includes("alg:'ECDH-P256+A256GCM'"),'Tracking must be encrypted in the browser');
assert(index.includes('trackingNonce')&&index.includes('trackingProof'),'Opaque tracking proof must be present');
assert(!index.includes('slotToken'),'Frontend tracking must not expose decryptable slot metadata to Vercel');
assert(!tracking.includes('openSlot'),'Tracking API must not decrypt appointment slot metadata');
assert(tracking.includes("storage:'vercel-blob-private-e2ee'"),'Tracking storage must be marked E2EE');
assert(tracking.includes("ECDH-P256+A256GCM"),'Tracking API must accept only encrypted envelopes');

assert(dashboard.includes("p.get('a')")&&dashboard.includes("p.get('d')"),'Dashboard must separate auth and decryption secrets');
assert(dashboard.includes("crypto.subtle.decrypt"),'Dashboard must decrypt only in the browser');

assert(!vercel.includes('praxis-auswertung-juyY7KFzMJIXC4Zyd4T7OdOR4swyhBr1'),'Old exposed tracking path must stay removed');
assert(!tracking.includes('c125504d58925765cf1a6d9f6149842696d0c0618bc5293f65e842609e24ad02'),'Old tracking access hash must stay revoked');

for(const s of [medidate,tracking]){
  assert(!/x-forwarded-for|x-real-ip|__MEDIDATE_REFRESH_RATE__/i.test(s),'Application code must not read or rate-limit by client IP');
}

assert(core.includes("crypto.randomBytes(18).toString('base64url')"),'Tracking proof must use content-free random nonce');
assert(!core.includes('times.push({time,slotToken'),'Public availability must not carry slot token for analytics');

console.log('Security regression checks passed.');
