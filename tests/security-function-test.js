const fs=require('fs');
const assert=require('assert');

const read=p=>fs.readFileSync(p,'utf8');
const index=read('index.html');
const tracking=read('api/tracking.js');
const privateNewQuota=read('api/private-new-quota.js');
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
assert(dashboard.includes("Buchungsstatus prüfen"),'Encrypted dashboard must retain booking-status reconciliation');
assert(dashboardJs.includes("slot_reappeared_in_medidate"),'Cancellation evidence must be evaluated in the practice browser');
assert(dashboardJs.includes("fetchAvailability"),'Practice browser must compare decrypted bookings directly with mediDate');
assert(dashboardJs.includes("action','replace"),'Encrypted cancellation status must be persisted without plaintext');
assert(tracking.includes("replaceEncryptedEvent"),'Tracking API must only overwrite opaque encrypted events');
assert(!tracking.includes("appointmentDate:String(body"),'Tracking API must not receive plaintext appointment metadata during reconciliation');
assert(index.includes("function isPrivateNewDailyLimited()")&&index.includes("state.insurance==='PKV'&&state.patientType==='new'"),'Private-new daily limit must apply only to PKV new patients');
assert(index.includes("reservePrivateNewDay(state.selectedSlot)"),'PKV new booking must reserve its calendar day before the mediDate POST');
assert(index.includes("privateNewBookingStarted=true")&&index.includes("confirmPrivateNewDay(privateNewReservation)"),'Successful PKV new booking must confirm the daily reservation');
assert(index.includes("privateNewBlockedDates.has(String(x.date||''))"),'Already occupied PKV-new days must be removed from visible slots');
assert(privateNewQuota.includes("const PREFIX='medidate-private-new-daily/v1/days/'"),'Daily quota must use its own private Blob namespace');
assert(privateNewQuota.includes("allowOverwrite:Boolean(allowOverwrite)")&&privateNewQuota.includes("writeMarker(marker,false)"),'Daily reservation creation must be non-overwriting to prevent concurrent double booking');
assert(privateNewQuota.includes("buildFastPublicBundle"),'Daily quota must reconcile cancellations against fast live mediDate availability');
assert(!/firstName|lastName|birthDate|eMailAddress|email/i.test(privateNewQuota),'Daily quota endpoint must not process patient identity/contact data');
assert(dashboardJs.includes("action','admin-sync"),'Encrypted practice dashboard must synchronize existing active PKV new bookings into the daily quota without identity data');
assert(dashboardJs.includes("eventType:'pvs_booking_detected'"),'Dashboard must persist direct Praxis/PVS disappearance events only after browser-side comparison');
assert(dashboardJs.includes("function isPrivateConsultation(e)")&&dashboardJs.includes("iso>='2026-11-05'")&&dashboardJs.includes("iso>='2026-11-12'"),'Analytics must recognize all configured private consultation windows');
assert(dashboardJs.includes("new URL('/api/tracking',location.origin)")&&dashboardJs.includes("action','append"),'Praxis/PVS events must be appended as encrypted envelopes from the authorized practice browser');
assert(tracking.includes("String(req.query?.action||'')==='append'")&&tracking.includes("if(!authorized(req))return send(res,401"),'Admin append path must require the existing tracking authorization secret');

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
assert(dashboard.includes('/tracking.js?v=60.10.18'),'Tracking dashboard must cache-bust tracking.js');
assert(dashboard.includes('/botid-client.js?v=60.10.10'),'Tracking dashboard must cache-bust BotID client');
assert(admin.includes('/admin.css')&&admin.includes('/admin.js'),'Admin page assets must be external');
assert(index.includes("const MENOPAUSE_DOCTOR_KEY='vongrone'"),'Menopause doctor must be fixed to Dr. von Grone');
assert(index.includes("if(isMenopauseMode()&&String(r.doctorKey)!==MENOPAUSE_DOCTOR_KEY)continue"),'Menopause availability must exclude other doctors');
assert(index.includes("Die Wechseljahressprechstunde ist ausschließlich bei Dr. med. Friederike von Grone buchbar."),'Final menopause booking guard must reject other doctors');
assert(index.includes("Wechseljahressprechstunde ausschließlich bei dieser Ärztin"),'Menopause doctor UI must expose only the dedicated doctor path');
assert(index.includes("Wechseljahressprechstunde: nur in den festgelegten Privatsprechstunden"),'Menopause availability must be restricted to private consultation windows');
assert(index.includes("normal=allSlots.filter(isPrivateWindowStart)"),'Menopause visibility must stay inside private consultation start windows');
assert(index.includes("if(isMenopauseMode()&&!isPrivateWindowStart(state.selectedSlot))"),'Final menopause booking guard must enforce private consultation windows');
assert(index.includes("return Boolean(byKey.get("),'Menopause booking starts must still require the following 15-minute slot');
assert(index.includes("function isSelfPayBreast(){")&&index.includes("if(state.topicMode==='pregnancy'||isSelfPayBreast()){")&&index.includes("return state.patientType==='new';"),'Pregnancy and self-pay breast ultrasound must be 15 minutes for existing patients and 30 minutes for new patients');
assert(index.includes("payloadFor(nextTime,nextRow,'[Block 2/2]',false)"),'30-minute bookings must reserve the second 15-minute mediDate block without a second patient email');
assert(index.includes("eMailAddress:sendEmail?patient.email:''"),'Only the first 15-minute block may carry the patient email address');
assert(index.includes("if(state.topicMode==='pregnancy'||isSelfPayBreast()){")&&index.includes("return state.patientType==='new';"),'Pregnancy new patients must reserve 30 minutes regardless of insurance route; existing pregnancy appointments remain 15 minutes');
assert((index.match(/addPregnancyButton\(list\);/g)||[]).length>=2,'Pregnancy must be selectable for GKV as well as PKV patients');
assert(index.includes("function pregnancyPrivateNewStartPool(items)"),'Pregnancy must have a shared private-new start-pool helper');
assert(index.includes("if(state.topicMode==='pregnancy'&&state.patientType==='new'){"),'Only pregnancy new patients may use the consecutive 30-minute start-pool qualification');

assert(!index.includes('selectGkvVorsorgePrivateShortTerm')&&!index.includes('isGkvVorsorgePrivateShortTerm'),'Short-term GKV Vorsorge private consultation release must be removed');
assert(index.includes("const permitted=state.insurance==='GKV'&&state.topicMode!=='pregnancy'?list.filter(x=>!isPrivateOnlyWindow(x)):list;"),'GKV private-window restriction must exclude pregnancy from the ban');
assert(!index.includes("if(state.insurance==='GKV'&&(isPrivateOnlyWindow(x)||isPrivateOnlyWindow(next)))return false;"),'GKV pregnancy new-patient 30-minute starts must not be blocked by private hours');
assert(index.includes("if(state.insurance==='GKV'&&state.topicMode!=='pregnancy'&&(\n   isPrivateOnlyWindow(state.selectedSlot)||"),'Final GKV booking guard must apply only outside pregnancy');
assert(index.includes("needs30MinuteBlock()&&isPrivateOnlyWindow({...state.selectedSlot,time:add15DotTime(state.selectedSlot.time)})"),'Final GKV booking guard must reject a second 15-minute block inside private consultation');
const policyForGkv=require('../lib/booking-policy');
for(const [date,time,expected] of [
  ['2026-10-14','14.15',false],['2026-10-14','14.30',true],['2026-10-14','15.45',true],['2026-10-14','16.45',true],['2026-10-14','17.00',false],
  ['2026-11-05','08.30',false],['2026-11-05','14.30',true],['2026-11-05','16.45',true],['2026-11-05','17.00',false],
  ['2026-11-12','08.30',true],['2026-11-12','10.45',true],['2026-11-12','11.00',false]
]){
  assert.strictEqual(policyForGkv.isPrivateOnlyWindow({date,time}),expected,'Private-window detection mismatch: '+date+' '+time);
}
const gkvPregnancySlots=[
  ['2026-12-02','14.15'],['2026-12-02','14.30'],['2026-12-02','15.45'],['2026-12-02','16.45'],['2026-12-02','17.00'],
  ['2026-12-03','08.30'],['2026-12-03','10.45'],['2026-12-03','11.00'],['2026-12-03','14.30'],['2026-12-03','17.00']
].map(([date,time])=>({date,time,doctorId:'vongrone',serviceId:'vorsorge',duration:15}));
const gkvPregnancyVisible=policyForGkv.visibleForContext(gkvPregnancySlots,gkvPregnancySlots,{route:'GKV',patientType:'existing',topicMode:'pregnancy'},new Date('2026-11-30T09:00:00+01:00'));
assert(gkvPregnancyVisible.length>0,'GKV pregnancy must retain regular online slots');
assert(gkvPregnancyVisible.some(s=>policyForGkv.isPrivateOnlyWindow(s)),'GKV pregnancy must have private-window booking access (including existing and new patients)');
const pregnancyNewVisible=policyForGkv.visibleForContext(gkvPregnancySlots,gkvPregnancySlots,{route:'GKV',patientType:'new',topicMode:'pregnancy'},new Date('2026-11-30T09:00:00+01:00'));
assert(pregnancyNewVisible.some(s=>policyForGkv.isPrivateOnlyWindow(s)),'GKV pregnancy new patient must see eligible private windows');
const regularGkvSlots=gkvPregnancySlots.map(s=>({...s,date:s.date==='2026-12-02'?'2026-12-23':'2026-12-24'}));
const regularGkvVisible=policyForGkv.visibleForContext(regularGkvSlots,regularGkvSlots,{route:'GKV',patientType:'existing',topicMode:'regular'},new Date('2026-11-30T09:00:00+01:00'));
assert(regularGkvVisible.every(s=>!policyForGkv.isPrivateOnlyWindow(s)),'Non-pregnant GKV patients must remain blocked from private windows');
const privateWindowSlots=(day)=>['14.30','15.00','15.30','16.00'].map(time=>({date:day,time,doctorId:'vongrone',serviceId:'vorsorge',duration:15}));
const futurePregContext={route:'GKV',patientType:'existing',topicMode:'pregnancy'};
const nowForShares=new Date('2026-11-30T09:00:00+01:00');
for(const [day,expectedPrivateCount] of [['2026-12-02',4],['2026-12-09',2]]){
  const slots=privateWindowSlots(day);
  const visible=policyForGkv.visibleForContext(slots,slots,futurePregContext,nowForShares);
  assert.strictEqual(visible.length,expectedPrivateCount,'GKV pregnancy staged private release mismatch '+day);
}
assert(index.includes("function privateWindowReleaseShare(slot){")&&index.includes("if(lead<=2)return 1;")&&index.includes("if(lead<7)return 2/3;")&&index.includes("return 1/2;"),'Private consultation release must be 1/2 normally, 2/3 inside one week and 100 percent from two days before the appointment');
assert(index.includes("const privateCandidates=allSlots.filter(x=>isPrivateOnlyWindow(x)&&maySeeSlot(x));")&&index.includes("const privateReleased=keepReleasedPrivateWindowFraction(privateCandidates,allSlots);"),'GKV pregnancy must use the existing staged private-window release');
assert(index.includes("if(isSelfPayBreast()){")&&index.includes("const privateCandidates=allSlots.filter(x=>isPrivateOnlyWindow(x)&&maySeeSlot(x));"),'Self-pay breast ultrasound must receive the same staged access to private consultation slots');
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
assert(staff.includes('/staff-booking.css')&&staff.includes('/staff-booking.js?v=60.10.17'),'Staff booking assets must be external and versioned');
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
assert(staffJs.includes("select.dataset.chainIndex=String(i);"),'Every open pregnancy-chain row must render an appointment dropdown');
assert(staffJs.includes("chainBody.replaceChildren()")&&staffJs.includes("document.createElement('tr')"),'Pregnancy chain rows must be rendered with DOM table elements, not fragile tbody innerHTML');
assert(staffJs.includes("selected.push({idx,row,slot:row.plannedSlot});"),'Pregnancy booking must use the reviewed fixed planned appointment');
assert(staff.includes('id="refreshChain"'),'Pregnancy chain must expose a PVS availability refresh action');
assert(staffJs.includes("$('#refreshChain').onclick=refreshChainAvailability"),'PVS refresh action must be wired to the pregnancy chain');
assert(staffJs.includes("const url='/api/medidate?action=liveBundle'+(force?'&fresh='+encodeURIComponent(Date.now()):'');"),'Forced staff availability refresh must bypass stale cached liveBundle URLs');
assert(staffJs.includes("const kept=old?candidates.find(x=>chainSlotKey(x)===chainSlotKey(old)):null;"),'Refreshing pregnancy availability must preserve the selected alternative while it remains free');
assert(staffJs.includes("option.textContent='Kein Termin verfügbar';"),'Unavailable SSW rows must still show a disabled appointment dropdown');
assert(staffJs.includes("Pro SSW können Sie im Dropdown einen Alternativtermin wählen."),'Staff UI must explain pregnancy alternative-time selection');
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
assert(staffJs.includes("route==='GKV'\n     ?[['vorsorge','Vorsorge','regular'],['followup','Tumornachsorge','regular'],['vorsorge','Schwangerschaft','pregnancy']]"),'GKV staff single-service menu must include pregnancy for existing and new patients');
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


const vm=require('node:vm');
const testContext=vm.createContext({});
const dashboardStart=dashboardJs.indexOf("$('#currentUrl').textContent");
assert(dashboardStart>0,'Practice tracking helpers must be testable without running the dashboard');
vm.runInContext(dashboardJs.slice(0,dashboardStart)+String.fromCharCode(10)+
 "globalThis.trackingTest={activeOnlineSlotKeys,visibleTrackingEvents,pvsDisappearanceExplained,setCurrent(rows){current=rows}};",testContext);
const duplicateTest=testContext.trackingTest;
const booking30={eventType:'booking_completed',bookingStatus:'booked',appointmentDate:'2026-12-21',appointmentTime:'12.00',doctorId:'513',duration:30,recordedAt:'2026-10-10T07:00:00.000Z'};
const pvsAt=(time,doctorId='513')=>({eventType:'pvs_booking_detected',bookingStatus:'pvs',appointmentDate:'2026-12-21',appointmentTime:time,doctorId,duration:15});
const testEvents=[booking30,pvsAt('12.00'),pvsAt('12.15'),pvsAt('12.30'),pvsAt('12.15','512')];
assert(duplicateTest.activeOnlineSlotKeys(testEvents).has('2026-12-21|513|735'),'30-minute online booking must cover its second block');
assert.strictEqual(duplicateTest.visibleTrackingEvents(testEvents).length,3,'Matching PVS notifications must be suppressed, not other times/doctors');
duplicateTest.setCurrent(testEvents);
assert(duplicateTest.pvsDisappearanceExplained('2026-12-21|513|735',duplicateTest.activeOnlineSlotKeys(testEvents)),'PVS detection must recognize older bookings and second-block matches');
assert.strictEqual(duplicateTest.visibleTrackingEvents([{...booking30,duration:15},pvsAt('12.15')]).length,2,'A 15-minute booking must not hide the following unrelated PVS slot');
assert.strictEqual(duplicateTest.visibleTrackingEvents([{...booking30,bookingStatus:'released'},pvsAt('12.15')]).length,2,'Released bookings must not hide independent PVS events');

// Performance regression: the fast endpoints request only fresh free/busy slots.
assert(core.includes('async function buildFastPublicBundle(onlyServiceKey=null)'),'Fast live schedule path must exist');
assert(core.includes('const FAST_SERVICE_IDS=Object.freeze({vorsorge:1950,contraception:1952,followup:1973,breast:1974})'),'Fast path must use allow-listed service IDs');
assert(core.includes('const FAST_DOCTOR_IDS=Object.freeze({moxter:512,vongrone:513})'),'Fast path must use known doctor IDs');
assert(core.includes('await Promise.allSettled(keys.map(async key=>'),'Multi-service schedule checks must settle independently');
assert(core.includes('const s=await bootstrap(false);'),'Fast fetch must keep validated practice/session bootstrap');
assert(medidate.includes("await buildFastPublicBundle(serviceKey)"),'Selected service must use fast provider schedule checks');
assert(medidate.includes("if(action==='liveSelection'){"),'Combined IGeL service availability must have fast endpoint');
assert(index.includes("key==='all'?'liveSelection':'liveService'"),'Selected calendar must use allow-listed provider-backed live service');
assert(!index.includes("setTimeout(()=>deploymentPublicBundle().catch(()=>{}),0);"),'Startup must not launch a competing full-bundle background request');
// Live appointments no longer wait for Vercel serial calls or tracking proof generation.
assert(index.includes("source:'mediDate-server-verified'"),'Live calendar must only mark provider-backed slots as confirmed');
assert(index.includes("const DIRECT_SERVICE_IDS=Object.freeze({vorsorge:1950,contraception:1952,followup:1973,breast:1974})"),'Direct service mapping must stay on approved services');
assert(index.includes("const DIRECT_DOCTOR_KEYS=Object.freeze({'512':'moxter','513':'vongrone'})"),'Direct doctor mapping must stay restricted');
assert(index.includes("await ensureTrackingProofForSlot(state.selectedSlot)"),'A fresh tracking proof must be obtained before any booking');
assert(index.includes("void ensureTrackingProofForSlot(slot).catch(()=>{})"),'Tracking proof is prefetched after selecting a time');
assert(medidate.includes("if(action==='trackingProof'){"),'Single tracking proof must be issued separately');
assert(medidate.includes("const nonce=crypto.randomBytes(18).toString('base64url')"),'Tracking nonces must be unique');
assert(index.includes("let directSessionPromise=null"),'Concurrent direct session starts should be deduplicated');
// Regression: never present cached availability as confirmed slots.
assert(index.includes("const live=await apiGet(key==='all'?'liveSelection':'liveService'"),'Patient availability must request fresh mediDate data while storing shared verified preview');
assert(index.includes("cache:action==='snapshot'?'default':'no-store'"),'Provider availability and unique proofs bypass cache while anonymous snapshots can be CDN-cached');
assert(medidate.includes("if(action==='liveService'){"),'Selected-service live endpoint must be enabled');
assert(medidate.includes("{cache:'no-store, max-age=0',cdn:'no-store',vercel:'no-store'}"),'Proof-bearing live availability must never be cached across patients');
assert(index.includes("Der Termin wird vor der Buchung noch einmal direkt bei mediDate geprüft."),'Calendar must explain that last-minute changes can occur');
assert(index.includes("refreshPrivateNewBlockedDates(false).then(()=>{state.privateNewQuotaVerified=true;return true})"),'Private new-patient quota read must start independently of live calendar');
assert(index.includes("const live=await startSelectedAvailability();")&&index.includes("void quotaCheck.then(ok=>"),'Day quota must not block the browser-direct calendar');
assert(!index.includes("Das Tageskontingent für private Neupatientinnen konnte gerade nicht sicher geprüft werden."),'Quota reconciliation failure must no longer blanket-block calendar');
assert(!index.includes("presentAvailableDays(rawFromRegularAvailability(cached)"),'Cached regular slots must not be presented');
assert(!index.includes("presentAvailableDays(rawFromIgelGroups(cachedGroups)"),'Cached special slots must not be presented');

// Exercise the real calendar presentation routine without making live network calls.
const presenterStart=index.indexOf('function presentAvailableDays(raw,{preview=false,ageSeconds=0}={}){');
const presenterEnd=index.indexOf('\nasync function loadSlots()',presenterStart);
assert(presenterStart>=0&&presenterEnd>presenterStart,'Calendar presenter must be testable');
const calendarStatus={className:'',textContent:''};
const calendarState={availableDays:new Map(),selectedDay:null,selectedSlot:null,calendarMonth:null};
const calendarContext=vm.createContext({
 state:calendarState,
 $:()=>calendarStatus,
 buildAvailableDays:days=>days,
 renderMonthCalendar:()=>{},
 renderPregnancyRequestOption:()=>{},
 renderTimesForDay:()=>{},
 Date,Map
});
vm.runInContext(index.slice(presenterStart,presenterEnd)+'\nglobalThis.testPresenter=presentAvailableDays;',calendarContext);
calendarContext.testPresenter(new Map([
 ['2027-02-10',[{time:'11.00'}]],
 ['2026-12-08',[{time:'09.00'}]]
]));
assert.strictEqual(calendarState.calendarMonth.getFullYear(),2026,'Calendar must open the year of the earliest free appointment');
assert.strictEqual(calendarState.calendarMonth.getMonth(),11,'Calendar must open the earliest free month regardless of result order');
calendarContext.testPresenter(new Map());
const now=new Date();
assert.strictEqual(calendarState.calendarMonth.getFullYear(),now.getFullYear(),'No availability must leave calendar in current year');
assert.strictEqual(calendarState.calendarMonth.getMonth(),now.getMonth(),'No availability must leave calendar in current month');
assert(calendarStatus.textContent.includes('keine freien Termine'),'No availability must retain the existing information message');


 // Browser-start smoke check: a one-character selector typo previously prevented
 // every insurer/patient button from registering. Run the actual production
 // inline JavaScript with a minimal synthetic DOM and exercise the first 2 steps.
 const inlineScripts=index.split('<script>').slice(1).filter(part=>part.includes('</script>')).map(part=>part.slice(0,part.indexOf('</script>')));
 assert.strictEqual(inlineScripts.length,2,'Booking HTML must have 2 inline script blocks');
 function bookingSmokeElement(dataset={}){
   return {
     dataset,classList:{add(){},remove(){},toggle(){}},style:{},
     children:[],disabled:false,textContent:'',innerHTML:'',value:'',onclick:null,
     appendChild(node){this.children.push(node)},
     append(...nodes){this.children.push(...nodes)},
     setAttribute(){},scrollIntoView(){},focus(){}
   };
 }
 const insuranceChoice=bookingSmokeElement({insurance:'PKV'});
 const patientChoice=bookingSmokeElement({patient:'existing'});
 const smokeNodes=new Map();
 const bookingSmokeDocument={
   querySelector(selector){
     if(!smokeNodes.has(selector))smokeNodes.set(selector,bookingSmokeElement());
     return smokeNodes.get(selector);
   },
   querySelectorAll(selector){
     if(selector==='[data-insurance]')return [insuranceChoice];
     if(selector==='[data-patient]')return [patientChoice];
     return [];
   },
   createElement(){return bookingSmokeElement()}
 };
 vm.runInNewContext(inlineScripts[1],{
   window:{__MEDIDATE_SEED__:null},document:bookingSmokeDocument,
   location:{search:'',origin:'https://booking.example.invalid',hash:''},
   localStorage:{getItem(){return null},setItem(){}},
   URLSearchParams,setTimeout(){return 0},Date,Intl,Map,Set,Number,Math
 },{timeout:5000});
 assert.strictEqual(typeof insuranceChoice.onclick,'function','Insurance buttons must be clickable after page initialization');
 insuranceChoice.onclick();
 assert.strictEqual(typeof patientChoice.onclick,'function','Patient-type buttons must be clickable');
 patientChoice.onclick();
 assert(smokeNodes.get('#services').children.length>=4,'Choosing insurance and patient must render service buttons');


// Quick-preview regression: never turn a stale client snapshot into bookable green slots.
assert(index.includes("cacheStorageRead('direct:'+selectionKey,Number.MAX_SAFE_INTEGER)"),'Always present the last known local provider snapshot as preliminary data');
assert(index.includes("source:'mediDate-server-verified'"),'Only provider-confirmed responses are eligible for preview cache');
assert(index.includes("presentAvailableDays(previewRaw,{preview:true,ageSeconds:quick.ageSeconds})"),'Recent cache must be rendered as a provisional preview');
assert(index.includes("btn.classList.add(state.availabilityPreview?'preview':'available')"),'Unverified dates must never appear green');
assert(index.includes("t.disabled=Boolean(state.availabilityPreview)"),'Unverified times must never allow opening a booking form');
assert(index.includes("if(!state.availabilityPreview)t.onclick=()=>openBooking(x)"),'Booking buttons must only be wired after fresh mediDate confirmation');
assert(index.includes("if(state.availabilityPreview){"),'Provider refresh failures must retain already validated preliminary availability');
assert(index.includes("if(diagnosticMode)console.info('mediDate timings (internal only)'"),'Technical timing must only go to the developer console');
assert(!index.includes("state.lastTimingDiagnostics"),'Technical timing must not appear in patient status text');


// Shared cross-patient preview is scrubbed of unique tracking proofs.
assert(medidate.includes("if(action==='snapshot'){"),'Anonymous preview endpoint must be available');
assert(medidate.includes("access:'private',contentType:'application/json; charset=utf-8'"),'Snapshots must be stored privately');
assert(medidate.includes("time:String(t.time||'')"),'Snapshot must carry anonymized free times');
assert(!medidate.includes("trackingProof:t.trackingProof"),'No per-user proof is allowed in the shared cache');
assert(medidate.includes("olderThanPreferredWindow:age>previewMaxAgeMs()"),'Server may identify older-than-preferred snapshots without hiding them');
assert(index.includes("void fetchSharedPreview().then(()=>adoptNewestPreview())"),'Patient calendar must adopt a cross-visitor preview asynchronously');
assert(index.includes("if(state.slotLoadId!==loadId||state.liveVerifiedLoadId===loadId)return;"),'Late preview must not overwrite confirmed live data');
assert(index.includes("presentAvailableDays(raw,{preview:true,ageSeconds:latest.ageSeconds})"),'Server cache must only be presented as a preliminary preview');
assert(!index.includes("$('#calendarStatus').textContent+=' '+state.lastTimingDiagnostics"),'Patient view must contain no technical statistics');


// Menopause availability must tolerate independent service failures and reuse
// the same anonymous ten-minute snapshots across visitors and service choices.
assert(core.includes('async function buildFastPublicBundle(onlyServiceKey=null)'),'Fast bundle still available');
assert(core.includes('const failedKeys=keys.filter((key,i)=>results[i].status===\'rejected\')'),'Failed services must be identified without dropping successful ones');
assert(core.includes('if(!groups.length)throw new Error('),'Do not report availability if all services failed');
assert(medidate.includes('async function readCombinedPreview()'),'Shared menopause preview must combine cached services');
assert(medidate.includes("readPreview('all'),...keys.map(readPreview)"),'Shared IGeL preview must reuse single-service reads from all visitors');
assert(medidate.includes("...bundle.groups.map(g=>savePreview({generatedAt:bundle.generatedAt,groups:[g]},g.serviceKey))"),'Live IGeL fetch must save successful services independently');
assert(medidate.includes("t.direct&&t.direct.clientId>0"),'Cached time entries must preserve verifiable technical slot coordinates');
assert(medidate.includes("t.time)&&"),'Cached time format must be validated');
assert(index.includes("await fetchSharedPreview();"),'Provider failure must attempt shared preview recovery');
assert(index.includes("Mögliche Termine aus dem zuletzt gespeicherten Kalenderstand."),'Fallback status must explain that provisional slots remain visible');
assert(index.includes("presentAvailableDays(rawFromIgelGroups(combined),{"),'Partial provider response must be merged with the shared snapshot');
assert(index.includes("preview:true,ageSeconds:cached.ageSeconds"),'Mixed-freshness IGeL slots must not appear verified');
assert(index.includes("Date.now()-sharedPreviewRequest.at<1500"),'Shared preview failures must not be cached forever in the browser');

// Validate the actual anonymous cache sanitizer with representative mediDate slots.
const previewHelperStart=medidate.indexOf('function sanitizePreview(bundle,serviceKey){');
const previewHelperEnd=medidate.indexOf('async function savePreview(',previewHelperStart);
assert(previewHelperStart>0&&previewHelperEnd>previewHelperStart,'Preview sanitizer must be independently testable');
const sanitizerContext=vm.createContext({});
vm.runInContext(medidate.slice(previewHelperStart,previewHelperEnd)+'\nglobalThis.sanitizePreviewTest=sanitizePreview;',sanitizerContext);
const sample=sanitizerContext.sanitizePreviewTest({
 generatedAt:'2026-10-12T10:00:00.000Z',
 groups:[{serviceKey:'vorsorge',serviceName:'Vorsorge',doctorKeys:['vongrone'],
   availability:{appointmentTimes:[{dateTimeStart:'2026-10-14T00:00:00',duration:15,doctorKey:'vongrone',
     calendarWeek:42,times:[{time:'11.00',trackingNonce:'secret-nonce',trackingProof:'secret-proof',
       direct:{clientId:1,locationId:2,serviceId:1950,doctorId:513,listReferenzId:9,duration:15,calendarWeek:42}}]}]}}]
},'vorsorge');
assert.strictEqual(sample.groups[0].availability.appointmentTimes[0].times.length,1,'Regular slot times must not be dropped by regex escaping');
assert.strictEqual(sample.groups[0].availability.appointmentTimes[0].times[0].time,'11.00','Correct cached time');
assert(!JSON.stringify(sample).includes('secret-proof')&&!JSON.stringify(sample).includes('secret-nonce'),'Never store tracking proofs or tokens in shared preview');


// Calendar freshness must depend on Europe's Berlin clock, including DST.
// Cache only produces amber, unbookable previews; final provider checks are unchanged.
const backendWindowStart=medidate.indexOf('const PREVIEW_DAY_MAX_AGE_MS=');
const backendWindowEnd=medidate.indexOf('\nlet blobApiPromise=null;',backendWindowStart);
assert(backendWindowStart>=0&&backendWindowEnd>backendWindowStart,'Server clock window helper must exist');
const backendClock=vm.createContext({Intl,Date,Number});
vm.runInContext(medidate.slice(backendWindowStart,backendWindowEnd)+
  '\nglobalThis.getTtl=previewMaxAgeMs;',backendClock);
const frontendWindowStart=index.indexOf('function previewMaxAgeMs(now=Date.now()){');
const frontendWindowEnd=index.indexOf('function cachedDirectSelection(){',frontendWindowStart);
assert(frontendWindowStart>=0&&frontendWindowEnd>frontendWindowStart,'Browser clock window helper must exist');
const frontendClock=vm.createContext({Intl,Date,Number,Math});
vm.runInContext(index.slice(frontendWindowStart,frontendWindowEnd)+
  '\nglobalThis.getTtl=previewMaxAgeMs;',frontendClock);
for(const [label,time,expected] of [
  ['summer 19:59','2026-10-12T17:59:00.000Z',60*60*1000],
  ['summer 20:00','2026-10-12T18:00:00.000Z',6*60*60*1000],
  ['summer 05:59','2026-10-13T03:59:00.000Z',6*60*60*1000],
  ['summer 06:00','2026-10-13T04:00:00.000Z',60*60*1000],
  ['winter 19:59','2026-12-11T18:59:00.000Z',60*60*1000],
  ['winter 20:00','2026-12-11T19:00:00.000Z',6*60*60*1000],
  ['winter 05:59','2026-12-12T04:59:00.000Z',6*60*60*1000],
  ['winter 06:00','2026-12-12T05:00:00.000Z',60*60*1000]
]){
  const timestamp=Date.parse(time);
  assert.strictEqual(backendClock.getTtl(timestamp),expected,'Backend Berlin cache window: '+label);
  assert.strictEqual(frontendClock.getTtl(timestamp),expected,'Frontend Berlin cache window: '+label);
}
assert(index.includes("cache:action==='snapshot'?'default':'no-store'"),'Only anonymous preview may use CDN read cache');
assert(medidate.includes("cdn:'public, s-maxage=30'"),'Only anonymous provider preview is cached briefly at the edge');
assert(index.includes("if(state.service===selectedService)prefetchAvailability()"),'Slow live refresh must start after shared preview request');
assert(!index.includes('Mögliche Termine aus den letzten zehn Minuten.'),'Patient fallback text must not promise outdated ten-minute limit');
assert(index.includes('t.disabled=Boolean(state.availabilityPreview)'),'Preliminary time buttons remain disabled');


// An older but real provider snapshot is still a useful amber calendar.
// Browsers read it synchronously and never expose bookable times until live refresh.
assert(index.includes("const sharedStartupPromise=fetchSharedPreview('all').catch(()=>null);"),'Cross-visitor preview must begin at initial page load');
assert(index.includes("cacheStorageRead('shared-all',Number.MAX_SAFE_INTEGER)"),'First booking selection must immediately reuse an already prefetched shared snapshot');
assert(index.includes("void sharedStartupPromise.then(()=>adoptNewestPreview())"),'The page-start snapshot must update an already-open calendar');
assert(index.includes("cacheStorageWrite('shared-'+key,b)"),'Fresh anonymous shared results must be retained for the next visit');
assert(index.includes("Kalendervorschau wird im Hintergrund aktualisiert."),'Patient message must clearly explain background verification');
assert(index.includes("state.previewAgeSeconds=preview?ageSeconds:0"),'Preview presentation must remember its actual age');
assert(index.includes("state.availabilityPreview=false;state.previewAgeSeconds=Infinity;"),'New selection must not inherit a prior calendar preview');
assert(!index.includes("age<0||age>previewMaxAgeMs()"),'Older known snapshots must not be dropped from patient previews');
assert(medidate.includes("!Number.isFinite(age)||age<0)return null"),'Snapshot must retain old provider data while rejecting invalid timestamps');
assert(medidate.includes("verifiedAt:new Date(generated).toISOString()"),'Shared service aggregation must preserve per-service age');

console.log('Security regression checks passed.');
