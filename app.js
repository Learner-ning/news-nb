const newsEl=document.querySelector("#news"),meta=document.querySelector("#meta");
let current="all";
function esc(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function timeAgo(t){if(!t)return "";let d=Date.now()-new Date(t).getTime(),m=Math.floor(d/60000);return m<60?`${m} 分钟前`:m<1440?`${Math.floor(m/60)} 小时前`:`${Math.floor(m/1440)} 天前`}
async function load(){
 newsEl.innerHTML=Array.from({length:6},()=>'<div class="skeleton"></div>').join("");
 try{let r=await fetch("/api/news?source="+encodeURIComponent(current));let d=await r.json();
 meta.textContent=`${d.items.length} 条新闻 · ${new Date(d.updatedAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})} 更新`;
 newsEl.innerHTML=d.items.map(x=>`<article class="card"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer"><div><div class="tag">${esc(x.tag)} · ${esc(x.source)}</div><div class="title">${esc(x.title)}</div><div class="summary">${esc(x.summary)}</div></div><div class="foot"><span>${timeAgo(x.time)}</span><span>↗ 原文</span></div></a></article>`).join("")||"<div class='card'>暂时没有新闻。</div>";
 }catch(e){meta.textContent="加载失败";newsEl.innerHTML="<div class='card'>新闻源暂时不可用，请稍后刷新。</div>"}
}
document.querySelector("#filters").addEventListener("click",e=>{if(e.target.matches("button")){document.querySelectorAll(".filters button").forEach(b=>b.classList.remove("active"));e.target.classList.add("active");current=e.target.dataset.source;load()}});
document.querySelector("#refresh").onclick=load;load();
