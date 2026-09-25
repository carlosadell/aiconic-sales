// "Message a contact" tab. Search any contact in the CRM, see the recent texts
// and emails with them in both directions, and text or email them from here.
// Sending uses the same endpoints as the lead card, so every send goes out as
// the person signed in and is recorded as a note in the CRM.
(function(){
  const $ = (id)=>document.getElementById(id);
  const esc = (s)=>(s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  let current = null;
  let timer = null;
  let seq = 0;

  function when(iso){
    if(!iso) return "";
    const d = new Date(iso); if(isNaN(d)) return "";
    return d.toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  }
  function fromAddr(){
    if(window.ME && window.ME.from) return esc(window.ME.from);
    return "your name at our sending domain";
  }

  async function search(q){
    const box = $("mc-results");
    const my = ++seq;
    if(q.length < 2){ box.innerHTML = ""; return; }
    box.innerHTML = '<div class="mc-empty">Searching...</div>';
    try{
      const r = await fetch("/api/contacts?q="+encodeURIComponent(q));
      const d = await r.json();
      if(my !== seq) return;
      if(!r.ok){ box.innerHTML = '<div class="mc-empty bad">Search failed: '+esc(d.error||"try again")+'</div>'; return; }
      const list = d.contacts || [];
      if(!list.length){ box.innerHTML = '<div class="mc-empty">No contact found for "'+esc(q)+'". Try a name, email or phone number.</div>'; return; }
      box.innerHTML = list.map(c =>
        '<button type="button" class="mc-hit" data-id="'+esc(c.id)+'">'+
          '<span class="mc-hit-name">'+esc(c.name)+(c.company?' <span class="mc-hit-co">'+esc(c.company)+'</span>':'')+'</span>'+
          '<span class="mc-hit-meta">'+esc([c.email, c.phone].filter(Boolean).join("  ·  ") || "No email or phone on file")+'</span>'+
        '</button>').join("");
    }catch(_){
      if(my === seq) box.innerHTML = '<div class="mc-empty bad">Search failed, try again.</div>';
    }
  }

  function bubble(m){
    const inbound = m.direction === "inbound";
    const who = inbound ? "They wrote" : "We sent";
    const ch = m.channel === "sms" ? "💬 Text" : "✉️ Email";
    const failed = /fail|undeliver|bounce/.test(m.status||"");
    return '<div class="mc-msg '+(inbound?"in":"out")+' '+m.channel+'">'+
      '<div class="mc-msg-top"><span class="mc-ch">'+ch+'</span><span class="mc-who">'+who+'</span><span class="mc-at">'+esc(when(m.at))+'</span>'+
      (failed?'<span class="mc-fail">Not delivered</span>':'')+'</div>'+
      (m.channel==="email"?'<div class="mc-subj">'+esc(m.subject||"(no subject)")+'</div>':'')+
      '<div class="mc-body">'+(esc(m.body||"").trim() || '<span class="mc-dim">No text in this message.</span>')+'</div>'+
    '</div>';
  }

  function renderThread(list, err){
    const t = $("mc-thread");
    if(err){ t.innerHTML = '<div class="mc-empty bad">'+esc(err)+'</div>'; return; }
    if(!list || !list.length){ t.innerHTML = '<div class="mc-empty">No texts or emails with this contact yet.</div>'; return; }
    t.innerHTML = list.map(bubble).join("");
    t.scrollTop = t.scrollHeight;
  }

  function sendCards(c){
    const sms = c.phone
      ? '<div class="chan chan-sms"><div class="chan-top"><span class="chan-ic">💬</span><span class="chan-name">Text message</span><span class="chan-mode send">Sends from here</span></div>'+
        '<div class="chan-how">Goes to <b>'+esc(c.phone)+'</b> as a text from our CRM number. It sends when you confirm, and their reply shows up in the conversation above and in the CRM.</div>'+
        '<textarea class="box editable mc-sms" rows="4" placeholder="Write your text here"></textarea>'+
        '<div class="btnrow"><button class="btn send sms" data-act="mc-sms" data-label="Send this text">Send this text</button></div></div>'
      : '<div class="chan chan-sms off"><div class="chan-top"><span class="chan-ic">💬</span><span class="chan-name">Text message</span></div><div class="chan-how">No phone number on file, so no text can be sent.</div></div>';
    const email = c.email
      ? '<div class="chan chan-email"><div class="chan-top"><span class="chan-ic">✉️</span><span class="chan-name">Email</span><span class="chan-mode send">Sends from here</span></div>'+
        '<div class="chan-how">Goes to <b>'+esc(c.email)+'</b> from <b>'+fromAddr()+'</b>. It sends when you click the button below, and when they reply you will see it in the conversation above, in their CRM card and in your business Gmail.</div>'+
        '<div class="subjrow"><span class="subj-lbl">Subject</span><input class="subj-input mc-subject" placeholder="Write a subject"></div>'+
        '<textarea class="box editable mc-body" rows="7" placeholder="Write your email here"></textarea>'+
        '<div class="btnrow"><button class="btn send email" data-act="mc-email" data-label="Send this email">Send this email</button></div></div>'
      : '<div class="chan chan-email off"><div class="chan-top"><span class="chan-ic">✉️</span><span class="chan-name">Email</span></div><div class="chan-how">No email on file, so no email can be sent.</div></div>';
    return sms + email;
  }

  async function open(id){
    const pane = $("mc-contact");
    pane.hidden = false;
    pane.innerHTML = '<div class="mc-empty">Loading the contact...</div>';
    $("mc-results").innerHTML = "";
    try{
      const r = await fetch("/api/contacts?id="+encodeURIComponent(id));
      const d = await r.json();
      if(!r.ok){ pane.innerHTML = '<div class="mc-empty bad">Could not load this contact: '+esc(d.error||"try again")+'</div>'; return; }
      const c = d.contact; current = c;
      pane.innerHTML =
        '<div class="mc-head">'+
          '<div><div class="mc-name">'+esc(c.name)+'</div>'+
          '<div class="mc-meta">'+esc([c.company, c.email, c.phone].filter(Boolean).join("  ·  ") || "No email or phone on file")+'</div></div>'+
          '<div class="mc-headbtns"><a class="btn" href="'+esc(c.crm)+'" target="_blank" rel="noopener">Open in the CRM</a>'+
          '<button type="button" class="btn" data-act="mc-reload">Refresh messages</button>'+
          '<button type="button" class="btn" data-act="mc-close">Pick another contact</button></div>'+
        '</div>'+
        '<h3 class="mc-h">1. Recent texts and emails</h3>'+
        '<p class="mc-lede">The last texts and emails with this contact, oldest at the top and newest at the bottom.</p>'+
        '<div id="mc-thread" class="mc-thread"></div>'+
        '<h3 class="mc-h">2. Send a message</h3>'+
        sendCards(c);
      renderThread(d.thread, d.threadError);
      pane.querySelectorAll("textarea.editable").forEach(t=>{
        const fit=()=>{ t.style.height="auto"; t.style.height=(t.scrollHeight+2)+"px"; };
        t.addEventListener("input", fit);
      });
      try{ pane.scrollIntoView({behavior:"smooth",block:"start"}); }catch(_){}
    }catch(_){
      pane.innerHTML = '<div class="mc-empty bad">Could not load this contact, try again.</div>';
    }
  }

  async function reloadThread(){
    if(!current) return;
    const t = $("mc-thread"); if(t) t.style.opacity = ".5";
    try{
      const r = await fetch("/api/contacts?id="+encodeURIComponent(current.id));
      const d = await r.json();
      if(r.ok) renderThread(d.thread, d.threadError);
    }catch(_){}
    if(t) t.style.opacity = "";
  }

  async function send(b, act){
    const card = b.closest(".chan");
    const label = b.dataset.label || "Send";
    const isSms = act === "mc-sms";
    const ta = card.querySelector(isSms ? ".mc-sms" : ".mc-body");
    const text = ta ? ta.value : "";
    const subjEl = card.querySelector(".mc-subject");
    const subject = subjEl ? subjEl.value.trim() : "";
    if(!text.trim() || (!isSms && !subject)){
      b.textContent = isSms ? "Type a message first" : "Add a subject and message first";
      setTimeout(()=>{ b.textContent = label; },1800); return;
    }
    // First tap arms the button, second tap sends. Stops accidental sends.
    if(!b.classList.contains("arm")){
      b.classList.add("arm"); b.textContent = "Tap again to send";
      clearTimeout(b._t); b._t = setTimeout(()=>{ b.classList.remove("arm"); b.textContent = label; },4000);
      return;
    }
    clearTimeout(b._t); b.classList.remove("arm");
    b.textContent = "Sending..."; b.disabled = true;
    try{
      const r = isSms
        ? await fetch("/api/send-sms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId:current.id,message:text})})
        : await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId:current.id,subject,body:text})});
      const d = await r.json();
      if(r.ok && d.ok){
        b.textContent = isSms ? "Text sent" : "Email sent"; b.classList.add("done");
        ta.value = ""; if(subjEl) subjEl.value = "";
        setTimeout(reloadThread, 1500);
        setTimeout(()=>{ b.textContent = label; b.classList.remove("done"); b.disabled = false; },3000);
      }else{ b.textContent = "Failed: "+(d.error||"try again"); b.disabled = false; }
    }catch(_){ b.textContent = "Failed, try again"; b.disabled = false; }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    const input = $("mc-q"); if(!input) return;
    input.addEventListener("input", ()=>{ clearTimeout(timer); timer = setTimeout(()=>search(input.value.trim()), 300); });
    input.addEventListener("keydown", (e)=>{ if(e.key==="Enter"){ clearTimeout(timer); search(input.value.trim()); } });
    $("view-msg").addEventListener("click", (e)=>{
      const hit = e.target.closest(".mc-hit");
      if(hit){ open(hit.dataset.id); return; }
      const b = e.target.closest("button"); if(!b) return;
      const act = b.dataset.act;
      if(act==="mc-sms" || act==="mc-email"){ send(b, act); return; }
      if(act==="mc-reload"){ reloadThread(); return; }
      if(act==="mc-close"){ current = null; $("mc-contact").hidden = true; $("mc-contact").innerHTML = ""; input.focus(); try{ input.scrollIntoView({behavior:"smooth",block:"center"}); }catch(_){} }
    });
  });
})();
