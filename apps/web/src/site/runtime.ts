// The small script every published page carries: scroll effects (appear, parallax, scroll-linked,
// each following the layer itself, the page or another layer), Change to, Back, Scroll to,
// Lightbox, custom cursors, marquees, forms without a destination, page transitions, and in
// Preview, links between pages (the preview window swaps pages itself). Kept as a string so it is written into each page as-is.

export const RUNTIME = `(function(){
var d=document,w=window,preview=!!w.__sitePreview;
var reduce=w.matchMedia&&w.matchMedia("(prefers-reduced-motion: reduce)").matches;
var appear=[].slice.call(d.querySelectorAll("[data-appear]"));
if(appear.length){
  var io="IntersectionObserver" in w?new IntersectionObserver(function(es){es.forEach(function(e){(e.target.__fx||[e.target]).forEach(function(el){if(e.isIntersecting){el.classList.add("is-in");if(el.getAttribute("data-once")==="1"&&e.target===el)io.unobserve(el);}else if(el.getAttribute("data-once")!=="1"&&e.boundingClientRect.top>0){el.classList.remove("is-in");}});});},{threshold:0.12}):null;
  appear.forEach(function(el){var mode=el.getAttribute("data-appear");
    if(reduce||!io||mode==="load"){requestAnimationFrame(function(){requestAnimationFrame(function(){el.classList.add("is-in");});});return;}
    if(mode==="layer"){var t=d.getElementById(el.getAttribute("data-appear-target")||"");if(t){(t.__fx=t.__fx||[]).push(el);io.observe(t);return;}}
    io.observe(el);});
}
var par=[].slice.call(d.querySelectorAll("[data-parallax]")),lin=[].slice.call(d.querySelectorAll("[data-scroll]"));
lin.forEach(function(el){try{el.__s=JSON.parse(el.getAttribute("data-scroll"));}catch(e){el.__s=null;}});
var ticking=false;
function mix(a,b,t){return a+(b-a)*t;}
function tick(){ticking=false;var vh=w.innerHeight;
  par.forEach(function(el){var r=el.getBoundingClientRect();var c=r.top+r.height/2-vh/2;el.style.translate="0 "+(-c*parseFloat(el.getAttribute("data-parallax"))*0.5).toFixed(1)+"px";});
  lin.forEach(function(el){var s=el.__s;if(!s)return;var p;
    if(s.m==="page"){var max=d.documentElement.scrollHeight-vh;p=max>0?w.scrollY/max:0;}
    else{var src=s.m==="layer"&&s.g?d.getElementById(s.g)||el:el;var r=src.getBoundingClientRect();p=(vh-r.top)/(vh+r.height);}
    p=Math.max(0,Math.min(1,p));
    el.style.opacity=mix(s.f.opacity,s.t.opacity,p).toFixed(3);el.style.translate=mix(s.f.x,s.t.x,p).toFixed(1)+"px "+mix(s.f.y,s.t.y,p).toFixed(1)+"px";el.style.scale=mix(s.f.scale,s.t.scale,p).toFixed(3);el.style.rotate=mix(s.f.rotate,s.t.rotate,p).toFixed(2)+"deg";});
}
if((par.length||lin.length)&&!reduce){w.addEventListener("scroll",function(){if(!ticking){ticking=true;requestAnimationFrame(tick);}},{passive:true});w.addEventListener("resize",tick);tick();}
function all(sel){return [].slice.call(d.querySelectorAll(sel));}
function back(){if(preview)w.parent.postMessage({type:"site-preview-back"},"*");else if(w.history.length>1)w.history.back();else w.location.href=(d.querySelector("a[data-to='/']")||{}).href||"/";}
function scrollTo(el){var t=d.getElementById(el.getAttribute("data-scroll-to")||"");if(!t)return;var y=t.getBoundingClientRect().top+w.scrollY-(parseFloat(el.getAttribute("data-offset"))||0);w.scrollTo({top:y,behavior:reduce||el.getAttribute("data-smooth")!=="1"?"instant":"smooth"});}
function lightbox(el){var box=d.createElement("div");box.className="site-lightbox";box.setAttribute("role","dialog");box.setAttribute("aria-modal","true");box.setAttribute("aria-label",el.getAttribute("data-lightbox-alt")||"Image");
  var img=d.createElement("img");img.src=el.getAttribute("data-lightbox");img.alt=el.getAttribute("data-lightbox-alt")||"";var x=d.createElement("button");x.type="button";x.setAttribute("aria-label","Close");x.textContent="\u00d7";
  function close(){box.remove();d.removeEventListener("keydown",key);if(el.focus)el.focus();}function key(e){if(e.key==="Escape")close();}
  box.addEventListener("click",function(e){if(e.target!==img)close();});d.addEventListener("keydown",key);box.appendChild(img);box.appendChild(x);d.body.appendChild(box);x.focus();}
function act(el){if(el.hasAttribute("data-back"))back();else if(el.hasAttribute("data-scroll-to"))scrollTo(el);else if(el.hasAttribute("data-lightbox"))lightbox(el);}
all("[data-back],[data-scroll-to],[data-lightbox]").forEach(function(el){el.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();act(el);});});
all("[data-change]").forEach(function(el){var t=el.getAttribute("data-change");function set(on){el.classList.toggle("is-alt",on);if(el.hasAttribute("aria-pressed"))el.setAttribute("aria-pressed",String(on));}
  if(t==="hover"){el.addEventListener("pointerenter",function(){set(true);});el.addEventListener("pointerleave",function(){set(false);});}
  else if(t==="press"){el.addEventListener("pointerdown",function(){set(true);});["pointerup","pointerleave","pointercancel"].forEach(function(n){el.addEventListener(n,function(){set(false);});});}
  else el.addEventListener("click",function(e){if(!e.target.closest||!e.target.closest("a[href]"))set(!el.classList.contains("is-alt"));});});
d.addEventListener("keydown",function(e){var el=e.target;if((e.key==="Enter"||e.key===" ")&&el&&el.getAttribute&&el.getAttribute("role")==="button"&&el.tagName!=="BUTTON"){e.preventDefault();el.click();}});
all("[data-cursor]").forEach(function(el){var c=d.getElementById(el.getAttribute("data-cursor")||"");if(!c||(w.matchMedia&&!w.matchMedia("(hover:hover)").matches))return;
  var k=parseFloat(c.getAttribute("data-smooth"))||0,center=c.getAttribute("data-hotspot")==="center",tx=0,ty=0,x=0,y=0,raf=0;
  function frame(){x+=(tx-x)*(reduce?1:1-k);y+=(ty-y)*(reduce?1:1-k);var ox=center?c.offsetWidth/2:0,oy=center?c.offsetHeight/2:0;c.style.transform="translate("+(x-ox).toFixed(1)+"px,"+(y-oy).toFixed(1)+"px)";raf=Math.abs(tx-x)+Math.abs(ty-y)>0.3?requestAnimationFrame(frame):0;}
  el.addEventListener("pointerenter",function(e){tx=x=e.clientX;ty=y=e.clientY;c.classList.add("is-on");frame();});
  el.addEventListener("pointermove",function(e){tx=e.clientX;ty=e.clientY;if(!raf)raf=requestAnimationFrame(frame);});
  el.addEventListener("pointerleave",function(){c.classList.remove("is-on");});});
all("[data-marquee]").forEach(function(el){var o;try{o=JSON.parse(el.getAttribute("data-marquee"));}catch(e){return;}
  var y=o.d==="up"||o.d==="down",cs=w.getComputedStyle(el),gap=cs.gap&&cs.gap!=="normal"?cs.gap:"0px";
  var track=d.createElement("div");track.className="site-marquee-track"+(y?" is-y":"");track.style.gap=gap;track.style.alignItems=cs.alignItems;
  var kids=[].slice.call(el.childNodes);kids.forEach(function(k){track.appendChild(k);});kids.forEach(function(k){var c=k.cloneNode(true);if(c.nodeType===1){c.setAttribute("aria-hidden","true");c.removeAttribute&&c.removeAttribute("id");}track.appendChild(c);});
  track.style.paddingRight=y?"":gap;track.style.paddingBottom=y?gap:"";
  el.appendChild(track);if(o.p)el.setAttribute("data-marquee-pause","");
  function run(){var size=(y?track.scrollHeight:track.scrollWidth)/2;track.style.animation=(y?"site-mq-y ":"site-mq-x ")+Math.max(1,size/o.s).toFixed(2)+"s linear infinite"+(o.d==="right"||o.d==="down"?" reverse":"");}
  run();w.addEventListener("resize",run);});
[].slice.call(d.querySelectorAll("form[data-site-form]")).forEach(function(f){f.addEventListener("submit",function(e){if(f.getAttribute("action")&&!preview)return;e.preventDefault();var p=d.createElement("p");p.className="site-form-done";p.setAttribute("role","status");p.textContent=f.getAttribute("data-success")||"Thanks!";f.replaceChildren(p);});});
d.addEventListener("click",function(e){
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;
  var href=a.getAttribute("href")||"";
  if(href.charAt(0)==="#"){var t=href.length>1?d.getElementById(decodeURIComponent(href.slice(1))):null;if(t){e.preventDefault();t.scrollIntoView({behavior:reduce?"auto":"smooth"});}return;}
  var to=a.getAttribute("data-to");
  if(preview){e.preventDefault();if(to)w.parent.postMessage({type:"site-preview-nav",to:to},"*");else if(/^https?:/i.test(href))w.open(href,"_blank","noopener");return;}
  if(!to||a.target==="_blank")return;
  e.preventDefault();d.documentElement.classList.add("site-leaving");setTimeout(function(){w.location.href=a.href;},180);
});
w.addEventListener("pageshow",function(){d.documentElement.classList.remove("site-leaving");});
if(preview){
  w.addEventListener("message",function(e){var m=e.data||{};if(m.type==="site-preview-scroll"&&m.anchor){var t=d.getElementById(m.anchor);if(t)t.scrollIntoView();}});
  w.parent.postMessage({type:"site-preview-ready"},"*");
}
})();`;
