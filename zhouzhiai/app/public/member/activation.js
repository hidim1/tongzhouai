(() => {
  const input=document.querySelector('input[name="code"]');
  if(!input)return;
  const digits=value=>value.toUpperCase().replace(/^\s*ZZ[\s\-\u2010-\u2015\u2212\uff0d]*/,'').replace(/[^A-F0-9]/g,'').slice(0,40);
  const format=value=>digits(value).match(/.{1,8}/g)?.join('-')||'';
  input.addEventListener('input',()=>{
    const count=digits(input.value.slice(0,input.selectionStart??input.value.length)).length;
    input.value=format(input.value);
    const position=Math.min(input.value.length,count+Math.floor(count/8));
    input.setSelectionRange(position,position);
  });
  const form=document.querySelector('form[action="/member/activate"]');
  if(!form?.querySelector)return;
  const submit=form.querySelector('button[type="submit"]'),error=document.querySelector('.error');let busy=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;busy=true;submit.disabled=true;error.textContent='';
    try{
      const response=await fetch(form.action,{method:'POST',headers:{'X-Tongzhou-Client':'workspace'},body:new URLSearchParams(new FormData(form)),credentials:'same-origin'});
      if(response.ok&&response.redirected&&new URL(response.url).pathname==='/member/login'){window.location.replace('/member/login?activated=1');return;}
      const page=new DOMParser().parseFromString(await response.text(),'text/html');error.textContent=page.querySelector('.error')?.textContent||'激活未完成，请核对账号与激活码后重试。';
    }catch{error.textContent='未能确认激活结果，请先尝试登录，勿重复激活。';}
    finally{busy=false;submit.disabled=false;}
  });
})();
