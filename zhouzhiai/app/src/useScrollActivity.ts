import {useEffect} from 'react';

// Capture native scrolls too (tables, textareas, dialogs and the document), not
// just SoftScrollArea. Never prevent scrolling or replace native dragging.
export function useScrollActivity(){
  useEffect(()=>{
    const timers=new Map<Element,ReturnType<typeof setTimeout>>();
    const mark=(event:Event)=>{
      const target=event.target===document?document.scrollingElement:event.target;
      if(!(target instanceof Element))return;
      clearTimeout(timers.get(target));
      target.setAttribute('data-zh-scrolling','');
      timers.set(target,setTimeout(()=>{
        target.removeAttribute('data-zh-scrolling');timers.delete(target);
      },850));
    };
    document.addEventListener('scroll',mark,{capture:true,passive:true});
    return()=>{
      document.removeEventListener('scroll',mark,true);
      for(const [target,timer] of timers){clearTimeout(timer);target.removeAttribute('data-zh-scrolling');}
      timers.clear();
    };
  },[]);
}
