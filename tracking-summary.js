(() => {
  function updatePrivatsprechstundeCount(){
    const el=document.querySelector('#nPrivateConsultation');
    if(!el)return;
    try{
      const items=Array.isArray(current)?current:[];
      el.textContent=String(items.filter(isPrivateConsultation).length);
    }catch{
      el.textContent='–';
    }
  }
  const originalRender=render;
  render=function(...args){
    const result=originalRender.apply(this,args);
    updatePrivatsprechstundeCount();
    return result;
  };
  updatePrivatsprechstundeCount();
})();