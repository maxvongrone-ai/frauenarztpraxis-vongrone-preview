const fs=require('fs');
const assert=require('assert');

const read=p=>fs.readFileSync(p,'utf8');
const index=read('index.html');
const tracking=read('api/tracking.js');
const medidate=read('api/medidate.js');
const booking=read('api/booking.js');
const vercel=read('vercel.json');
const dashboard=read('tracking.html');
const dashboardJs=read('tracking.js');
const admin=read('admin.html');
const adminJs=read('admin.js');
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

assert(dashboardJs.includes("p.get('a')")&&dashboardJs.includes("p.get('d')"),'Dashboard must separate auth and decryption secrets');
assert(dashboardJs.includes("crypto.subtle.decrypt"),'Dashboard must decrypt only in the browser');
assert(dashboard.includes("Stornierungen prüfen"),'Encrypted dashboard must retain cancellation reconciliation');
assert(dashboardJs.includes("slot_reappeared_in_medidate"),'Cancellation evidence must be evaluated in the practice browser');
assert(dashboardJs.includes("fetchAvailability"),'Practice browser must compare decrypted bookings directly with mediDate');
assert(dashboardJs.includes("action','replace"),'Encrypted cancellation status must be persisted without plaintext');
assert(tracking.includes("replaceEncryptedEvent"),'Tracking API must only overwrite opaque encrypted events');
assert(!tracking.includes("appointmentDate:String(body"),'Tracking API must not receive plaintext appointment metadata during reconciliation');

assert(!vercel.includes('praxis-auswertung-juyY7KFzMJIXC4Zyd4T7OdOR4swyhBr1'),'Old exposed tracking path must stay removed');
assert(!tracking.includes('c125504d58925765cf1a6d9f6149842696d0c0618bc5293f65e842609e24ad02'),'Old tracking access hash must stay revoked');

for(const s of [medidate,tracking]){
  assert(!/x-forwarded-for|x-real-ip|__MEDIDATE_REFRESH_RATE__/i.test(s),'Application code must not read or rate-limit by client IP');
}

assert(core.includes("crypto.randomBytes(18).toString('base64url')"),'Tracking proof must use content-free random nonce');
assert(!core.includes('times.push({time,slotToken'),'Public availability must not carry slot token for analytics');
assert(core.includes('TRACKING_PROOF_TTL_MS=12*60*60*1000'),'Tracking proof must have a finite TTL');
assert(core.includes("update('tracking:'+trackingNonce+':'+trackingExp)"),'Tracking proof must bind its expiry');
assert(tracking.includes('trackingExp')&&tracking.includes('exp<=now'),'Tracking API must reject expired proofs');

assert(medidate.includes("return site==='same-origin'"),'mediDate bridge must require an explicit same-origin Fetch Metadata signal');
assert(!medidate.includes("return !site||site==='same-origin'"),'Missing Fetch Metadata must not be trusted');

assert(!dashboard.includes('<style>')&&!dashboard.includes('<script>'),'Tracking page must not contain inline style/script blocks');
assert(!admin.includes('<style>')&&!admin.includes('<script>'),'Admin page must not contain inline style/script blocks');
assert(!dashboard.includes('style=')&&!admin.includes('style='),'Strict-CSP internal pages must not use inline style attributes');
assert(dashboard.includes('/tracking.css')&&dashboard.includes('/tracking.js'),'Tracking page assets must be external');
assert(admin.includes('/admin.css')&&admin.includes('/admin.js'),'Admin page assets must be external');
assert(index.includes("const MENOPAUSE_DOCTOR_KEY='vongrone'"),'Menopause doctor must be fixed to Dr. von Grone');
assert(index.includes("if(isMenopauseMode()&&String(r.doctorKey)!==MENOPAUSE_DOCTOR_KEY)continue"),'Menopause availability must exclude other doctors');
assert(index.includes("Die Wechseljahressprechstunde ist ausschließlich bei Dr. med. Friederike von Grone buchbar."),'Final menopause booking guard must reject other doctors');
assert(index.includes("Wechseljahressprechstunde ausschließlich bei dieser Ärztin"),'Menopause doctor UI must expose only the dedicated doctor path');
assert(index.includes("Eine zusätzliche Bindung an Privatsprechstundenfenster"),'Menopause availability must document removal of private-window restriction');
assert(!index.includes("normal=allSlots.filter(x=>maySeeSlot(x)&&isPrivateOnlyWindow(x))"),'Menopause visibility must not be restricted to private-only windows');
assert(!index.includes("!isPrivateOnlyWindow(state.selectedSlot)||!isPrivateOnlyWindow(nextSlot)"),'Final menopause booking check must not require private-only windows');
assert(index.includes("return Boolean(byKey.get("),'Menopause booking starts must still require the following 15-minute slot');
assert(dashboardJs.length>1000&&adminJs.length>100,'External internal-page scripts must be present');

const cfg=JSON.parse(vercel);
for(const source of ['/admin.html','/praxis','/tracking.html','/praxis-auswertung']){
  const entry=(cfg.headers||[]).find(x=>x.source===source);
  assert(entry,source+' strict header rule missing');
  const csp=(entry.headers||[]).find(x=>x.key==='Content-Security-Policy')?.value||'';
  assert(csp.includes("script-src 'self'")&&!csp.includes("'unsafe-inline'"),source+' must forbid inline script');
  assert(csp.includes("style-src 'self'")&&!csp.includes("'unsafe-inline'"),source+' must forbid inline style');
}

console.log('Security regression checks passed.');
