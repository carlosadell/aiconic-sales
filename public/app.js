// Front-end for the Daily Reach-Out List.
// Fetches /api/leads (live from the CRM) and renders booked leads and
// no-shows per salesperson, each with call-prep links, what we already sent,
// a stage mover, and personal messages across every channel.

const el = (id) => document.getElementById(id);
let DATA = null;
let REP = "all";
let REP_NAMES = [];

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
  if(k.includes("book interview")||k.includes("booking interview")) return "t-bookint";
  if(k.includes("book review")||k.includes("booking review")) return "t-bookrev";
  if(k.includes("rebook")||k.includes("no show")) return "t-noshow";
  if(k.includes("interview")) return "t-interview";
  if(k.includes("review")) return "t-review";
  if(k.includes("reschedul")) return "t-resched";
  if(k.includes("cancel")||k.includes("never")) return "t-cancel";
  if(k.includes("intro")) return "t-intro";
  return "t-intro";
}

// Personal message drafts, properly formatted into short paragraphs.
function messages(l){
  const first = (l.name||"there").split(" ")[0];
  const rep = l.repName && l.repName!=="Unassigned" ? l.repName.split(" ")[0] : "";
  const from = rep ? rep+" from Aiconic" : "the Aiconic team";
  const link = l.bookingLink || l.rebookLink || "";
  if(l.status==="cancelled"){
    return {
      sms: [
        "Hi "+first+", "+from+" here.",
        "Saw your call got cancelled. No problem at all, these things happen.",
        "If you would still like to talk, you can grab another time here:\n"+link,
      ].join("\n\n"),
      note: [
        "Hi "+first+", "+from+" here.",
        "Saw your call got cancelled. No problem at all, these things happen.",
        "If you would still like to talk, here is the link to pick a new time:\n"+link,
      ].join("\n\n"),
      email: {
        subject: "Want to grab another time?",
        body:
          "Hi "+first+",\n\n"+
          "I saw your call got cancelled. No problem at all, sometimes the timing just does not work out.\n\n"+
          "If you would still like to talk, you can pick a new time here:\n"+link+"\n\n"+
          "Looking forward to it.",
      },
    };
  }
  if(l.status==="noshow"){
    return {
      sms: [
        "Hi "+first+", "+from+" here.",
        "We were on the call today but did not see you come through. Everything ok?",
        "If you want, you can grab another time here:\n"+link,
      ].join("\n\n"),
      note: [
        "Hi "+first+", "+from+" here.",
        "We were on the call today but did not see you come through. Everything ok?",
        "If you want to find another time, here is the link:\n"+link,
      ].join("\n\n"),
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
    sms: [
      "Hi "+first+", "+from+" here.",
      line,
      "Looking forward to it, and if anything comes up before then just reply here.",
    ].join("\n\n"),
    note: [
      "Hi "+first+", "+from+" here.",
      line,
      "No pitch, just a real conversation. Looking forward to it.",
    ].join("\n\n"),
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
    // The emergency stage is internal only. It never shows in the toolkit.
    d.stages = (d.stages||[]).filter(x=>!/emergency|sorry/i.test(String(x.name||"")));
    d.leads = (d.leads||[]).filter(l=>l.status!=="rescheduling");
    DATA = d;
    render(d);
    s.className="status-pill live";
    s.textContent = "Live from our CRM, "+new Date(d.generatedAt).toLocaleString();
  }catch(e){
    s.className="status-pill err";
    s.textContent = "Could not load live data: "+e.message;
  }finally{
    el("refresh").disabled = false;
  }
}

// Every returned lead. The API now returns a single flat list, each lead tagged
// with its own stageId and status, which is how we bucket by pipeline stage.
function allLeads(d){
  if(d && Array.isArray(d.leads)) return d.leads;
  return [];
}

// Strip the emoji and the "(FUP)" / "(Manual)" notes from a stage name for a
// clean header and plain sentences.
function cleanStage(name){
  return String(name||"")
    .replace(/\((?:triggers\s*)?fup\)/ig,"")
    .replace(/\(manual\)/ig,"")
    .replace(/[^\x20-\x7E]/g,"")
    .replace(/\s{2,}/g," ")
    .trim();
}

// The pipeline map is grouped into three bands. A stage is placed in a band by
// its status (derived from the live stage name), so renaming or reordering a
// stage in the CRM keeps working.
const PIPE_BANDS = [
  { key:"path",  title:"The path to a client", sub:"The calls that move a deal forward, in order.", statuses:["survey","booked","clientwon"], arrows:true },
  { key:"chase", title:"Chase lanes", sub:"A missed, cancelled, or unbooked call waits here and gets reminders until they rebook.", statuses:["noshow","rescheduling","bookinginterview","bookingreview"], arrows:false },
  { key:"out",   title:"Out of play", sub:"End states. Nothing automatic chases from here.", statuses:["baking","notqualified","neverrescheduled"], arrows:false },
];

// Pull the leading emoji out of a live stage name, if it has one.
function stageEmoji(name){
  try{ const m = String(name||"").match(/\p{Extended_Pictographic}/u); return m ? m[0] : ""; }
  catch(_){ const m = String(name||"").match(/[^\x00-\x7F]/); return m ? m[0] : ""; }
}

// The plain-language card shown when you tap a stage: what it is, how you use it,
// how the system works with it, and where people go next. Keyed on status so it
// stays in step with the live pipeline through a rename.
function stageDetail(s){
  const st = s.status;
  const t = String(s.name||"").toLowerCase();
  if(st==="survey") return {
    what:"People who submitted the survey and qualified, but have not booked their intro call yet.",
    how:"They land here on their own when they submit the survey on the funnel landing page and qualify.",
    you:"Reach out personally, send them the intro booking link, and find out why they did not book.",
  };
  if(st==="booked"){
    const call = /interview/.test(t) ? "interview" : /review/.test(t) ? "review call" : "intro call";
    return {
      what:"The lead has their "+call+" booked. The call shows in the Daily Outreach tab.",
      how:"They land here on their own when they book the "+call+".",
      you:"Reach out before the call so they show up. After the call, tap the button on their card that matches what happened.",
    };
  }
  if(st==="noshow") return {
    what:"People who missed or cancelled their intro call. The CRM is sending them reminders to book a new one.",
    how:"They land here when a salesperson taps No show on the intro card, or on their own when they cancel the intro.",
    you:"Reach out to them personally if you have not yet, so they end up booking the intro call.",
  };
  if(st==="bookinginterview") return {
    what:"People who need to book their interview. The CRM is sending them reminders to book it.",
    how:"They land here when a salesperson taps Qualified, interview not booked or No show, or on their own when they cancel the interview.",
    you:"Reach out to them personally if you have not yet, so they end up booking the interview.",
  };
  if(st==="bookingreview") return {
    what:"People who need to book their review call. The CRM is sending them reminders to book it.",
    how:"They land here when a salesperson taps Qualified, review not booked or No show, or on their own when they cancel the review.",
    you:"Reach out to them personally if you have not yet, so they end up booking the review call.",
  };
  if(st==="baking") return {
    what:"People who are interested but need more information or more nurturing, and are not ready yet.",
    how:"They land here when a salesperson taps Nurture for later on a call card.",
    you:"Follow up with them, or make sure the right person on the team does. Some of them need Carlos to give feedback or reach out. Every lead here needs a clear next step and someone who owns it.",
  };
  if(st==="clientwon") return {
    what:"People who became clients.",
    how:"They land here when a salesperson taps Won the client on a call card.",
    you:"Nothing.",
  };
  if(st==="notqualified") return {
    what:"People who are not a fit. All messages to them stop.",
    how:"They land here when a salesperson taps Not a fit on a call card.",
    you:"Nothing.",
  };
  if(st==="neverrescheduled") return {
    what:"People who went through all the reminders and never booked again.",
    how:"They land here on their own when the reminders run out without a booking.",
    you:"Reach out later on to see if they want to book a call again.",
  };
  return {
    what:"A stage in the pipeline.",
    how:"The CRM moves people here.",
    you:"Open a lead to see their details and history.",
  };
}

function render(d){
  const leads = allLeads(d);
  REP_NAMES = [...new Set(leads.map(l=>l.repName))].sort((a,b)=>a.localeCompare(b));
  if(REP!=="all" && !REP_NAMES.includes(REP)) REP="all";
  renderFilters();
  renderDocs();
  renderDaily();
  renderPipeline();
}

// One salesperson filter, shown in both the Daily Outreach and Pipeline tabs and
// kept in sync. Changing either re-renders both.
function repSelect(id){
  return '<div class="filterrow"><select class="repfilter" id="'+id+'" aria-label="Salesperson">'+
    '<option value="all"'+(REP==="all"?" selected":"")+'>All salespeople</option>'+
    REP_NAMES.map(n=>'<option value="'+esc(n)+'"'+(n===REP?" selected":"")+'>'+esc(n)+'</option>').join("")+
    '</select></div>';
}
function renderFilters(){
  const dt=el("dailytools");
  if(dt){ dt.innerHTML=repSelect("dailyfilter"); const s=dt.querySelector("#dailyfilter"); if(s) s.addEventListener("change",e=>{ REP=e.target.value; render(DATA); }); }
  const pt=el("pipetools");
  if(pt){ pt.innerHTML=repSelect("pipefilter"); const s=pt.querySelector("#pipefilter"); if(s) s.addEventListener("change",e=>{ REP=e.target.value; render(DATA); }); }
}

function renderDocs(){
  const box=el("pipedocs"); if(!box) return;
  box.innerHTML =
    '<div class="infocard">'+
      '<h3>What a red flag means</h3>'+
      '<p class="ip">A red flag on a lead means reaching them needs a look first: no phone on file so the automatic SMS could not be sent, an SMS that failed, or a bounced email. It never means skip the lead. You still reach out, you just know which channel is most likely to land. For the messages behind each stage, see the <b>Communications</b> tab.</p>'+
    '</div>';
}

// One lead row, used in both views. showRep puts the salesperson in the meta
// line (the board and the upcoming list mix reps, so you want to see whose it is).
function rowEl(l, showRep){
  const row=document.createElement("div");
  row.className="row"+(l.flagged?"":" calm");
  const day=dayLabel(l.appointment && l.appointment.at, l.timezone);
  const meta=[
    '<span class="ctype '+typeClass(l.callType)+'">'+esc(l.callType)+'</span>',
    day?'<span class="day">'+esc(day)+'</span>':"",
    showRep?'<span class="src">'+esc(l.repName)+'</span>':'<span class="src">'+esc(l.source)+'</span>',
  ].filter(Boolean).join('<span class="mdot">&middot;</span>');
  const badge=l.flagged?'<span class="badge red">'+esc(l.primaryFlag.label)+'</span>':"";
  const dotCls=l.flagged?"red":l.status==="noshow"?"amber":l.status==="rescheduling"?"violet":l.status==="bookinginterview"?"teal":l.status==="bookingreview"?"indigo":l.status==="survey"?"teal":(l.status==="cancelled"||l.status==="notqualified"||l.status==="neverrescheduled"||l.status==="baking")?"slate":"green";
  row.innerHTML='<span class="dotmark '+dotCls+'"></span>'+
    '<div class="who"><div class="nm">'+esc(l.name)+'</div><div class="co">'+meta+'</div></div>'+
    badge+'<span class="go">&rsaquo;</span>';
  row.addEventListener("click",()=>openSheet(l));
  return row;
}

// A stable day key (YYYY-MM-DD) in the given time zone, for grouping calls.
function dayKey(iso, tz){
  try{ const o={year:"numeric",month:"2-digit",day:"2-digit"}; if(tz) o.timeZone=tz; return new Date(iso).toLocaleDateString("en-CA",o); }
  catch(_){ try{ return new Date(iso).toISOString().slice(0,10); }catch(e){ return ""; } }
}

// Daily Outreach: only the upcoming scheduled calls (intro, interview, review),
// in one column, soonest first, grouped under a heading for each day so it reads
// straight down. Everything else lives on the Pipeline board.
function renderDaily(){
  const box=el("upcoming"); if(!box) return;
  const startToday=new Date(); startToday.setHours(0,0,0,0);
  let ups=allLeads(DATA).filter(l=>l.status==="booked" && l.appointment && l.appointment.at);
  ups=ups.filter(l=> new Date(l.appointment.at).getTime() >= startToday.getTime());
  if(REP!=="all") ups=ups.filter(l=>l.repName===REP);
  ups.sort((a,b)=> new Date(a.appointment.at)-new Date(b.appointment.at));
  box.innerHTML="";
  if(!ups.length){
    box.innerHTML='<div class="empty-state">'+(REP!=="all"?esc(REP)+" has no upcoming calls right now.":"No upcoming calls right now.")+'</div>';
    return;
  }
  const todayKey=dayKey(new Date().toISOString());
  const tmrKey=dayKey(new Date(Date.now()+86400000).toISOString());
  const list=document.createElement("div"); list.className="daylist";
  let curKey=null;
  ups.forEach(l=>{
    const k=dayKey(l.appointment.at, l.timezone);
    if(k!==curKey){
      curKey=k;
      let label=dayLabel(l.appointment.at, l.timezone);
      if(k===todayKey) label="Today";
      else if(k===tmrKey) label="Tomorrow";
      const cnt=ups.filter(x=>dayKey(x.appointment.at, x.timezone)===k).length;
      const head=document.createElement("div"); head.className="dayhead";
      head.innerHTML='<span class="dayhead-d">'+esc(label)+'</span><span class="dayhead-c">'+cnt+' call'+(cnt===1?"":"s")+'</span>';
      list.appendChild(head);
    }
    list.appendChild(rowEl(l,true));
  });
  box.appendChild(list);
}

// Leads in a stage, filtered by the current salesperson and sorted by call day.
function stageLeads(stageId){
  let list=allLeads(DATA).filter(l=>l.stageId===stageId);
  if(REP!=="all") list=list.filter(l=>l.repName===REP);
  list.sort((a,b)=>{
    const ta=a.appointment&&a.appointment.at?new Date(a.appointment.at).getTime():Infinity;
    const tb=b.appointment&&b.appointment.at?new Date(b.appointment.at).getTime():Infinity;
    if(ta!==tb) return ta-tb;
    return String(a.name||"").localeCompare(String(b.name||""));
  });
  return list;
}

// The label on a chase lane, by status.
function laneWhen(s){
  if(s.status==="rescheduling") return "Emergency";
  if(s.status==="noshow") return "If missed";
  return "If not booked";
}

// One numbered milestone row on the timeline.
function pipeMainRow(s, num){
  const n=stageLeads(s.id).length;
  const emoji=stageEmoji(s.name);
  const row=document.createElement("div"); row.className="pfstage";
  row.innerHTML=
    '<div class="pfnode">'+num+'</div>'+
    '<div class="pfcard">'+
      (emoji?'<span class="pf-emoji">'+esc(emoji)+'</span>':'')+
      '<span class="pf-name">'+esc(cleanStage(s.name))+'</span>'+
      '<span class="pf-count">'+n+'</span><span class="pf-people">'+(n===1?"lead":"leads")+'</span>'+
      '<span class="pf-go">&rsaquo;</span>'+
    '</div>';
  row.addEventListener("click",()=>openStageSheet(s));
  return row;
}

// A chase lane, indented under the call it belongs to.
function pipeSubRow(s){
  const n=stageLeads(s.id).length;
  const emoji=stageEmoji(s.name);
  const row=document.createElement("div"); row.className="pfsub"+(n>0?" hot":"");
  row.innerHTML=
    '<span class="pfsub-when">'+esc(laneWhen(s))+'</span>'+
    (emoji?'<span class="pf-emoji sm">'+esc(emoji)+'</span>':'')+
    '<span class="pf-name">'+esc(cleanStage(s.name))+'</span>'+
    '<span class="pf-count">'+n+'</span><span class="pf-people">'+(n===1?"lead":"leads")+'</span>'+
    '<span class="pf-go">&rsaquo;</span>';
  row.addEventListener("click",()=>openStageSheet(s));
  return row;
}

// A closed end state, shown as a chip in the footer.
function pipeChip(s){
  const n=stageLeads(s.id).length;
  const emoji=stageEmoji(s.name);
  const chip=document.createElement("button"); chip.type="button"; chip.className="pfchip";
  chip.innerHTML=(emoji?'<span class="pf-emoji sm">'+esc(emoji)+'</span>':'')+
    '<span class="pfchip-n">'+esc(cleanStage(s.name))+'</span>'+
    '<span class="pf-count">'+n+'</span>';
  chip.addEventListener("click",()=>openStageSheet(s));
  return chip;
}

// Pipeline as one vertical timeline: every stage, numbered 1 upward, in the exact
// order they sit in the CRM, read straight down. Tap any step to open its card,
// which says what the stage is, how to use it, how the system works with it, and
// who is in it.
function renderPipeline(){
  const box=el("board"); if(!box) return;
  const stages=(DATA.stages||[]).slice().sort((a,b)=>(a.position||0)-(b.position||0));
  box.innerHTML="";
  if(!stages.length){ box.innerHTML='<div class="empty-state">Could not load the pipeline stages.</div>'; return; }
  const flow=document.createElement("div"); flow.className="pipeflow";
  stages.forEach((s,i)=>flow.appendChild(pipeMainRow(s, i+1)));
  box.appendChild(flow);
}

// The stage card. Opens in the same sheet as a lead. Explains the stage in plain
// language, then lists everyone in it; tapping a person opens their lead card.
function openStageSheet(s){
  const sheet=el("sheet");
  const list=stageLeads(s.id);
  const d=stageDetail(s);
  const emoji=stageEmoji(s.name);
  const secs=[
    ["What this stage is", d.what],
    ["How leads get here", d.how],
    ["What you should do", d.you],
  ].map(x=>'<div class="sd-sec"><div class="sd-h">'+x[0]+'</div>'+(Array.isArray(x[1])
      ? '<div class="sd-map">'+x[1].map(r=>'<div class="sd-mrow"><span class="sd-btn">'+esc(r[0])+'</span><span class="sd-arr">&rarr;</span><span class="sd-dest">'+esc(r[1])+'</span></div>').join("")+'</div>'
      : '<p>'+esc(x[1])+'</p>')+'</div>').join("");
  sheet.innerHTML=
    '<div class="sh"><div><h2>'+(emoji?esc(emoji)+" ":"")+esc(cleanStage(s.name))+'</h2></div>'+
      '<button class="x" data-act="close">&times;</button></div>'+
    '<div class="body stagesheet">'+
      secs+
      '<div class="dohead">Who is here now <span class="cnt">'+list.length+'</span></div>'+
      '<div id="stagerows"></div>'+
    '</div>';
  const rowsBox=sheet.querySelector("#stagerows");
  if(!list.length){ rowsBox.innerHTML='<div class="stage-empty">Nobody here right now.</div>'; }
  else{ const rows=document.createElement("div"); rows.className="rows"; list.forEach(l=>rows.appendChild(rowEl(l,true))); rowsBox.appendChild(rows); }
  el("scrim").classList.add("open");
}

// The action buttons that move a lead. Stages are automatic and cannot be moved
// by hand from the toolkit. Each button adds one tag, and the tag triggers the
// matching workflow in the CRM, which sets the stage and starts the right
// messages. Which buttons show depends on where the lead is now, so a rep only
// ever sees the two or three that make sense.
// The action buttons that move a lead. Stages move automatically and cannot be
// moved by hand from the toolkit. The next call is normally booked during the
// call, and then the lead moves on its own. These buttons are only for when
// something did not happen: a no show, the next call not booked, not a fit, or
// an emergency. Each button adds one tag, and the tag triggers the matching
// workflow in the CRM. Each card only shows the buttons for its own call.
function actionPlan(l){
  const s=l.status, st=l.stage||"";
  const isInterview=/interview/i.test(st), isReview=/review/i.test(st);
  const B={
    noshowIntro:{label:"No show", tag:"noshow-intro", tone:"chase", icon:"🔁", what:"They did not turn up. Starts the reminders asking them to rebook the intro call."},
    noBookInterview:{label:"Qualified, interview not booked", tag:"pending-interview", tone:"blue", icon:"✅", what:"They qualified but did not book the interview on the call. They will book it themselves. Starts the reminders with the interview booking link."},
    noshowInterview:{label:"No show", tag:"noshow-interview", tone:"chase", icon:"🔁", what:"They did not turn up. Starts the reminders asking them to rebook the interview."},
    noBookReview:{label:"Qualified, review not booked", tag:"pending-review", tone:"blue", icon:"✅", what:"The interview went well but they did not book the review on the call. They will book it themselves. Starts the reminders with the review booking link."},
    noshowReview:{label:"No show", tag:"noshow-review", tone:"chase", icon:"🔁", what:"They did not turn up. Starts the reminders asking them to rebook the review."},
    won:{label:"Won the client", tag:"won", tone:"green", icon:"🏆", what:"They signed. Moves them to Client Won."},
    baking:{label:"Nurture for later", tag:"baking", tone:"gray", icon:"🌱", what:"Interested but not ready yet. Moves them to Baking/Nurturing."},
    nq:{label:"Not a fit", tag:"not-qualified", tone:"dark", icon:"⛔", what:"Moves them to Not Qualified and stops all messages."},
  };
  if(s==="booked" && isReview) return {title:"After the review call", auto:"Tap the one that matches what happened.", after:[B.noshowReview,B.baking,B.nq,B.won]};
  if(s==="booked" && isInterview) return {title:"After the interview call", auto:"If they booked the review during the interview, do nothing. The lead moves to Review Booked on its own.", after:[B.noshowInterview,B.noBookReview,B.baking,B.nq,B.won]};
  if(s==="booked") return {title:"After the intro call", auto:"If they booked the interview during the call, do nothing. The lead moves to Interview Booked on its own.", after:[B.noshowIntro,B.noBookInterview,B.baking,B.nq,B.won]};
  return null; // Client Won, Not Qualified, Never Rescheduled are end stages
}

function actionButtons(l){
  const p=actionPlan(l);
  if(!p) return "";
  const row=a=>'<div class="actrow">'+
    '<button type="button" class="pbtn '+a.tone+'" data-act="tag" data-tag="'+esc(a.tag)+'" data-id="'+esc(l.contactId)+'" data-label="'+esc(a.label)+'">'+
      '<span class="pbtn-ic">'+a.icon+'</span><span class="pbtn-l">'+esc(a.label)+'</span></button>'+
    '<div class="actwhat">'+esc(a.what)+'</div></div>';
  let h='<div class="dohead">'+esc(p.title)+'</div><div class="actpanel">';
  if(p.auto) h+='<div class="act-auto">'+esc(p.auto)+'</div>';
  h+='<div class="actlist">'+p.after.map(row).join("")+'</div>';
  if(p.before) h+='<div class="act-h sub">Before the call, only if you cannot make it</div><div class="actlist">'+p.before.map(row).join("")+'</div>';
  h+='<div class="act-foot">Tap once, then tap again to confirm. The system moves the lead and starts the right messages. Stages cannot be moved by hand here.</div></div>';
  return h;
}

function referenceBlock(l){
  const map = {
    survey: "They qualified through the form but have not booked their intro call yet. Reach out and send them the intro booking link so they book. The booking links are in the Links tab.",
    baking: "This lead is being nurtured. Not a client yet, and no automation runs from here. Use this card to look back at their details and previous call notes, and reach out when the timing is right.",
    neverrescheduled: "This lead went through the rebooking reminders and never booked a new time. There is nothing automatic left. Use this card to review their history. Reach back only if something has genuinely changed.",
    clientwon: "This lead became a client. There is nothing to send from here. Use this card to look back at the account, its details, and the notes and Fathom links from its previous calls below.",
    notqualified: "This lead was taken out of the process as not a fit. There is nothing to send from here. Use this card to review who was dropped and read their previous call notes below. Reach back only if something has genuinely changed.",
  };
  return '<div class="dohead">For reference</div><div class="srcnote">'+esc(map[l.status]||"Reference only.")+'</div>';
}

function prepBlock(l){
  const src = '<div class="srcnote"><b>'+esc(l.source)+'.</b> '+esc(l.sourceCheck)+'</div>';
  return '<div class="dohead">This lead</div>'+
    '<div class="kv">'+
      '<div class="k">Stage</div><div class="v">'+esc(cleanStage(l.stage))+'</div>'+
      '<div class="k">Call</div><div class="v">'+esc(l.callType)+(l.appointment&&l.appointment.at?' &middot; '+esc(dayLabel(l.appointment.at,l.timezone)):"")+'</div>'+
      '<div class="k">Email</div><div class="v">'+esc(l.email||"None on file")+'</div>'+
      '<div class="k">Phone</div><div class="v">'+esc(l.phone||"None on file")+'</div>'+
    '</div>'+src+
    (l.links&&l.links.contact?'<div class="prep"><a class="preplink" href="'+esc(l.links.contact)+'" target="_blank" rel="noopener"><span>Open the contact card in the CRM</span><span class="arr">Open &rsaquo;</span></a></div>':"");
}

// Every link a rep might need for this lead, in one place: the lead's own
// reschedule link, the three booking links, and the call scripts.
const REVIEW_BOOKING = "https://links.aiconichub.ai/widget/booking/EkNg9CbinOGLYq4LDtfP";
function linksBlock(l){
  const L = l.links||{};
  const rows = [];
  if(l.status==="booked" && l.rebookIsPersonal && l.rebookLink){
    rows.push(linkCard("", "Reschedule this exact call", "Only before the call happens. Moves this booked call to a new time for this person. It stops working once the call has passed or was cancelled.", l.rebookLink));
  }
  if(l.bookingLink) rows.push(linkCard("", "Intro call booking link", "The plain intro booking page"+(l.source==="LinkedIn"?" for LinkedIn leads.":"."), l.bookingLink));
  if(L.interviewBooking) rows.push(linkCard("", "Interview booking link", "The interview booking page.", L.interviewBooking));
  rows.push(linkCard("", "Review call booking link", "The review call booking page.", REVIEW_BOOKING));
  const docs = [["Intro call script", L.script], ["Interview questions", L.interviewQuestions]].filter(r=>r[1]);
  return '<div class="dohead">Links</div>'+rows.join("")+
    (docs.length?'<div class="prep" style="margin-top:10px">'+docs.map(r=>'<a class="preplink" href="'+esc(r[1])+'" target="_blank" rel="noopener"><span>'+esc(r[0])+'</span><span class="arr">Open &rsaquo;</span></a>').join("")+'</div>':"");
}

function sentBlock(l){
  if(l.commsOk===false){
    return '<div class="dohead">What the lead already received</div>'+
      '<div class="sent"><div class="sent-item warn">Could not load this from the CRM just now. That does not mean nothing was sent, the read failed, most likely a busy moment on the CRM. Hit <b>Refresh</b> at the top and open the card again.</div></div>';
  }
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
  return '<div class="dohead">What the lead already received</div><div class="sent">'+email+sms+'</div>';
}

// One clear card per channel. Text and email send from here through the CRM;
// LinkedIn is copied and sent by the rep. Each card says exactly where the
// message goes, who it comes from, and what happens when you press the button.
let SEND_DOMAIN = "";
function fromAddr(l){
  const rep = (l.repName && !/unassigned/i.test(l.repName)) ? l.repName : "Aiconic";
  const first = rep==="Aiconic" ? "team" : String(rep).trim().split(/\s+/)[0].normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
  return first+'@<span class="from-domain">'+esc(SEND_DOMAIN||"our sending domain")+'</span>';
}
function chanCard(kind, l, m){
  if(kind==="sms"){
    if(!l.phone) return '<div class="chan chan-sms off"><div class="chan-top"><span class="chan-ic">💬</span><span class="chan-name">Text message</span></div><div class="chan-how">No phone number on file, so no text can be sent.</div></div>';
    return '<div class="chan chan-sms"><div class="chan-top"><span class="chan-ic">💬</span><span class="chan-name">Text message</span><span class="chan-mode send">Sends from here</span></div>'+
      '<div class="chan-how">Goes to <b>'+esc(l.phone)+'</b> as a text from our CRM number. It sends when you confirm, and their reply lands in the CRM conversation.</div>'+
      '<textarea class="box editable msg-sms" rows="5">'+esc(m.sms)+'</textarea>'+
      '<div class="btnrow"><button class="btn send sms" data-act="sms" data-id="'+esc(l.contactId)+'" data-label="Send this text">Send this text</button>'+
      '<button class="btn" data-act="copy" data-field="msg-sms">Copy text</button></div></div>';
  }
  if(kind==="email"){
    if(!l.email) return '<div class="chan chan-email off"><div class="chan-top"><span class="chan-ic">✉️</span><span class="chan-name">Email</span></div><div class="chan-how">No email on file, so no email can be sent.</div></div>';
    return '<div class="chan chan-email"><div class="chan-top"><span class="chan-ic">✉️</span><span class="chan-name">Email</span><span class="chan-mode send">Sends from here</span></div>'+
      '<div class="chan-how">Goes to <b>'+esc(l.email)+'</b> from <b>'+fromAddr(l)+'</b>. It sends when you click the button below, and when the customer replies you will see it in their CRM card and in your business Gmail. You can also send the email directly from your business Gmail instead.</div>'+
      '<div class="subjrow"><span class="subj-lbl">Subject</span><input class="subj-input msg-subject" value="'+esc(m.email.subject)+'"></div>'+
      '<textarea class="box editable msg-body" rows="8">'+esc(m.email.body)+'</textarea>'+
      '<div class="btnrow"><button class="btn send email" data-act="email" data-id="'+esc(l.contactId)+'" data-rep="'+esc(l.repName||"")+'" data-label="Send this email">Send this email</button>'+
      '<button class="btn" data-act="copy" data-field="msg-body">Copy email body</button></div></div>';
  }
  return '<div class="chan chan-li"><div class="chan-top"><span class="chan-ic">🔗</span><span class="chan-name">LinkedIn</span><span class="chan-mode self">You send this yourself</span></div>'+
    '<div class="chan-how">The toolkit doesn\'t send LinkedIn messages directly. Copy the text and send it from Conversifi or from your own LinkedIn profile, along with a connection request if you are not connected to the lead yet.</div>'+
    '<textarea class="box editable msg-note" rows="4">'+esc(m.note)+'</textarea>'+
    '<div class="btnrow"><button class="btn" data-act="copy" data-field="msg-note">Copy text</button>'+
    '<a class="btn" href="'+esc(l.links.conversify)+'" target="_blank" rel="noopener">Open Conversifi</a></div></div>';
}

function channelBlocks(l){
  const m = messages(l);
  return l.channels.map(ch=>chanCard(ch==="linkedin"?"linkedin":ch, l, m)).join("");
}

// Reschedule messages. This is NOT a routine option. Rescheduling is only for a
// real emergency or a genuine reason. When it has to happen, reach the person on
// every channel you can, with a real reason, so they know you are not standing
// them up. Each message tells them you are also reaching out on the other
// channels, so they do not sit waiting on the call.
function rescheduleText(l){
  const first = (l.name||"there").split(" ")[0];
  const link = l.status==="rescheduling" ? (l.bookingLink || l.rebookLink || "") : (l.rebookLink || l.bookingLink || "");
  const hasPhone = Boolean(l.phone);
  const verb = { sms: "texting you", linkedin: "reaching out on LinkedIn", email: "sending you an email" };
  function also(cur){
    const others = ["sms","linkedin","email"].filter(c=>c!==cur && (c!=="sms"||hasPhone)).map(c=>verb[c]);
    if(!others.length) return "";
    const joined = others.length>1 ? others.slice(0,-1).join(", ")+" and "+others[others.length-1] : others[0];
    return "I am also "+joined+" just in case, I would hate to have you wait on the call for me.";
  }
  // Same paragraph formatting on every channel, link on its own line.
  function body(cur){
    return [
      "Hey "+first+", I hope you are doing great.",
      "I am reaching out because we have our call coming up, but a personal emergency came up and I will not be able to make it. Would it be possible to reschedule please?",
      "I am very sorry to do this last minute, but life can be unpredictable.",
      "Here is the link for you to find a better time:\n"+link,
      also(cur),
      "Thank you for your understanding, "+first+". I look forward to connecting with you.",
    ].filter(Boolean).join("\n\n");
  }
  return {
    sms: body("sms"),
    note: body("linkedin"),
    email: { subject: "I need to reschedule our call", body: body("email") },
  };
}

function rescheduleBlock(l){
  if(l.status==="noshow"||l.status==="cancelled") return "";
  const m = rescheduleText(l);
  const blocks = [];
  if(l.phone){
    blocks.push('<div class="channel reschedule"><div class="top"><span class="tag resc">SMS</span><b>Text them</b></div>'+
      '<textarea class="box editable msg-sms" rows="5">'+esc(m.sms)+'</textarea>'+
      '<div class="btnrow"><button class="btn solid" data-act="sms" data-id="'+esc(l.contactId)+'">Send SMS via the CRM</button>'+
      '<button class="btn" data-act="copy" data-field="msg-sms">Copy text</button></div></div>');
  }
  blocks.push('<div class="channel reschedule"><div class="top"><span class="tag resc">LinkedIn</span><b>Message them on LinkedIn</b></div>'+
    '<textarea class="box editable msg-note" rows="5">'+esc(m.note)+'</textarea>'+
    '<div class="btnrow"><button class="btn" data-act="copy" data-field="msg-note">Copy note</button>'+
    '<a class="btn" href="'+esc(l.links.conversify)+'" target="_blank" rel="noopener">Open Conversifi</a></div></div>');
  blocks.push('<div class="channel reschedule"><div class="top"><span class="tag resc">Email</span><b>Email them</b></div>'+
    '<div class="subjrow"><input class="subj-input msg-subject" value="'+esc(m.email.subject)+'"><button class="btn tiny" data-act="copy" data-field="msg-subject">Copy subject</button></div>'+
    '<textarea class="box editable msg-body" rows="9">'+esc(m.email.body)+'</textarea>'+
    ''+emailSendRow(l)+'</div>');
  if(l.status==="rescheduling"){
    return '<div class="dohead">Get them to book a new time</div>'+
      '<div class="rwarn resched"><b>They are waiting on a new time.</b> Follow up on every channel you can, SMS, LinkedIn, and email, and send them the booking link. The moment they book, move them back to their call stage. If they go quiet, move them to Not Qualified.</div>'+
      blocks.join("");
  }
  return '<div class="dohead">Only if you truly cannot make the call</div>'+
    '<div class="rwarn"><b>This is not a standard step.</b> Rescheduling is only for a real emergency or a genuine reason, never routine, and never because it feels easier. If you honestly have to move a call, reach the person on every channel you can, SMS, LinkedIn, and email, with a real reason, so they know you are not standing them up and never sit waiting on the call for you. Each message below already tells them you are reaching out on the other channels too.</div>'+
    blocks.join("");
}

// Messages for people who qualified but have not booked their interview yet.
// Same paragraph formatting on every channel, the booking link on its own line.
function interviewText(l){
  const first = (l.name||"there").split(" ")[0];
  const link = (l.links && l.links.interviewBooking) || "";
  const body = [
    "Hi "+first+", great call today!",
    "Your next step is to book your interview as soon as possible.",
    "This is a relaxed working session, nothing to prepare. We will use the time to understand you and your business better before we start the trial.",
    "Please pick a time that works for you here:\n"+link,
    "Looking forward to it.",
  ].join("\n\n");
  return { sms: body, note: body, email: { subject: "Great call today, let's book your interview", body: body } };
}

function interviewBlock(l){
  const m = interviewText(l);
  return '<div class="dohead">Get them to book the interview</div>'+chanCard("sms",l,m)+chanCard("linkedin",l,m)+chanCard("email",l,m);
}

// Messages for people who had their interview but have not booked their review
// call yet. Nothing automatic goes out from this stage, so this is a manual
// nudge. There is no self-serve review link, so we ask them to reply with a
// time and get it booked within the week.
function reviewText(l){
  const first = (l.name||"there").split(" ")[0];
  const body = [
    "Hi "+first+", great speaking with you.",
    "The next step is your review call, where we walk you through the Leads Engine we built for you and how to use it.",
    "Let's get it booked in the next few days. What times work for you this week?",
    "Looking forward to it.",
  ].join("\n\n");
  return { sms: body, note: body, email: { subject: "Let's book your review call", body: body } };
}

function reviewBlock(l){
  const m = reviewText(l);
  return '<div class="dohead">Get them to book the review call</div>'+chanCard("sms",l,m)+chanCard("linkedin",l,m)+chanCard("email",l,m);
}

// The lead's own reschedule link, pulled from their the CRM confirmation
// email. Shown so a rep can see it, open it, or copy it straight from the card.
function linkCard(cls, lbl, note, url){
  return '<div class="linkrow '+cls+'">'+
    '<div class="linkrow-top">'+
      '<a class="linkrow-lbl" href="'+esc(url)+'" target="_blank" rel="noopener">'+lbl+' &rsaquo;</a>'+
      '<button class="btn tiny" data-act="copy" data-text="'+esc(url)+'">Copy link</button></div>'+
    '<div class="hint">'+note+'</div></div>';
}
// Send button under every email draft. The email goes out through the CRM,
// under the rep's own name on our sending domain.
function emailSendRow(l){
  if(!l.email) return '<div class="btnrow"><button class="btn" data-act="copy" data-field="msg-body">Copy email body</button></div><div class="hint">No email on file for this lead.</div>';
  return '<div class="btnrow"><button class="btn solid" data-act="email" data-id="'+esc(l.contactId)+'" data-rep="'+esc(l.repName||"")+'">Send email via the CRM</button>'+
    '<button class="btn" data-act="copy" data-field="msg-body">Copy email body</button></div>';
}
function rebookRow(l){
  const out = [];
  // The personal reschedule link only works BEFORE the call, so only show it
  // for an upcoming booked call. Once a call is a no-show, cancelled, or passed,
  // that link is dead, so we just hand them the intro booking link instead.
  if(l.status==="booked" && l.rebookIsPersonal && l.rebookLink){
    out.push(linkCard(
      "",
      "Reschedule this exact call",
      "Only for a call that has not happened yet. This link moves THIS booked call to a new time for this one person, same call, new slot. It stops working once the call has passed or was cancelled. For a fresh call, use the booking links in the Links tab, or the link already in the message below.",
      l.rebookLink
    ));
  }
  return out.join("");
}

function notesBlock(l){
  return '<div class="dohead">Call notes</div>'+
    '<div class="notes" id="notes"><div class="notes-loading">Loading notes...</div></div>'+
    '<textarea class="box notenew" id="notenew" rows="3" placeholder="Add a note from the call, saved straight to the CRM. Paste the Fathom recording link in here too..."></textarea>'+
    '<div class="btnrow"><button class="btn solid" data-act="savenote" data-id="'+esc(l.contactId)+'" data-user="'+esc(l.repId)+'">Save note</button></div>'+
    '<div class="hint">Notes save to this contact in the CRM and show for everyone. Paste the Fathom recording link into a note after the call.</div>'+
    '<div class="subhead">Log the call</div>'+
    '<a class="calllog" href="https://docs.google.com/spreadsheets/d/1coBj8aCR7DF6qBaW5eL0Qam9sdaHKGsnTXSc2dx3DlU/edit" target="_blank" rel="noopener">Open the call log</a>'+
    '<div class="hint" style="margin-bottom:16px">Log the call in the sheet only if you actually took it, and put your name on it. No-shows and calls you did not take are not logged.</div>';
}

// Notes from the CRM can come back as rich text (HTML), for example the Fathom
// recording note. Strip the tags to clean text, then make any link clickable.
function noteToText(body){
  let s = String(body==null?"":body);
  if(/<[a-z/!]/i.test(s)){
    s = s.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
    try{ const t=document.createElement("div"); t.innerHTML=s; s = t.textContent || t.innerText || ""; }catch(_){ s = s.replace(/<[^>]+>/g, ""); }
  }
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
function noteHtml(body){
  return esc(noteToText(body))
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, "<br>");
}
function renderNotes(notes){
  const box = el("notes"); if(!box) return;
  if(!notes.length){ box.innerHTML = '<div class="notes-empty">No notes yet. Add the first one below.</div>'; return; }
  box.innerHTML = notes.map(n=>
    '<div class="note-item"><div class="note-body">'+noteHtml(n.body)+'</div>'+
    (n.at?'<div class="note-when">'+esc(ago(n.at))+'</div>':"")+'</div>').join("");
}

async function loadNotes(contactId){
  const box = el("notes"); if(!box) return;
  try{
    const r = await fetch("/api/notes?contactId="+encodeURIComponent(contactId),{cache:"no-store"});
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||("HTTP "+r.status));
    renderNotes(d.notes||[]);
  }catch(e){
    box.innerHTML = '<div class="notes-empty">Could not load notes: '+esc(e.message)+'</div>';
  }
}

function openSheet(l){
  const sheet = el("sheet");
  const flagBox = l.flagged
    ? '<div class="verdict flag"><div class="why">Heads up before you reach out</div>'+l.flags.map(f=>esc(f.text)).join("<br>")+'</div>'
    : "";
  const doHead = (l.status==="noshow"||l.status==="cancelled") ? "Nudge them to rebook, everywhere you can" : "Reach out everywhere you can to lift the show-up rate";
  const isRef = (l.status==="clientwon"||l.status==="notqualified"||l.status==="survey"||l.status==="baking"||l.status==="neverrescheduled");
  const showSent = (l.status==="booked"||l.status==="noshow"||l.status==="rescheduling"||l.status==="bookinginterview"||l.status==="bookingreview"||l.status==="cancelled");
  sheet.innerHTML =
    '<div class="sh"><div><h2>'+esc(l.name)+'</h2><div class="role">'+esc(l.company||l.email)+' &middot; owned by '+esc(l.repName)+'</div></div>'+
      '<button class="x" data-act="close">&times;</button></div>'+
    '<div class="body">'+
      (l.status==="noshow"?'<div class="nshead">In the rebooking lane. Give them an easy way back in.</div>':"")+
      (l.status==="cancelled"?'<div class="nshead cancel">Cancelled their call. Still in the system, reach out and give them an easy way to rebook.</div>':"")+
      (l.status==="bookinginterview"?'<div class="nshead book">They qualified but have not booked their interview yet. Follow up on every channel and send them the booking link.</div>':"")+
      (l.status==="bookingreview"?'<div class="nshead review">They had their interview but have not booked their review call yet. Follow up by hand and get it booked this week.</div>':"")+
      (l.status==="survey"?'<div class="nshead book">Submitted the survey and qualified, but has not booked the intro yet. Reach out and send the intro booking link.</div>':"")+
      (l.status==="baking"?'<div class="nshead">Being nurtured, not a client yet. No automation runs from here.</div>':"")+
      (l.status==="neverrescheduled"?'<div class="nshead cancel">Went through the rebooking reminders and never booked. Reference only.</div>':"")+
      flagBox+
      prepBlock(l)+
      (showSent ? sentBlock(l) : "")+
      (l.status==="bookinginterview" ? interviewBlock(l)
        : l.status==="bookingreview" ? reviewBlock(l)
        : isRef ? referenceBlock(l)
        : ('<div class="dohead">'+doHead+'</div>'+
           '<div class="hint" style="margin:-6px 0 12px">Confirm the call a few hours or a day before, and keep going until they reply and say they will be there.</div>'+
           channelBlocks(l)))+
      linksBlock(l)+
      actionButtons(l)+
      notesBlock(l)+
    '</div>';
  el("scrim").classList.add("open");
  // Show the real sending address on the email card.
  const fillDomain=()=>sheet.querySelectorAll(".from-domain").forEach(x=>{x.textContent=SEND_DOMAIN;});
  if(SEND_DOMAIN) fillDomain();
  else fetch("/api/send-email").then(r=>r.json()).then(d=>{ if(d&&d.domain){ SEND_DOMAIN=d.domain; fillDomain(); } }).catch(()=>{});
  // Size the editable boxes after the modal is visible, otherwise the text is
  // measured while hidden (height 0) and the box shows only a clipped line or two.
  const autosize = ()=>{
    sheet.querySelectorAll("textarea.editable").forEach(t=>{
      const fit = ()=>{ t.style.height="auto"; t.style.height=(t.scrollHeight+2)+"px"; };
      fit();
      t.addEventListener("input", fit);
    });
  };
  requestAnimationFrame(autosize);
  loadNotes(l.contactId);
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
  if(act==="tag"){
    const lbl=b.querySelector(".pbtn-l");
    const what=b.closest(".actrow") ? b.closest(".actrow").querySelector(".actwhat") : null;
    if(b.dataset.armed!=="1"){
      b.dataset.armed="1"; b.classList.add("arm");
      if(lbl) lbl.textContent="Tap again to confirm";
      clearTimeout(b._t); b._t=setTimeout(()=>{ b.dataset.armed="0"; b.classList.remove("arm"); if(lbl) lbl.textContent=b.dataset.label||""; },4000);
      return;
    }
    clearTimeout(b._t); b.dataset.armed="0"; b.classList.remove("arm"); b.disabled=true;
    if(lbl) lbl.textContent="Working...";
    try{
      const r=await fetch("/api/add-tag",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId:b.dataset.id, tag:b.dataset.tag})});
      const d=await r.json();
      if(r.ok && d.ok){ b.classList.add("done"); if(lbl) lbl.textContent="Done"; if(what) what.textContent="The system is moving this lead now. Hit Refresh at the top to see it in its new stage."; }
      else{ b.disabled=false; if(lbl) lbl.textContent=b.dataset.label||""; if(what) what.textContent="That did not go through: "+(d.error||"try again")+"."; }
    }catch(_){ b.disabled=false; if(lbl) lbl.textContent=b.dataset.label||""; if(what) what.textContent="That did not go through, try again."; }
    return;
  }
  if(act==="copy"){
    const field=b.dataset.field;
    const node=field ? b.closest(".channel").querySelector("."+field) : null;
    const text=node ? node.value : (b.dataset.text||"");
    if(navigator.clipboard) navigator.clipboard.writeText(text);
    const old=b.textContent; b.textContent="Copied"; b.classList.add("done");
    setTimeout(()=>{ b.textContent=old; b.classList.remove("done"); },1500);
    return;
  }
  if(act==="sms" || act==="email"){
    const card=b.closest(".chan");
    const label=b.dataset.label||"Send";
    const ta=card?card.querySelector(act==="sms"?".msg-sms":".msg-body"):null;
    const text=ta?ta.value:"";
    const subjEl=card?card.querySelector(".msg-subject"):null;
    const subject=subjEl?subjEl.value.trim():"";
    if(!text.trim() || (act==="email" && !subject)){ b.textContent=act==="email"?"Add a subject and message first":"Type a message first"; setTimeout(()=>{b.textContent=label;},1800); return; }
    // First tap arms the button, second tap sends. Stops accidental sends.
    if(!b.classList.contains("arm")){
      b.classList.add("arm"); b.textContent="Tap again to send";
      clearTimeout(b._t); b._t=setTimeout(()=>{ b.classList.remove("arm"); b.textContent=label; },4000);
      return;
    }
    clearTimeout(b._t); b.classList.remove("arm");
    b.textContent="Sending..."; b.disabled=true;
    try{
      const r = act==="sms"
        ? await fetch("/api/send-sms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId:b.dataset.id,message:text})})
        : await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId:b.dataset.id,subject,body:text,repName:b.dataset.rep})});
      const d=await r.json();
      if(r.ok && d.ok){ b.textContent=act==="sms"?"Text sent":"Email sent"; b.classList.add("done"); }
      else{ b.textContent="Failed: "+(d.error||"try again"); b.disabled=false; }
    }catch(_){ b.textContent="Failed, try again"; b.disabled=false; }
    return;
  }
  if(act==="savenote"){
    const contactId=b.dataset.id;
    const userId=b.dataset.user||"";
    const ta=el("notenew");
    const body=ta ? ta.value.trim() : "";
    if(!body){ b.textContent="Type a note first"; setTimeout(()=>{b.textContent="Save note";},1600); return; }
    b.textContent="Saving..."; b.disabled=true;
    try{
      const r=await fetch("/api/notes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId,body,userId})});
      const d=await r.json();
      if(r.ok && d.ok){
        if(ta) ta.value="";
        b.textContent="Saved"; b.classList.add("done");
        loadNotes(contactId);
        setTimeout(()=>{ b.textContent="Save note"; b.classList.remove("done"); b.disabled=false; },1500);
      }else{ b.textContent="Failed: "+(d.error||"try again"); b.disabled=false; }
    }catch(_){ b.textContent="Failed, try again"; b.disabled=false; }
    return;
  }
});

el("scrim").addEventListener("click",e=>{ if(e.target===el("scrim")) closeSheet(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeSheet(); });
el("refresh").addEventListener("click", load);
load();
