(function(root){
  'use strict';
  function localTodayBerlin(){
    const p=new Intl.DateTimeFormat('de-DE',{
      timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date());
    const n=k=>Number(p.find(x=>x.type===k)?.value);
    return [n('year'),n('month'),n('day')].map((v,i)=>String(v).padStart(i===0?4:2,'0')).join('-');
  }
  function checkBirthdate(input,todayOverride){
    const value=String(input||'').trim();
    const today=String(todayOverride||localTodayBerlin());
    const futureMessage='Das Geburtsdatum liegt in der Zukunft. Bitte überprüfen Sie insbesondere das Geburtsjahr.';
    if(!value)return {ok:false,code:'missing',message:'Bitte geben Sie Ihr vollständiges Geburtsdatum ein.'};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return {ok:false,code:'format',message:'Bitte ein gültiges Geburtsdatum mit Tag, Monat und Jahr eingeben.'};
    const [y,m,d]=value.split('-').map(Number),[Y,M,D]=today.split('-').map(Number);
    const stamp=new Date(Date.UTC(y,m-1,d));
    if(stamp.getUTCFullYear()!==y||stamp.getUTCMonth()+1!==m||stamp.getUTCDate()!==d)
      return {ok:false,code:'invalid',message:'Dieses Kalenderdatum existiert nicht. Bitte korrigieren Sie das Geburtsdatum.'};
    if(value>today)return {ok:false,code:'future',message:futureMessage+' ('+y+')'};
    const age=Y-y-(m>M||(m===M&&d>D)?1:0);
    const oldest=[Y-110,M,D].map((v,i)=>String(v).padStart(i===0?4:2,'0')).join('-');
    if(value<oldest)return {ok:false,code:'too_old',message:'Das Geburtsjahr erscheint unplausibel. Bitte prüfen Sie Ihre Eingabe.'};
    if(age<18){
      if(y===Y)return {ok:false,code:'current_year',message:'Bitte prüfen Sie das Geburtsjahr: '+Y+' ist das aktuelle Jahr und wurde möglicherweise versehentlich ausgewählt. Eine Onlinebuchung für Personen unter 18 Jahren ist hier nicht möglich; bitte wenden Sie sich an die Praxis.'};
      return {ok:false,code:'under_18',message:'Das eingegebene Geburtsdatum ergibt ein Alter unter 18 Jahren. Bitte prüfen Sie das Jahr. Für Minderjährige erfolgt die Terminvereinbarung telefonisch über die Praxis.'};
    }
    return {ok:true,code:'valid',age,message:'Geburtsdatum plausibel – '+age+' Jahre. Eine Patientenidentifizierung ist damit nicht verbunden.'};
  }
  root.checkOnlineBirthdate=checkBirthdate;
  root.onlineTodayBerlin=localTodayBerlin;
  if(typeof module==='object'&&module.exports)module.exports={checkBirthdate,localTodayBerlin};
})(typeof window==='object'?window:globalThis);
