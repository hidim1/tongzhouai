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
})();
