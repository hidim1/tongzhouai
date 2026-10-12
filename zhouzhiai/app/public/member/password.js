(() => {
 const dialog=document.getElementById('password-dialog'),form=document.getElementById('password-form'),open=document.getElementById('open-password');
 if(!dialog||!form||!open)return;
 const error=document.getElementById('password-error'),success=document.getElementById('password-success'),submit=form.querySelector('button[type="submit"]');let busy=false;
 const clear=()=>{form.reset();error.textContent='';for(const field of form.querySelectorAll('input[type="text"],input[type="password"]'))if(field.name!=='username')field.type='password';for(const button of form.querySelectorAll('[data-password-target]')){button.textContent='显示密码';button.setAttribute('aria-pressed','false');}};
 open.addEventListener('click',()=>{clear();form.elements.username.value=document.getElementById('member-username').value;dialog.showModal();});
 for(const id of ['close-password','return-login'])document.getElementById(id).addEventListener('click',()=>dialog.close());
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});dialog.addEventListener('close',clear);
 for(const button of form.querySelectorAll('[data-password-target]'))button.addEventListener('click',()=>{const field=document.getElementById(button.dataset.passwordTarget),show=field.type==='password';field.type=show?'text':'password';button.textContent=show?'隐藏密码':'显示密码';button.setAttribute('aria-pressed',String(show));});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  if(form.elements.newPassword.value!==form.elements.confirmPassword.value){error.textContent='两次输入的新密码不一致';return;}
  busy=true;submit.disabled=true;error.textContent='';for(const id of ['close-password','return-login'])document.getElementById(id).disabled=true;
  try{
   const response=await fetch(form.action,{method:'POST',headers:{'X-Tongzhou-Client':'workspace'},body:new URLSearchParams(new FormData(form)),credentials:'same-origin'}),result=await response.json();
   if(!response.ok||!result.ok){error.textContent=result.error||'修改未完成，请重试。';return;}
   document.getElementById('member-username').value=form.elements.username.value;document.getElementById('member-password').value='';document.getElementById('remember-login').checked=false;
   let cleared=true;try{await window.zhouzhiLogin?.clear();}catch{cleared=false;}
   success.textContent=cleared?'密码已修改，请使用新密码登录。':'密码已修改，请取消记住并清除本机旧密码后重新登录。';dialog.close();
  }catch{error.textContent='未能确认修改结果，请重新登录核实，不要重复提交。';}
  finally{busy=false;submit.disabled=false;for(const id of ['close-password','return-login'])document.getElementById(id).disabled=false;}
 });
})();
