(() => {
 const form=document.querySelector('form'),password=document.querySelector('input[name="password"]'),username=document.querySelector('input[name="username"]'),show=document.getElementById('show-password'),remember=document.getElementById('remember-login'),error=document.querySelector('.error');
 if(!form||!password||!show)return;
 show.addEventListener('click',()=>{const visible=password.type==='password';password.type=visible?'text':'password';show.setAttribute('aria-label',visible?'隐藏密码':'显示密码');show.setAttribute('aria-pressed',String(visible));});
 const bridge=window.zhouzhiLogin;
 if(!bridge){remember.disabled=true;remember.closest('label').title='记住账号密码仅在更新后的舟知客户端中可用';}
 let touched=false,busy=false;
 username.addEventListener('input',()=>{touched=true;});password.addEventListener('input',()=>{touched=true;});
 bridge?.read().then(value=>{if(value&&!touched&&!username.value&&!password.value){username.value=value.username;password.value=value.password;remember.checked=true;}}).catch(()=>{});
 remember.addEventListener('change',()=>{touched=true;if(!remember.checked)bridge?.clear().catch(()=>{error.textContent='未能清除本机保存，请重试。';});});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;busy=true;
  const submit=form.querySelector('button[type="submit"]');submit.disabled=true;error.textContent='';
  try{
   // Native form success redirects to the workspace; failures never save an invalid password.
   if(!remember.checked)await bridge?.clear();
   const response=await fetch(form.action,{method:'POST',body:new URLSearchParams(new FormData(form)),credentials:'same-origin',redirect:'follow'});
   if(response.ok&&response.redirected&&new URL(response.url).pathname==='/'){
    if(remember.checked){try{await bridge.save({username:username.value,password:password.value});}catch{window.alert('登录成功，但未能安全记住密码。下次请重新输入。');}}
    window.location.replace('/');return;
   }
   const page=new DOMParser().parseFromString(await response.text(),'text/html');
   error.textContent=page.querySelector('.error')?.textContent||'登录未完成，请检查账号信息后重试。';
  }catch{error.textContent='暂时无法完成登录，请检查网络后重试。';}
  finally{busy=false;submit.disabled=false;}
 });
})();
