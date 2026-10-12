import React,{useCallback,useEffect,useRef,useState} from 'react';

export function SoftScrollArea({children,className='',edgeHints=false,onScroll,...props}:React.HTMLAttributes<HTMLDivElement>&{edgeHints?:boolean}){
  const area=useRef<HTMLDivElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [scrolling,setScrolling]=useState(false),[edges,setEdges]=useState({left:false,right:false});
  const measure=useCallback(()=>{
    const el=area.current;if(!el||!edgeHints)return;
    const next={left:el.scrollLeft>2,right:el.scrollWidth-el.clientWidth-el.scrollLeft>2};
    setEdges(previous=>previous.left===next.left&&previous.right===next.right?previous:next);
  },[edgeHints]);
  useEffect(()=>{
    const el=area.current;if(!el)return;measure();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(measure);observer.observe(el);if(el.firstElementChild)observer.observe(el.firstElementChild);
    return()=>observer.disconnect();
  },[measure]);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const content=<div {...props} ref={area} className={`${className} zh-soft-scroll${scrolling?' is-scrolling':''}`} onScroll={event=>{
    setScrolling(true);clearTimeout(timer.current);timer.current=setTimeout(()=>setScrolling(false),850);measure();onScroll?.(event);
  }}>{children}</div>;
  return edgeHints?<div className="zh-table-frame" data-scroll-left={edges.left} data-scroll-right={edges.right}>{content}</div>:content;
}
