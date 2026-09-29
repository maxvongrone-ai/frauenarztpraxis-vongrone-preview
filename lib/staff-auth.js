'use strict';

const crypto=require('crypto');
const {readSecret}=require('./medidate-core');

const DEFAULT_PASSWORD_SHA256='f9eb127a432f7ca27e0bba843ad316fe696deeb66251238ae3e211efb416eaba';
const COOKIE_NAME='__Host-fg_ma';
const SESSION_SECONDS=8*60*60;

function safeEqual(a,b){
  const A=Buffer.from(String(a||'')),B=Buffer.from(String(b||''));
  return A.length===B.length&&A.length>0&&crypto.timingSafeEqual(A,B);
}
function passwordHash(){
  const env=String(process.env.STAFF_BOOKING_PASSWORD_SHA256||'').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(env)?env:DEFAULT_PASSWORD_SHA256;
}
function verifyPassword(password){
  const value=String(password||'');
  if(value.length<10||value.length>200)return false;
  const digest=crypto.createHash('sha256').update(value,'utf8').digest('hex');
  return safeEqual(digest,passwordHash());
}
function signPayload(payload){
  return crypto.createHmac('sha256',readSecret()).update('staff-booking:'+payload).digest('base64url');
}
function makeSessionCookie(){
  const exp=Math.floor(Date.now()/1000)+SESSION_SECONDS;
  const nonce=crypto.randomBytes(18).toString('base64url');
  const payload=Buffer.from(JSON.stringify({v:1,exp,nonce}),'utf8').toString('base64url');
  const sig=signPayload(payload);
  return COOKIE_NAME+'='+payload+'.'+sig+'; Path=/; Max-Age='+SESSION_SECONDS+'; Secure; HttpOnly; SameSite=Strict';
}
function clearSessionCookie(){
  return COOKIE_NAME+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict';
}
function cookieValue(req){
  const raw=String(req.headers.cookie||'');
  const match=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+'='));
  return match?match.slice(COOKIE_NAME.length+1):'';
}
function isAuthenticated(req){
  const token=cookieValue(req),parts=token.split('.');
  if(parts.length!==2)return false;
  const [payload,sig]=parts;
  if(!safeEqual(sig,signPayload(payload)))return false;
  try{
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return data?.v===1&&Number.isFinite(data?.exp)&&data.exp>Math.floor(Date.now()/1000);
  }catch{return false}
}
function sameOrigin(req){
  const site=String(req.headers['sec-fetch-site']||'').toLowerCase();
  if(site!=='same-origin')return false;
  const origin=String(req.headers.origin||'');
  const host=String(req.headers.host||'');
  if(origin){
    try{if(new URL(origin).host!==host)return false}catch{return false}
  }
  return true;
}

module.exports={verifyPassword,makeSessionCookie,clearSessionCookie,isAuthenticated,sameOrigin,COOKIE_NAME};
