const fs=require('fs');
const assert=require('assert');

const read=p=>fs.readFileSync(p,'utf8');
const index=read('index.html');
const tracking=read('api/tracking.js');
const medidate=read('api/medidate.js');
const session=read('api/session.js');
const booking=read('api/booking.js');
const vercel=read('vercel.json');
const dashboard=read('tracking.html');
const dashboardJs=read('tracking.js');
const admin=read('admin.html');
const adminJs=read('admin.js');
const staff=read('staff-booking.html');
const staffJs=read('staff-booking.js');
const staffAuth=read('api/staff-auth.js');
const staffSession=read('api/staff-session.js');
const staffAuthLib=read('lib/staff-auth.js');
const core=read('lib/medidate-core.js');
const botidClient=read('botid-client-entry.js');
const buildScript=read('scripts/build-seed.js');
const pkg=JSON.parse(read('package.json'));

assert(booking.includes('res.statusCode=410'),'Legacy /api/booking must stay disabled');
assert(!index.includes("fetch('/api/booking'"),'Frontend must not send patient booking data to Vercel');
assert(index.includes("directMediDateRequest('appointments',{method:'POST',body:payloadFor("),'Patient booking must remain browser-direct to mediDate');

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

for(const s of [medidate,tracking,session]){
  assert(!/x-forwarded-for|x-real-ip|__MEDIDATE_REFRESH_RATE__/i.test(s),'Application code must not read or rate-limit by client IP');
}

assert(core.includes("crypto.randomBytes(18).toString('base64url')"),'Tracking proof must use content-free random nonce');
assert(!core.includes('times.push({time,slotToken'),'Public availability must not carry slot token for analytics');
assert(core.includes('TRACKING_PROOF_TTL_MS=12*60*60*1000'),'Tracking proof must have a finite TTL');
assert(core.includes("update('tracking:'+trackingNonce+':'+trackingExp)"),'Tracking proof must bind its expiry');
assert(tracking.includes('trackingExp')&&tracking.includes('exp<=now'),'Tracking API must reject expired proofs');

assert(medidate.includes("return site==='same-origin'"),'mediDate bridge must require an explicit same-origin Fetch Metadata signal');
assert(!medidate.includes("return !site||site==='same-origin'"),'Missing Fetch Metadata must not be trusted');

assert(!medidate.includes("token:s.token"),'General mediDate bridge must never return the bearer token');
assert(medidate.includes("action==='publicSession'||action==='liveSession'")&&medidate.includes("return send(res,410"),'Legacy session actions must be retired');
assert(session.includes("checkBotId"),'Session token endpoint must perform BotID verification');
assert(session.includes("checkLevel:'basic'"),'Session token endpoint must use BotID Basic checks');
assert(session.includes("return site==='same-origin'"),'Session token endpoint must also require same-origin Fetch Metadata');
assert(session.includes("token:s.token"),'Only the dedicated protected session endpoint may return the mediDate bearer token');
assert(index.includes("new URL('/api/session',location.origin)"),'Booking flow must use the protected session endpoint');
assert(dashboardJs.includes("new URL('/api/session',location.origin)"),'Cancellation reconciliation must use the protected session endpoint');
assert(!index.includes("apiGet(force?'liveSession':'publicSession'"),'Booking flow must not use legacy token actions');
assert(!dashboardJs.includes("action',force?'liveSession':'publicSession'"),'Dashboard must not use legacy token actions');
assert(botidClient.includes("path: '/api/session'")&&botidClient.includes("method: 'GET'")&&botidClient.includes("checkLevel: 'basic'"),'BotID client must protect the session endpoint with Basic checks');
assert(buildScript.includes("outfile:path.join(publicDir,'botid-client.js')"),'Static build must bundle the BotID client locally');
assert(buildScript.includes("'staff-booking.html','staff-booking.css','staff-booking.js'"),'Production build must copy the staff booking assets into public');
assert(pkg.dependencies?.botid==='1.5.11','BotID dependency must stay pinned');
assert(pkg.dependencies?.esbuild==='0.28.2','BotID client bundler must stay pinned');

const cfg=JSON.parse(vercel);
const botProxyBase='/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3';
assert((cfg.rewrites||[]).some(x=>x.source===botProxyBase+'/a-4-a/c.js'&&String(x.destination).includes('/bot-protection/v1/challenge')),'BotID challenge rewrite missing');
assert((cfg.rewrites||[]).some(x=>x.source===botProxyBase+'/:path*'&&String(x.destination).includes('/bot-protection/v1/proxy/')),'BotID proxy rewrite missing');
assert((cfg.headers||[]).some(x=>x.source===botProxyBase+'/:path*'&&(x.headers||[]).some(h=>h.key==='X-Frame-Options'&&h.value==='SAMEORIGIN')),'BotID proxy frame header missing');

assert(!dashboard.includes('<style>')&&!dashboard.includes('<script>'),'Tracking page must not contain inline style/script blocks');
assert(!admin.includes('<style>')&&!admin.includes('<script>'),'Admin page must not contain inline style/script blocks');
assert(!dashboard.includes('style=')&&!admin.includes('style='),'Strict-CSP internal pages must not use inline style attributes');
assert(dashboard.includes('/tracking.css')&&dashboard.includes('/tracking.js'),'Tracking page assets must be external');
assert(dashboard.includes('/tracking.js?v=60.10.6'),'Tracking dashboard must cache-bust tracking.js');
assert(dashboard.includes('/botid-client.js?v=60.10.6'),'Tracking dashboard must cache-bust BotID client');
assert(admin.includes('/admin.css')&&admin.includes('/admin.js'),'Admin page assets must be external');
assert(index.includes("const MENOPAUSE_DOCTOR_KEY='vongrone'"),'Menopause doctor must be fixed to Dr. von Grone');
assert(index.includes("if(isMenopauseMode()&&String(r.doctorKey)!==MENOPAUSE_DOCTOR_KEY)continue"),'Menopause availability must exclude other doctors');
assert(index.includes("Die Wechseljahressprechstunde ist ausschließlich bei Dr. med. Friederike von Grone buchbar."),'Final menopause booking guard must reject other doctors');
assert(index.includes("Wechseljahressprechstunde ausschließlich bei dieser Ärztin"),'Menopause doctor UI must expose only the dedicated doctor path');
assert(index.includes("Wechseljahressprechstunde: nur in den festgelegten Privatsprechstunden"),'Menopause availability must be restricted to private consultation windows');
assert(index.includes("normal=allSlots.filter(isPrivateWindowStart)"),'Menopause visibility must stay inside private consultation start windows');
assert(index.includes("if(isMenopauseMode()&&!isPrivateWindowStart(state.selectedSlot))"),'Final menopause booking guard must enforce private consultation windows');
assert(index.includes("return Boolean(byKey.get("),'Menopause booking starts must still require the following 15-minute slot');
assert(index.includes("state.insurance==='SELF' ||")&&index.includes("(state.insurance==='PKV'&&state.patientType==='new')"),'Self-pay and private new patients must reserve 30 minutes');
assert(index.includes("payloadFor(nextTime,nextRow,'[Block 2/2]',false)"),'30-minute bookings must reserve the second 15-minute mediDate block without a second patient email');
assert(index.includes("eMailAddress:sendEmail?patient.email:''"),'Only the first 15-minute block may carry the patient email address');
assert(index.includes("if(state.topicMode==='pregnancy'){")&&index.includes("return state.insurance==='PKV'&&state.patientType==='new';"),'Pregnancy must stay 15 minutes except PKV new-patient first visit, which reserves 30 minutes');
assert((index.match(/addPregnancyButton\(list\);/g)||[]).length>=2,'Pregnancy must be selectable for GKV as well as PKV patients');
assert(index.includes("function pregnancyPrivateNewStartPool(items)"),'Pregnancy must have a shared private-new start-pool helper');
assert(index.includes("(state.insurance==='PKV'&&state.patientType==='new') ||\n   state.insurance==='GKV'"),'GKV pregnancy must use the same start-pool qualification as PKV new pregnancy');
assert(index.includes("normal=state.insurance==='GKV'\n     ?allSlots.slice()\n     :allSlots.filter(maySeeSlot);"),'GKV pregnancy must receive the qualified private-new pregnancy start pool without GKV quota filtering');
assert(index.includes("bis spätestens zur <strong>7. SSW</strong>"),'All pregnancy booking paths must show the SSW-7 contact-practice notice');
assert(index.includes("if(!(state.insurance==='GKV'&&state.topicMode==='pregnancy'))return '';"),'Quarter confirmation must apply to all GKV pregnancy bookings');
assert(index.includes("bookPregOtherPracticeAck"),'GKV pregnancy booking must require an explicit quarter confirmation checkbox');
assert(index.includes("<strong>Hinweis zur Schwangerschaftsbetreuung:</strong> Ich bestätige, dass ich im Kalenderquartal dieses ersten Schwangerschaftstermins wegen dieser Schwangerschaft nicht bereits in einer anderen gynäkologischen Praxis betreut wurde und in diesem Quartal auch keine entsprechende Betreuung dort in Anspruch nehmen werde."),'GKV pregnancy confirmation checkbox must use the approved wording');
assert(!index.includes("Für Schwangerschaften werden Ihnen dieselben geeigneten Starttermine angezeigt wie einer privatversicherten Neupatientin."),'GKV pregnancy confirmation must not be shown before the booking form');
assert(index.includes("GKV Schwangerschaft: keine andere gyn. Schwangerschaftsbetreuung im Quartal bestätigt"),'Confirmed GKV pregnancy quarter status must be recorded in the mediDate booking comment');
assert(index.includes("function isQuarter45Start(slot)"),'Quarter-to-hour slots must have a dedicated visibility guard');
assert(index.includes("if(!needs30MinuteBlock())return items.filter(x=>!isQuarter45Start(x));"),':45 must never be shown as a regular online start');
assert(index.includes("if(Number(x.duration)!==15||isQuarter45Start(x))return false;"),':45 must never be shown as a 30-minute start');
assert(index.includes("if(isQuarter45Start(state.selectedSlot))"),'Final booking guard must reject :45 as a start time');
assert(index.includes("String(slot?.date||'')>='2026-11-05'")&&index.includes("String(slot?.date||'')>='2026-11-12'"),'Thursday private consultation start dates must be fixed');
assert(index.includes("isHamburgPublicHolidayISO(slot?.date)"),'Thursday private consultation windows must exclude Hamburg public holidays');
assert(index.includes("if(isHamburgPublicHolidayISO(day))continue;"),'All Hamburg public holidays must be excluded from visible appointment candidates');
assert(index.includes("if(isHamburgPublicHolidayISO(state.selectedSlot?.date))"),'Final booking guard must reject Hamburg public holidays');
assert(index.includes("mins<17*60"),'Afternoon private-only protection must end before 17:00');
assert(index.includes("mins<11*60"),'Morning private-only protection must end before 11:00');
assert(staff.includes('/staff-booking.css')&&staff.includes('/staff-booking.js?v=60.10.15'),'Staff booking assets must be external and versioned');
assert(!staff.includes('<style>')&&!staff.includes('<script>'),'Staff booking page must not contain inline style/script blocks');
assert(staffAuthLib.includes('HttpOnly')&&staffAuthLib.includes('SameSite=Strict')&&staffAuthLib.includes('Secure'),'Staff auth cookie must be HttpOnly, Secure and SameSite Strict');
assert(staffSession.includes('isAuthenticated(req)'),'Staff mediDate session must require staff authentication');
assert(staffSession.includes("checkLevel:'basic'"),'Staff mediDate session must retain BotID Basic checks');
assert(staffJs.includes("new URL('/api/staff-session',location.origin)"),'Staff browser must use the staff-only mediDate session endpoint');
assert(staffJs.includes("medidate('appointments',{method:'POST'"),'Staff patient bookings must be browser-direct to mediDate');
assert(!staffJs.includes("fetch('/api/booking'")&&!staffJs.includes("fetch('/api/staff-booking'"),'Staff patient identity must not be posted to a Vercel booking endpoint');
assert(staffJs.includes('const CHAIN_WEEKS=[7,10,14,18,22,26,30,32,34,36,38,40]'),'Pregnancy chain SSW schedule must match the practice specification');
assert(staffJs.includes('(ssw-2)*7'),'Pregnancy chain must calculate SSW from the entered conception date');
assert(staffJs.includes("r.ssw===22||r.ssw===26||(r.ssw===14&&test)"),'22nd and 26th SSW and optional 14th SSW first-trimester test must reserve 30 minutes');
assert(staffJs.includes("r.ssw===26")&&staffJs.includes("minutesOf(x.time)>=12*60"),'26th SSW glucose-test appointment must be morning-only');
assert(staffJs.includes('1. Trimestertest 199,11 €'),'Optional first-trimester self-pay price must be shown');
assert(staffJs.includes('const chosen=regular.length?regular:eligible.filter(is45);'),':45 starts must be fallback-only within a pregnancy SSW');
assert(staffJs.includes("route==='PKV'&&pat==='new'&&i===firstFuture"),'First future pregnancy appointment for a PKV new patient must reserve 30 minutes');
assert(staffJs.includes("payload(second,live.second,p,comment+' [Block 2/2]',false)"),'Second 15-minute staff booking block must suppress the second patient email');
assert(staff.includes('id="chainConfirm"')&&!staffJs.includes('data-chain-book'),'Staff pregnancy chain must use one explicit review confirmation without per-row booking checkboxes');
assert(staff.includes('<th>SSW</th><th>Zielzeitraum</th><th>Dauer / Besonderheit</th><th>Termin</th>'),'Pregnancy chain table must retain the requested four-column structure');
assert(staffJs.includes("manual.textContent='Termin muss manuell gebucht werden'"),'Unavailable SSW rows must state manual booking only under Dauer / Besonderheit');
assert(!staffJs.includes("mangels freier Zeit manuell gebucht werden"),'Pregnancy-chain summary must not duplicate manual-booking warnings above the table');
assert(staffJs.includes("const terminTd=document.createElement('td');"),'Pregnancy chain must create a dedicated Termin table cell');
assert(staffJs.includes("tr.append(sswTd,rangeTd,detailTd,terminTd);"),'Every calculated SSW must render as exactly four table cells');
assert(staffJs.includes("function chainOptionText(x){return deDate(x.date)+' · '+x.time.replace('.',':')+' Uhr'}"),'Pregnancy-chain Termin column must show only date and time');
assert(staffJs.includes("const plannedSlot=candidates[0]||null;"),'Pregnancy chain must calculate one fixed planned appointment per SSW');
assert(!staffJs.includes('data-chain-index'),'Pregnancy chain must not render appointment dropdowns');
assert(staffJs.includes("chainBody.replaceChildren()")&&staffJs.includes("document.createElement('tr')"),'Pregnancy chain rows must be rendered with DOM table elements, not fragile tbody innerHTML');
assert(staffJs.includes("selected.push({idx,row,slot:row.plannedSlot});"),'Pregnancy booking must use the reviewed fixed planned appointment');
assert(staffJs.includes("['SPIRALE','Spirale Einlage · 216,69 €','spirale']"),'Staff self-pay booking types must include spiral insertion');
assert(staffJs.includes("if(topic==='spirale')return false;"),'Spiral insertion must remain a 15-minute appointment');
assert(staffJs.includes("if(topic!=='spirale'&&is45(x))return false;"),'Spiral insertion may use a :45 edge slot while other single bookings keep the :45 restriction');
assert(staffJs.includes("if(!prev||minutesOf(x.time)>minutesOf(prev.time))byDay.set(x.date,x);"),'Spiral insertion must expose only the latest free slot per day');
assert(staffJs.includes("servicePattern:/spiral|intrauterin|iud/i"),'Spiral insertion must use its dedicated mediDate service when configured');
assert(staffJs.includes("Spirale Einlage: Es wird pro Tag ausschließlich der späteste freie Randtermin angezeigt."),'Staff UI must explain the spiral edge-slot rule');
assert(!staffJs.includes("ist in mediDate derzeit nicht eindeutig konfiguriert."),'Staff single appointments must not fail on duplicate service-name matches');
assert(staffJs.includes("if(!matches.length)return [];"),'Staff-only direct service discovery must treat missing services as unavailable, not ambiguous');
assert(staffJs.includes("for(const svc of matches)"),'Staff-only direct service discovery must aggregate all enabled matching mediDate services');
assert(staffJs.includes("for(const g of (bundle?.groups||[]))"),'Menopause staff availability must use the same public live bundle as the online booking app');
assert(staffJs.includes("if(x.doctorKey!=='vongrone')continue;"),'Menopause staff availability must remain restricted to Dr. von Grone');
assert(staffJs.includes("route==='GKV'\n     ?[['vorsorge','Vorsorge','regular'],['followup','Tumornachsorge','regular']]"),'GKV staff single-service menu must match the public booking app');
assert(staffJs.includes("['SPIRALE','Spirale Einlage · 216,69 €','spirale']"),'Spiral insertion must remain an additional staff-only self-pay booking type');
assert(staffJs.includes("r.booked=true")&&staffJs.includes("✓ Gebucht"),'Successfully booked chain appointments must be persistently marked in the current session');
assert(staffJs.includes("if(row?.past||row?.booked||!row?.plannedSlot)continue;"),'Past, already booked, or manually-booked chain rows must never be automatically rebooked');
assert(staffJs.includes("const openAuto=chainRowsState.some(r=>!r.past&&r.plannedSlot&&!r.booked);"),'Global chain confirmation may enable booking only when an unbooked planned appointment remains');
assert(staffJs.includes("$('#chainConfirm').checked=false"),'Chain confirmation must reset after booking/review');
assert(staffJs.includes("Für jeden gebuchten SSW-Termin erhält die Patientin eine eigene E-Mailbestätigung."),'Staff UI must state one patient email confirmation per booked SSW appointment');
assert(staffJs.includes("payload(slot,live.first,p,firstComment,true)"),'Every logical appointment must send the patient email on its first 15-minute block');
assert(botidClient.includes("path: '/api/staff-session'")&&botidClient.includes("path: '/api/staff-auth'"),'BotID client must protect staff login/session endpoints');
new Function(staffJs);
new Function(staffAuth);
new Function(staffSession);
new Function(staffAuthLib);
assert(dashboardJs.length>1000&&adminJs.length>100,'External internal-page scripts must be present');

for(const source of ['/tracking.js','/botid-client.js']){
  const entry=(cfg.headers||[]).find(x=>x.source===source);
  assert(entry,source+' cache header rule missing');
  const cc=(entry.headers||[]).find(x=>x.key==='Cache-Control')?.value||'';
  assert(cc.includes('no-store'),source+' must not be cached');
}

for(const source of ['/admin.html','/praxis','/tracking.html','/praxis-auswertung','/staff-booking.html','/ma-buchung']){
  const entry=(cfg.headers||[]).find(x=>x.source===source);
  assert(entry,source+' strict header rule missing');
  const csp=(entry.headers||[]).find(x=>x.key==='Content-Security-Policy')?.value||'';
  assert(csp.includes("script-src 'self'")&&!csp.includes("'unsafe-inline'"),source+' must forbid inline script');
  assert(csp.includes("style-src 'self'")&&!csp.includes("'unsafe-inline'"),source+' must forbid inline style');
}

console.log('Security regression checks passed.');
