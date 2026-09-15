// Front-end for the Daily Reach-Out List.
// Fetches /api/leads (live from GoHighLevel) and renders booked leads and
// no-shows per salesperson, each with call-prep links, what we already sent,
// and personal messages across every channel.

const el = (id) => document.getElementById(id);
let DATA = null;
let TAB = "booked";

function initials(n){ return (n||"?").split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase(); }
function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function ago(iso){
  if(!iso) return "";
  const h=Math.round((Date.now()-new Date(iso))/3.6e6);
  if(h<1) return "just now";
  if(h<24) return h+"h ago";
  return Math.round(h/24)+"d ago";
}
function when(iso){
  if(!iso) return "";
  try{ return new Date(iso).toLocaleString([], {weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}); }
  catch(_){ return ""; }
}

// Personal message drafts. Context is "booked" (before the call) or "noshow".
function messages(l){
  const first = (l.name||"there").split(" ")[0];
  const rep = l.repName && l.repName!=="Unassigned" ? l.repName.split(" ")[0] : "";
  const from = rep ? `${rep} from Aiconic` : "the Aiconic team";
  const link = l.rebookLink || "";
  if(l.status==="noshow"){
    return {
      sms: `Hi ${first}, ${from} here. We were on the call today but did not see you come through. Everything ok? If you want, you can grab another time here: ${link}`,
      email: {
        subject: "Sorry we missed you",
        body: `Hi ${first}, ${from} here. We were on the call today but did not see you come through, so I wanted to check in. Everything ok? No problem at all if the timing slipped. If you would still like to talk, you can pick a new time here: ${link}. Looking forward to it.`,
      },
      note: `Hi ${first}, we were on the call today but did not see you come through. Everything ok? If you want to find another time, here is the link: ${link}`,
    };
  }
  const isInterview = /interview/i.test(l.stage);
  const line = isInterview
    ? "Saw you booked your interview with us and wanted to say hello before we talk."
    : "Saw you booked a call with us and wanted to reach out personally before we speak.";
  return {
    sms: `Hi ${first}, ${from} here. ${line} Looking forward to it, and if anything comes up before then just reply here.`,
    email: {
      subject: isInterview ? "Looking forward to your Aiconic interview" : "Looking forward to our call",
      body: `Hi ${first}, ${from} here. ${line} No pitch, just a real conversation about your business and how we can help. If anything comes up before then, message me here. Looking forward to it.`,
    },
    note: `Hi ${first}, ${from} here. ${line} No pitch, just a real conversation. Looking forward to it.`,
  };
}

async function load(){
  const s = el("status");
  s.className="status-pill"; s.textContent="Loading live data...";
  el("refresh").disabled = true;
  try{
    const r = await fetch("/api/leads",{cache:"no-store"});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||("HTTP "+r.status));
    DATA = d;
    render(d);
    s.className="status-pill live";
    s.textContent = "Live from GoHighLevel, "+new Date(d.generatedAt).toLocaleString();
  }catch(e){
    s.className="status-pill err";
    s.textContent = "Could not load live data: "+e.message;
  }finally{
    el("refresh").disabled = false;
  }
}

function render(d){
  el("rule").innerHTML = `
    <h3>${esc(d.rule.title)}</h3>
    <p class="intro">${esc(d.rule.intro)}</p>
    <div class="cols">
      <div class="col flag">
        <div class="lbl">${esc(d.rule.flagsTitle)}</div>
        <ul>${d.rule.flags.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
      </div>
      <div class="col ok">
        <div class="lbl">Remember</div>
        <div class="okbox">${esc(d.rule.note)}</div>
      </div>
    </div>`;

  el("summary").innerHTML = `
    <div class="stat blue"><div class="n">${d.totals.booked}</div><div class="l">Booked, reach out before the call</div></div>
    <div class="stat red"><div class="n">${d.totals.noshow}</div><div class="l">No-shows, nudge them to rebook</div></div>
    <div class="stat amber"><div class="n">${d.totals.flagged}</div><div class="l">Flagged, check before reaching out</div></div>`;

  el("tabs").innerHTML = `
    <button class="tab ${TAB==='booked'?'on':''}" data-tab="booked">Booked <span>${d.totals.booked}</span></button>
    <button class="tab ${TAB==='noshow'?'on':''}" data-tab="noshow">No-shows <span>${d.totals.noshow}</span></button>`;
  el("tabs").querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{ TAB=b.dataset.tab; renderGroups(); el("tabs").querySelectorAll(".tab").forEach(x=>x.classList.toggle("on",x.dataset.tab===TAB)); }));

  renderGroups();
}

function renderGroups(){
  const d = DATA; const reps = TAB==="noshow" ? d.noshow : d.booked;
  const g = el("groups"); g.innerHTML="";
  if(!reps.length){
    g.innerHTML = `<div class="empty-state">${TAB==="noshow"?"No no-shows right now. Nice.":"No booked calls right now."}</div>`;
    return;
  }
  reps.forEach(rep=>{
    const box = document.createElement("div"); box.className="group";
    const flagPill = rep.flagged>0 ? `<span class="count">${rep.flagged} flagged</span>` : "";
    box.innerHTML = `<div class="grouphead">
      <span class="avatar">${initials(rep.repName)}</span>
      <h2>${esc(rep.repName)}</h2>
      <span class="total strong">${rep.total} to reach</span>
      ${flagPill}
    </div>`;
    const rows = document.createElement("div"); rows.className="rows";
    rep.leads.forEach(l=>{
      const row = document.createElement("div");
      row.className = "row"+(l.flagged?"":" calm");
      const badge = l.flagged
        ? `<span class="badge red">${esc(l.primaryFlag.label)}</span>`
        : `<span class="badge soft">${esc(l.source)}</span>`;
      row.innerHTML = `<span class="dotmark ${l.flagged?"red":(l.status==="noshow"?"amber":"green")}"></span>
        <div class="who"><div class="nm">${esc(l.name)}</div><div class="co">${esc(l.company||l.email)} &middot; ${esc(l.stage)}</div></div>
        ${badge}<span class="go">&rsaquo;</span>`;
      row.addEventListener("click",()=>openSheet(l));
      rows.appendChild(row);
    });
    box.appendChild(rows); g.appendChild(box);
  });
}

function prepBlock(l){
  const rows = [
    ["Contact card in the Hub", l.links.contact, "Open"],
    ["Free Trials pipeline", l.links.pipeline, "Open"],
    ["Conversify (LinkedIn chats)", l.links.conversify, "Open"],
    ["Intro call script", l.links.script, "Open"],
    ["Interview booking link", l.links.interviewBooking, "Open"],
  ];
  const appt = l.appointment && l.appointment.at
    ? `<div class="appt"><span class="ch">Appointment</span> ${esc(when(l.appointment.at))}${l.timezone?` &middot; ${esc(l.timezone)}`:""}</div>` : "";
  const src = `<div class="srcnote"><b>${esc(l.source)}.</b> ${esc(l.sourceCheck)}</div>`;
  return `<div class="dohead">Call prep, everything you need</div>
    ${appt}${src}
    <div class="prep">${rows.map(([t,u])=>`<a class="preplink" href="${esc(u)}" target="_blank" rel="noopener"><span>${esc(t)}</span><span class="arr">Open &rsaquo;</span></a>`).join("")}</div>`;
}

function sentBlock(l){
  const email = l.lastEmail
    ? `<div class="sent-item"><div class="sent-h"><span class="ch">Email</span><span class="when">${esc(ago(l.lastEmail.at))}</span></div>
        <div class="sent-subj">${esc(l.lastEmail.subject)}</div><div class="sent-snip">${esc(l.lastEmail.snippet)}</div></div>`
    : `<div class="sent-item empty">No email on record</div>`;
  const st = l.lastSms ? l.lastSms.status : null;
  const cls = st==="delivered"?"ok":(st==="failed"||st==="undelivered")?"bad":"muted";
  const sms = l.lastSms
    ? `<div class="sent-item"><div class="sent-h"><span class="ch">SMS</span><span class="tagstatus ${cls}">${esc(st)}</span><span class="when">${esc(ago(l.lastSms.at))}</span></div>
        <div class="sent-snip">${esc(l.lastSms.body)}</div></div>`
    : `<div class="sent-item empty">No SMS ${l.phone?"on record":"(no phone number)"}</div>`;
  return `<div class="dohead">What we already sent</div><div class="sent">${email}${sms}</div>`;
}

function channelBlocks(l){
  const m = messages(l);
  const out = [];
  l.channels.forEach(ch=>{
    if(ch==="sms"){
      out.push(`<div class="channel">
        <div class="top"><span class="tag sms">SMS</span><b>Personal SMS through GoHighLevel</b></div>
        <div class="box">${esc(m.sms)}</div>
        <div class="btnrow">
          <button class="btn solid" data-act="sms" data-id="${esc(l.contactId)}">Send SMS via GoHighLevel</button>
          <button class="btn" data-act="copy" data-text="${esc(m.sms)}">Copy text</button>
        </div>
        <div class="hint">Sends to ${esc(l.phone)} through GoHighLevel.</div>
      </div>`);
    }else if(ch==="linkedin"){
      out.push(`<div class="channel">
        <div class="top"><span class="tag also">LinkedIn</span><b>Message or connection request</b></div>
        <div class="box">${esc(m.note)}</div>
        <div class="btnrow"><button class="btn" data-act="copy" data-text="${esc(m.note)}">Copy note</button>
        <a class="btn" href="${esc(l.links.conversify)}" target="_blank" rel="noopener">Open Conversify</a></div>
      </div>`);
    }else if(ch==="email"){
      const full = "Subject: "+m.email.subject+"\n\n"+m.email.body;
      out.push(`<div class="channel">
        <div class="top"><span class="tag mail">Email</span><b>Personal email from our business inbox</b></div>
        <div class="subj">${esc(m.email.subject)}</div>
        <div class="box">${esc(m.email.body)}</div>
        <div class="btnrow"><button class="btn" data-act="copy" data-text="${esc(full)}">Copy email</button></div>
        <div class="hint">Send from our business inbox, not the GoHighLevel email.</div>
      </div>`);
    }
  });
  return out.join("");
}

function openSheet(l){
  const sheet = el("sheet");
  const flagBox = l.flagged
    ? `<div class="verdict flag"><div class="why">Heads up before you reach out</div>${l.flags.map(f=>esc(f.text)).join("<br>")}</div>`
    : "";
  const doHead = l.status==="noshow" ? "Nudge them to rebook, everywhere you can" : "Reach out, everywhere you can";
  sheet.innerHTML = `
    <div class="sh">
      <div><h2>${esc(l.name)}</h2><div class="role">${esc(l.company||l.email)} &middot; owned by ${esc(l.repName)}</div></div>
      <button class="x" data-act="close">&times;</button>
    </div>
    <div class="body">
      ${l.status==="noshow"?`<div class="nshead">Did not show up. Give them an easy way back in.</div>`:""}
      ${flagBox}
      <div class="kv">
        <div class="k">Stage</div><div class="v">${esc(l.stage)}</div>
        <div class="k">Email</div><div class="v">${esc(l.email||"None on file")}</div>
        <div class="k">Phone</div><div class="v">${esc(l.phone||"None on file")}</div>
      </div>
      ${prepBlock(l)}
      ${sentBlock(l)}
      <div class="dohead">${doHead}</div>
      ${channelBlocks(l)}
    </div>`;
  el("scrim").classList.add("open");
}
function closeSheet(){ el("scrim").classList.remove("open"); }

el("sheet").addEventListener("click", async (e)=>{
  const b = e.target.closest("button"); if(!b) return;
  const act = b.dataset.act;
  if(act==="close"){ closeSheet(); return; }
  if(act==="copy"){
    if(navigator.clipboard) navigator.clipboard.writeText(b.dataset.text||"");
    const old=b.textContent; b.textContent="Copied"; b.classList.add("done");
    setTimeout(()=>{ b.textContent=old; b.classList.remove("done"); },1500);
    return;
  }
  if(act==="sms"){
    const contactId=b.dataset.id;
    const message=b.closest(".channel").querySelector(".box").textContent;
    b.textContent="Sending..."; b.disabled=true;
    try{
      const r=await fetch("/api/send-sms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId,message})});
      const d=await r.json();
      if(r.ok && d.ok){ b.textContent="Sent"; b.classList.add("done"); }
      else{ b.textContent="Failed: "+(d.error||"try again"); b.disabled=false; }
    }catch(_){ b.textContent="Failed, try again"; b.disabled=false; }
  }
});

el("scrim").addEventListener("click",e=>{ if(e.target===el("scrim")) closeSheet(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeSheet(); });
el("refresh").addEventListener("click", load);
load();
