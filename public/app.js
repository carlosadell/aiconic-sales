// Front-end for the Daily Reach-Out List.
// Fetches /api/leads (live from GoHighLevel) and renders the pipeline per
// salesperson, with the reason on every lead and a send-SMS action.

const el = (id) => document.getElementById(id);
let DATA = null;

function initials(n){ return (n||"?").split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase(); }
function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

// Build the messages for a lead from its own facts. Plain sentences, no dashes.
function messages(l){
  const first = (l.name||"there").split(" ")[0];
  const isInterview = /interview/i.test(l.stage);
  const rep = l.repName && l.repName!=="Unassigned" ? l.repName.split(" ")[0] : "the Aiconic team";
  if(isInterview){
    return {
      emailSubject: `Before your Aiconic interview`,
      emailBody: `Hi ${first}, a quick note before your interview with us. We sent your prep questions over, so have a look before we talk. We did not have a working number for you, so reply here if anything is unclear. Talk soon.`,
      note: `Hi ${first}, a quick note before your Aiconic interview. We sent your prep questions by email, so have a look before we talk. We did not have a working number for you, so reply here if anything is unclear.`,
    };
  }
  return {
    emailSubject: `Your Aiconic intro call`,
    emailBody: `Hi ${first}, you are booked in for a quick intro call with us. Here is the link: [paste link]. We did not have a working number for you, so I wanted to reach out and make sure you have everything you need. Looking forward to the conversation.`,
    note: `Hi ${first}, ${rep} from Aiconic here. You booked an intro call with us. We did not have a working number for you, so I wanted to connect and make sure you have the link. Looking forward to it.`,
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
    const t = new Date(d.generatedAt);
    s.className="status-pill live";
    s.textContent = "Live from GoHighLevel, "+t.toLocaleString();
  }catch(e){
    s.className="status-pill err";
    s.textContent = "Could not load live data: "+e.message;
  }finally{
    el("refresh").disabled = false;
  }
}

function render(d){
  // rule panel
  el("rule").innerHTML = `
    <h3>${esc(d.rule.title)}</h3>
    <p class="intro">${esc(d.rule.intro)}</p>
    <div class="cols">
      <div class="col flag">
        <div class="lbl">Flagged to reach when</div>
        <ul>${d.rule.needsReach.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
      </div>
      <div class="col ok">
        <div class="lbl">Not flagged</div>
        <div class="okbox">${esc(d.rule.reached)}</div>
      </div>
    </div>`;

  // summary
  el("summary").innerHTML = `
    <div class="stat amber"><div class="n">${d.totalNeedsReach}</div><div class="l">Need a manual reach-out</div></div>
    <div class="stat blue"><div class="n">${d.totalBooked}</div><div class="l">Total booked and active</div></div>
    <div class="stat green"><div class="n">${d.totalBooked - d.totalNeedsReach}</div><div class="l">Already reached automatically</div></div>`;

  // groups
  const g = el("groups"); g.innerHTML="";
  d.reps.forEach(rep=>{
    const box = document.createElement("div"); box.className="group";
    const countCls = rep.needsReach===0 ? "count zero" : "count";
    box.innerHTML = `<div class="grouphead">
      <span class="avatar">${initials(rep.repName)}</span>
      <h2>${esc(rep.repName)}</h2>
      <span class="${countCls}">${rep.needsReach} to reach</span>
      <span class="total">${rep.total} booked</span>
    </div>`;
    const rows = document.createElement("div"); rows.className="rows";
    rep.leads.forEach(l=>{
      const row = document.createElement("div");
      row.className = "row"+(l.needsReach?"":" reached");
      const badge = l.needsReach
        ? `<span class="badge red">${l.code==="no_phone"?"No phone":l.code==="sms_failed"?"SMS failed":l.code==="email_bounced"?"Email invalid":"Reach"}</span>`
        : `<span class="badge green">Reached</span>`;
      row.innerHTML = `<span class="dotmark ${l.needsReach?"red":"green"}"></span>
        <div class="who"><div class="nm">${esc(l.name)}</div><div class="co">${esc(l.company||l.email)} &middot; ${esc(l.stage)}</div></div>
        ${badge}<span class="go">&rsaquo;</span>`;
      row.addEventListener("click",()=>openSheet(l));
      rows.appendChild(row);
    });
    box.appendChild(rows); g.appendChild(box);
  });
}

function channelBlocks(l){
  const m = messages(l);
  const fullEmail = "Subject: "+m.emailSubject+"\n\n"+m.emailBody;
  const blocks = [];
  l.channels.forEach(ch=>{
    if(ch==="sms"){
      blocks.push(`<div class="channel">
        <div class="top"><span class="tag sms">Do first</span><b>Text by SMS through GoHighLevel</b></div>
        <div class="box">${esc(m.note)}</div>
        <div class="btnrow">
          <button class="btn solid" data-act="sms" data-id="${esc(l.contactId)}">Send SMS via GoHighLevel</button>
          <button class="btn" data-act="copy" data-text="${esc(m.note)}">Copy text</button>
        </div>
        <div class="hint">Sends to ${esc(l.phone)} through GoHighLevel.</div>
      </div>`);
    }else if(ch==="email"){
      blocks.push(`<div class="channel">
        <div class="top"><span class="tag req">Minimum</span><b>Email from our business inbox</b></div>
        <div class="subj">${esc(m.emailSubject)}</div>
        <div class="box">${esc(m.emailBody)}</div>
        <div class="btnrow"><button class="btn" data-act="copy" data-text="${esc(fullEmail)}">Copy email</button></div>
        <div class="hint">Send from our business inbox, not the GoHighLevel email.</div>
      </div>`);
    }else if(ch==="linkedin"){
      blocks.push(`<div class="channel">
        <div class="top"><span class="tag also">Also</span><b>Connection request on LinkedIn</b></div>
        <div class="box">${esc(m.note)}</div>
        <div class="btnrow"><button class="btn" data-act="copy" data-text="${esc(m.note)}">Copy note</button></div>
        <div class="hint">Put this in the connection request. Do not wait on the accept.</div>
      </div>`);
    }
  });
  return blocks.join("");
}

function openSheet(l){
  const sheet = el("sheet");
  const verdictCls = l.needsReach ? "flag" : "ok";
  const doSection = l.needsReach
    ? `<div class="dohead">Reach out now</div>${channelBlocks(l)}`
    : "";
  sheet.innerHTML = `
    <div class="sh">
      <div><h2>${esc(l.name)}</h2><div class="role">${esc(l.company||l.email)} &middot; owned by ${esc(l.repName)}</div></div>
      <button class="x" data-act="close">&times;</button>
    </div>
    <div class="body">
      <div class="verdict ${verdictCls}">
        <div class="why">${l.needsReach?"Why this lead is flagged":"Why no action is needed"}</div>
        ${esc(l.reason)}
      </div>
      <div class="kv">
        <div class="k">Booking</div><div class="v">${esc(l.stage)}</div>
        <div class="k">Email</div><div class="v">${esc(l.email||"None on file")}</div>
        <div class="k">Phone</div><div class="v">${esc(l.phone||"None on file")}</div>
        <div class="k">SMS status</div><div class="v">${esc(l.smsStatus||"Not sent")}</div>
      </div>
      ${doSection}
    </div>`;
  el("scrim").classList.add("open");
}
function closeSheet(){ el("scrim").classList.remove("open"); }

// event delegation for modal buttons
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
    const box=b.closest(".channel").querySelector(".box");
    const message=box.textContent;
    b.textContent="Sending..."; b.disabled=true;
    try{
      const r=await fetch("/api/send-sms",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contactId,message})});
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
