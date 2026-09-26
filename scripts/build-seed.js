const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

// V60.8.2: deployment builds are deliberately network-independent.
// mediDate is contacted only at runtime through /api/medidate.
const secretPath=path.join(process.cwd(),'api','security-secret.json');
if(!process.env.BOOKING_TOKEN_SECRET&&!fs.existsSync(secretPath)){
  fs.writeFileSync(secretPath,JSON.stringify({secret:crypto.randomBytes(48).toString('base64url')},null,2)+'\n','utf8');
}

function buildStaticAssets(){
  const publicDir=path.join(process.cwd(),'public');
  fs.rmSync(publicDir,{recursive:true,force:true});
  fs.mkdirSync(publicDir,{recursive:true});

  const sourceIndex=fs.readFileSync(path.join(process.cwd(),'index.html'),'utf8');
  const marker='window.__MEDIDATE_SEED__=null;';
  if(!sourceIndex.includes(marker))throw new Error('Seed marker in index.html fehlt.');
  const styleMatch=sourceIndex.match(/<style>([\s\S]*?)<\/style>/i);
  const scriptMatches=[...sourceIndex.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  if(!styleMatch||scriptMatches.length!==2||!scriptMatches[0][1].includes(marker))throw new Error('Booking-Assets konnten nicht sicher extrahiert werden.');

  fs.writeFileSync(path.join(publicDir,'styles.css'),styleMatch[1].trim()+'\n','utf8');
  // No deployment-time slot tokens: they are generated with the deployment secret at runtime.
  fs.writeFileSync(path.join(publicDir,'seed-data.js'),'window.__MEDIDATE_SEED__=null;\n','utf8');
  fs.writeFileSync(path.join(publicDir,'app.js'),scriptMatches[1][1].trim()+'\n','utf8');

  let builtIndex=sourceIndex.replace(styleMatch[0],'<link rel="stylesheet" href="/styles.css">');
  builtIndex=builtIndex.replace(scriptMatches[0][0],'<script src="/seed-data.js"></script>');
  builtIndex=builtIndex.replace(scriptMatches[1][0],'<script src="/app.js"></script>');
  fs.writeFileSync(path.join(publicDir,'index.html'),builtIndex,'utf8');

  for(const file of ['admin.html','privacy-booking.html','tracking.html','robots.txt']){
    fs.copyFileSync(path.join(process.cwd(),file),path.join(publicDir,file));
  }

  // Explicit empty placeholder. The API treats this as "no cached bundle" and
  // fetches a fresh, server-validated bundle on first runtime request.
  fs.writeFileSync(path.join(process.cwd(),'api','seed-bundle.json'),JSON.stringify({ok:false,generatedAt:null,groups:[],runtimeBootstrap:true},null,2)+'\n','utf8');
  console.log('Secure static build generated; mediDate runtime bootstrap enabled.');
}

try{buildStaticAssets()}catch(e){
  console.error('Static build failed:',e?.stack||e?.message||e);
  process.exit(1);
}
