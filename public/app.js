// Front-end for the Daily Reach-Out List.
// Fetches /api/leads (live from GoHighLevel) and renders booked leads and
// no-shows per salesperson, each with call-prep links, what we already sent,
// a stage mover, and personal messages across every channel.

const el = (id) => document.getElementById(id);
let DATA = null;
let TAB = "booked";
let REP = "all";

function initials(n){ return (n||"?").split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase(); }
function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function ago(iso){
  if(!iso) return "";
  const h=Math.round((Date.now()-new Date(iso))/3.6e6);
  if(h<1) return "just now";
  if(h<24) return h+"h ago";
  return Math.round(h/24)+"d ago";
}
// The day of the call, in the lead's own time zone (times differ per country, so day only).
function dayLabel(iso, tz){
  if(!iso) return "";
  try{
    const opts = {weekday:"short", month:"short", day:"numeric"};
    if(tz) opts.timeZone = tz;
    return new Date(iso).toLocaleDateString([], opts);
  }catch(_){ try{ return new Date(iso).toLocaleDateString([], {weekday:"short", month:"short", day:"numeric"}); }catch(e){ return ""; } }
}
function typeClass(t){
  const k=(t||"").toLowerCase();
  if(k.includes("interview")) return "t-interview";
  if(k.includes("review")) return "t-review";
  if(k.includes("intro")) return "t-intro";
  if(k.includes("no show")) return "t-noshow";
  if(k.includes("cancel")) return "t-cancel";
  return "t-intro";
}

// Personal message drafts, properly formatted into short paragraphs.
function messages(l){
  const first = (l.name||"there").split(" ")[0];
  const rep = l.repName && l.repName!=="Unassigned" ? l.repName.split(" ")[0] : "";
  const from = rep ? rep+" from Aiconic" : "the Aiconic team";
  const link = l.rebookLink || "";
  if(l.status==="noshow"){
    return {
      sms: "Hi "+first+", "+from+" here. We were on the call today but did not see you come through. Everything ok? If you want, you can grab another time here: "+link,
      note: "Hi "+first+", we were on the call today but did not see you come through. Everything ok? If you want to find another time, here is the link: "+link,
      email: {
        subject: "Sorry we missed you",
        body:
          "Hi "+first+",\n\n"+
          "We were on the call today but did not see you come through, so I wanted to check in. Everything ok? No problem at all if the timing slipped.\n\n"+
          "If you would still like to talk, you can pick a new time here:\n"+link+"\n\n"+
          "Looking forward to it.",
      },
    };
  }
  const isInterview = /interview/i.test(l.stage);
  const line = isInterview
    ? "Saw you booked your interview with us and wanted to say hello before we talk."
    : "Saw you booked a call with us and wanted to reach out personally before we speak.";
  const p2 = isInterview
    ? "We will use the time to really understand your business, so come as you are. If there is anything you want to make sure we cover, just tell me."
    : "No pitch, just a real conversation about your business and how we can help. If anything comes up before then, message me here.";
  return {
    sms: "Hi "+first+", "+from+" here. "+line+" Looking forward to it, and if anything comes up before then just reply here.",
    note: "Hi "+first+", "+from+" here. "+line+" No pitch, just a real conversation. Looking forward to it.",
    email: {
      subject: isInterview ? "Looking forward to your Aiconic interview" : "Looking forward to our call",
      body:
        "Hi "+first+",\n\n"+line+"\n\n"+p2+"\n\nLooking forward to it.",
    },
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
  el("rule").innerHTML =
    '<h3>How to use this</h3>'+
    '<ol class="howto">'+
      '<li>Tap any name to open their card.</li>'+
      '<li>Reach out on every channel you can. The SMS, LinkedIn, and email messages are written for you, ready to send or copy.</li>'+
      '<li>If someone did not show up, open the No-shows tab and send them the rebook message.</li>'+
      '<li>When a call moves or a deal changes, change the stage on the card and GoHighLevel updates on its own.</li>'+
    '</ol>'+
    '<div class="flagline"><b>We flag what matters:</b> no phone so no SMS, an SMS that failed, or a bounced email. A flag never means skip someone. We reach out to everyone.</div>';

  el("summary").innerHTML =
    '<div class="stat blue"><div class="n">'+d.totals.booked+'</div><div class="l">Booked, reach out before the call</div></div>'+
    '<div class="stat red"><div class="n">'+d.totals.noshow+'</div><div class="l">No-shows, nudge them to rebook</div></div>'+
    '<div class="stat amber"><div class="n">'+d.totals.flagged+'</div><div class="l">Flagged, check before reaching out</div></div>';

  const repNames = [...new Set([...d.booked, ...d.noshow].map(r=>r.repName))].sort((a,b)=>a.localeCompare(b));
  const repTotal = (list, rep) => { const r = list.find(x=>x.repName===rep); return r ? r.total : 0; };
  const bCount = REP==="all" ? d.totals.booked : repTotal(d.booked, REP);
  const nCount = REP==="all" ? d.totals.noshow : repTotal(d.noshow, REP);
  el("tabs").innerHTML =
    '<div class="tabgroup">'+
      '<button class="tab '+(TAB==="booked"?"on":"")+'" data-tab="booked">Booked <span>'+bCount+'</span></button>'+
      '<button class="tab '+(TAB==="noshow"?"on":"")+'" data-tab="noshow">No-shows <span>'+nCount+'</span></button>'+
    '</div>'+
    '<select class="repfilter" id="repfilter" aria-label="Salesperson">'+
      '<option value="all"'+(REP==="all"?" selected":"")+'>All salespeople</option>'+
      repNames.map(n=>'<option value="'+esc(n)+'"'+(n===REP?" selected":"")+'>'+esc(n)+'</option>').join("")+
    '</select>';
  el("tabs").querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{ TAB=b.dataset.tab; render(DATA); }));
  el("repfilter").addEventListener("change",e=>{ REP=e.target.value; render(DATA); });

  renderGroups();
}

function renderGroups(){
  const d = DATA; let reps = TAB==="noshow" ? d.noshow : d.booked;
  if(REP!=="all") reps = reps.filter(r=>r.repName===REP);
  const g = el("groups"); g.innerHTML="";
  if(!reps.length){
    const msg = REP!=="all"
      ? esc(REP)+" has no "+(TAB==="noshow"?"no-shows":"booked calls")+" right now."
      : (TAB==="noshow"?"No no-shows right now. Nice.":"No booked calls right now.");
    g.innerHTML = '<div class="empty-state">'+msg+'</div>';
    return;
  }
  reps.forEach(rep=>{
    const box = document.createElement("div"); box.className="group";
    const flagPill = rep.flagged>0 ? '<span class="count">'+rep.flagged+' flagged</span>' : "";
    box.innerHTML = '<div class="grouphead"><span class="avatar">'+initials(rep.repName)+'</span>'+
      '<h2>'+esc(rep.repName)+'</h2><span class="total strong">'+rep.total+' to reach</span>'+flagPill+'</div>';
    const rows = document.createElement("div"); rows.className="rows";
    rep.leads.forEach(l=>{
      const row = document.createElement("div");
      row.className = "row"+(l.flagged?"":" calm");
      const day = dayLabel(l.appointment && l.appointment.at, l.timezone);
      const meta = [
        '<span class="ctype '+typeClass(l.callType)+'">'+esc(l.callType)+'</span>',
        day ? '<span class="day">'+esc(day)+'</span>' : "",
        '<span class="src">'+esc(l.source)+'</span>',
      ].filter(Boolean).join('<span class="mdot">&middot;</span>');
      const badge = l.flagged ? '<span class="badge red">'+esc(l.primaryFlag.label)+'</span>' : "";
      row.innerHTML = '<span class="dotmark '+(l.flagged?"red":(l.status==="noshow"?"amber":"green"))+'"></span>'+
        '<div class="who"><div class="nm">'+esc(l.name)+'</div><div class="co">'+meta+'</div></div>'+
        badge+'<span class="go">&rsaquo;</span>';
      row.addEventListener("click",()=>openSheet(l));
      rows.appendChild(row);
    });
    box.appendChild(rows); g.appendChild(box);
  });
}

function stageMover(l){
  const opts = DATA.stages.map(s=>'<option value="'+esc(s.id)+'"'+(s.id===l.stageId?" selected":"")+'>'+esc(s.name)+'</option>').join("");
  return '<div class="dohead">Move stage</div>'+
    '<div class="stagerow">'+
      '<select class="stagesel" data-opp="'+esc(l.id)+'">'+opts+'</select>'+
      '<span class="stagemsg" id="stagemsg"></span>'+
    '</div>'+
    '<div class="hint" style="margin-bottom:16px">Changing this moves the deal in GoHighLevel right away.</div>';
}

function prepBlock(l){
  const rows = [
    ["Contact card in the Hub", l.links.contact],
    ["Conversify (LinkedIn chats)", l.links.conversify],
    ["Intro call script", l.links.script],
    ["Interview booking link", l.links.interviewBooking],
    ["Open pipeline in the CRM", l.links.pipeline],
  ];
  const appt = l.appointment && l.appointment.at
    ? '<div class="appt"><span class="ch">Call</span> '+esc(l.callType)+' &middot; '+esc(dayLabel(l.appointment.at, l.timezone))+'</div>' : "";
  const src = '<div class="srcnote"><b>'+esc(l.source)+'.</b> '+esc(l.sourceCheck)+'</div>';
  return '<div class="dohead">Call prep, everything you need</div>'+appt+src+
    '<div class="prep">'+rows.map(r=>'<a class="preplink" href="'+esc(r[1])+'" target="_blank" rel="noopener"><span>'+esc(r[0])+'</span><span class="arr">Open &rsaquo;</span></a>').join("")+'</div>';
}

function sentBlock(l){
  const email = l.lastEmail
    ? '<div class="sent-item"><div class="sent-h"><span class="ch">Email</span><span class="when">'+esc(ago(l.lastEmail.at))+'</span></div>'+
        '<div class="sent-subj">'+esc(l.lastEmail.subject)+'</div><div class="sent-snip">'+esc(l.lastEmail.snippet)+'</div></div>'
    : '<div class="sent-item empty">No email on record</div>';
  const st = l.lastSms ? l.lastSms.status : null;
  const cls = st==="delivered"?"ok":(st==="failed"||st==="undelivered")?"bad":"muted";
  const sms = l.lastSms
    ? '<div class="sent-item"><div class="sent-h"><span class="ch">SMS</span><span class="tagstatus '+cls+'">'+esc(st)+'</span><span class="when">'+esc(ago(l.lastSms.at))+'</span></div>'+
        '<div class="sent-snip">'+esc(l.lastSms.body)+'</div></div>'
    : '<div class="sent-item empty">No SMS '+(l.phone?"on record":"(no phone number)")+'</div>';
  return '<div class="dohead">What we already sent</div><div class="sent">'+email+sms+'</div>';
}

function channelBlocks(l){
  const m = messages(l);
  const out = [];
  l.channels.forEach(ch=>{
    if(ch==="sms"){
      out.push('<div class="channel"><div class="top"><span class="tag sms">SMS</span><b>Personal SMS through GoHighLevel</b></div>'+
        '<div class="box">'+esc(m.sms)+'</div>'+
        '<div class="btnrow"><button class="btn solid" data-act="sms" data-id="'+esc(l.contactId)+'">Send SMS via GoHighLevel</button>'+
        '<button class="btn" data-act="copy" data-text="'+esc(m.sms)+'">Copy text</button></div>'+
        '<div class="hint">Sends to '+esc(l.phone)+' through GoHighLevel.</div></div>');
    }else if(ch==="linkedin"){
      out.push('<div class="channel"><div class="top"><span class="tag also">LinkedIn</span><b>Message or connection request</b></div>'+
        '<div class="box">'+esc(m.note)+'</div>'+
        '<div class="btnrow"><button class="btn" data-act="copy" data-text="'+esc(m.note)+'">Copy note</button>'+
        '<a class="btn" href="'+esc(l.links.conversify)+'" target="_blank" rel="noopener">Open Conversify</a></div></div>');
    }else if(ch==="email"){
      out.push('<div class="channel"><div class="top"><span class="tag mail">Email</span><b>Personal email from our business inbox</b></div>'+
        '<div class="subjrow"><div class="subj">'+esc(m.email.subject)+'</div><button class="btn tiny" data-act="copy" data-text="'+esc(m.email.subject)+'">Copy subject</button></div>'+
        '<div class="box">'+esc(m.email.body)+'</div>'+
        '<div class="btnrow"><button class="btn" data-act="copy" data-text="'+esc(m.email.body)+'">Copy email body</button></div>'+
        '<div class="hint">Send from our business inbox, not the GoHighLevel email.</div></div>');
    }
  });
  return out.join("");
}

function openSheet(l){
  const sheet = el("sheet");
  const flagBox = l.flagged
    ? '<div class="verdict flag"><div class="why">Heads up before you reach out</div>'+l.flags.map(f=>esc(f.text)).join("<br>")+'</div>'
    : "";
  const doHead = l.status==="noshow" ? "Nudge them to rebook, everywhere you can" : "Reach out, everywhere you can";
  sheet.innerHTML =
    '<div class="sh"><div><h2>'+esc(l.name)+'</h2><div class="role">'+esc(l.company||l.email)+' &middot; owned by '+esc(l.repName)+'</div></div>'+
      '<button class="x" data-act="close">&times;</button></div>'+
    '<div class="body">'+
      (l.status==="noshow"?'<div class="nshead">Did not show up. Give them an easy way back in.</div>':"")+
      flagBox+
      '<div class="kv">'+
        '<div class="k">Call</div><div class="v">'+esc(l.callType)+(l.appointment&&l.appointment.at?' &middot; '+esc(dayLabel(l.appointment.at,l.timezone)):"")+'</div>'+
        '<div class="k">Email</div><div class="v">'+esc(l.email||"None on file")+'</div>'+
        '<div class="k">Phone</div><div class="v">'+esc(l.phone||"None on file")+'</div>'+
      '</div>'+
      sentBlock(l)+
      '<div class="dohead">'+doHead+'</div>'+
      channelBlocks(l)+
      stageMover(l)+
      prepBlock(l)+
    '</div>';
  el("scrim").classList.add("open");
}
function closeSheet(){ el("scrim").classList.remove("open"); }

el("sheet").addEventListener("change", async (e)=>{
  const sel = e.target.closest(".stagesel"); if(!sel) return;
  const opp = sel.dataset.opp;
  const pipelineStageId = sel.value;
  const msg = el("stagemsg");
  msg.textContent = "Moving..."; msg.className="stagemsg";
  sel.disabled = true;
  try{
    const r = await fetch("/api/update-stage",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({opportunityId:opp, pipelineStageId})});
    const d = await r.json();
    if(r.ok && d.ok){ msg.textContent="Moved"; msg.className="stagemsg ok"; }
    else { msg.textContent="Failed: "+(d.error||"try again"); msg.className="stagemsg bad"; }
  }catch(_){ msg.textContent="Failed, try again"; msg.className="stagemsg bad"; }
  finally{ sel.disabled = false; }
});

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
