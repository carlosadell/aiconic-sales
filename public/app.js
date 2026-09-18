// Front-end for the Daily Reach-Out List.
// Fetches /api/leads (live from the CRM) and renders booked leads and
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
  if(k.includes("booking interview")) return "t-bookint";
  if(k.includes("booking review")) return "t-bookrev";
  if(k.includes("interview")) return "t-interview";
  if(k.includes("review")) return "t-review";
  if(k.includes("intro")) return "t-intro";
  if(k.includes("no show")) return "t-noshow";
  if(k.includes("reschedul")) return "t-resched";
  if(k.includes("cancel")) return "t-cancel";
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

function render(d){
  el("rule").innerHTML =
    '<h3>How this page works</h3>'+
    '<p style="margin:0 0 10px;color:var(--ink-2);font-size:14px;line-height:1.6">Tap any lead to open their card. Inside you can see their details, message them, write the call notes and paste the Fathom recording link into them after the call, and log the call once it is finished. At the top of the card you will always see the stage they are in and when their call is.</p>'+
    '<p style="margin:0 0 12px;color:var(--ink-2);font-size:14px;line-height:1.6">Some stages are automatic and some you move by hand. <b>Careful:</b> moving a lead into a stage marked "triggers FUP" starts a follow-up right away, so the customer gets emails and texts. Only move a lead there when that is what you want.</p>'+
    '<p style="margin:14px 0 8px;font-weight:800;font-size:13px;letter-spacing:.02em">What each stage means</p>'+
    '<ol class="howto">'+
      '<li><b>Intro Call.</b> Automatic. The lead lands here when they book their first call.</li>'+
      '<li><b>No Show (triggers FUP).</b> Manual. Move the card here when they do not show up. This starts the no-show follow-up, so they get emails and texts to rebook.</li>'+
      '<li><b>Booking Interview (triggers FUP).</b> Manual. Move here when they qualified on the intro call but have not booked their interview yet. This starts the booking-interview follow-up.</li>'+
      '<li><b>Interview Call Booked.</b> Automatic. The lead moves here when they book their interview.</li>'+
      '<li><b>Booking Review.</b> Manual. Move here when the interview happened but they have not booked their review call yet. Nothing automatic goes out from this stage, so follow up by hand and get the review booked within the week.</li>'+
      '<li><b>Review Call Booked.</b> Automatic. The lead moves here when they book their review call.</li>'+
      '<li><b>🚨 Reschedule (triggers FUP).</b> Manual, emergency only. Use this only if there is a real emergency and you have to move a call. It sits at the bottom on purpose, it is not a normal step. Moving a lead here starts the reschedule follow-up.</li>'+
      '<li><b>Cancelled.</b> Automatic. The lead moves here when the customer cancels their call.</li>'+
      '<li><b>🔥 Client Won.</b> Automatic. The lead moves here when they become a client.</li>'+
      '<li><b>⛔️ Not Qualified.</b> Manual. Move a lead here to take them out of the process when they are not a fit.</li>'+
    '</ol>'+
    '<div class="flagline">A red flag on a lead means something needs a look before you reach out: no phone, an SMS that failed, or a bounced email. It never means skip them. For the full messages and sequences behind each stage, check the <b>Communications</b> tab.</div>';

  el("summary").innerHTML =
    '<div class="stat blue"><div class="n">'+d.totals.booked+'</div><div class="l">Booked</div></div>'+
    '<div class="stat red"><div class="n">'+d.totals.noshow+'</div><div class="l">No-shows</div></div>'+
    '<div class="stat violet"><div class="n">'+(d.totals.rescheduling||0)+'</div><div class="l">Reschedule</div></div>'+
    '<div class="stat teal"><div class="n">'+(d.totals.bookingInterview||0)+'</div><div class="l">Booking Interview</div></div>'+
    '<div class="stat indigo"><div class="n">'+(d.totals.bookingReview||0)+'</div><div class="l">Booking Review</div></div>'+
    '<div class="stat slate"><div class="n">'+(d.totals.cancelled||0)+'</div><div class="l">Cancelled</div></div>'+
    '<div class="stat amber"><div class="n">'+d.totals.flagged+'</div><div class="l">Flagged</div></div>';

  const resched = d.rescheduling || [];
  const bookint = d.bookingInterview || [];
  const bookrev = d.bookingReview || [];
  const cancel = d.cancelled || [];
  const repNames = [...new Set([...d.booked, ...d.noshow, ...resched, ...bookint, ...bookrev, ...cancel].map(r=>r.repName))].sort((a,b)=>a.localeCompare(b));
  const repTotal = (list, rep) => { const r = (list||[]).find(x=>x.repName===rep); return r ? r.total : 0; };
  const bCount = REP==="all" ? d.totals.booked : repTotal(d.booked, REP);
  const nCount = REP==="all" ? d.totals.noshow : repTotal(d.noshow, REP);
  const rCount = REP==="all" ? (d.totals.rescheduling||0) : repTotal(resched, REP);
  const iCount = REP==="all" ? (d.totals.bookingInterview||0) : repTotal(bookint, REP);
  const vCount = REP==="all" ? (d.totals.bookingReview||0) : repTotal(bookrev, REP);
  const cCount = REP==="all" ? (d.totals.cancelled||0) : repTotal(cancel, REP);
  el("tabs").innerHTML =
    '<div class="tabgroup">'+
      '<button class="tab '+(TAB==="booked"?"on":"")+'" data-tab="booked">Booked <span>'+bCount+'</span></button>'+
      '<button class="tab '+(TAB==="noshow"?"on":"")+'" data-tab="noshow">No-shows <span>'+nCount+'</span></button>'+
      '<button class="tab '+(TAB==="rescheduling"?"on":"")+'" data-tab="rescheduling">Rescheduling <span>'+rCount+'</span></button>'+
      '<button class="tab '+(TAB==="bookinginterview"?"on":"")+'" data-tab="bookinginterview">Booking Interview <span>'+iCount+'</span></button>'+
      '<button class="tab '+(TAB==="bookingreview"?"on":"")+'" data-tab="bookingreview">Booking Review <span>'+vCount+'</span></button>'+
      '<button class="tab '+(TAB==="cancelled"?"on":"")+'" data-tab="cancelled">Cancelled <span>'+cCount+'</span></button>'+
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
  const d = DATA;
  let reps = TAB==="noshow" ? d.noshow : TAB==="rescheduling" ? (d.rescheduling||[]) : TAB==="bookinginterview" ? (d.bookingInterview||[]) : TAB==="bookingreview" ? (d.bookingReview||[]) : TAB==="cancelled" ? (d.cancelled||[]) : d.booked;
  if(REP!=="all") reps = reps.filter(r=>r.repName===REP);
  const g = el("groups"); g.innerHTML="";

  // Plain-language explainer for the Rescheduling tab, so anyone new understands
  // at a glance why these people are here.
  if(TAB==="rescheduling"){
    g.innerHTML =
      '<div class="explain">'+
        '<div class="explain-h">What is Rescheduling?</div>'+
        '<p>These are people we are actively trying to get to book a new time. This is the one part of the process we do by hand, so a person only shows up here because someone moved them here on purpose.</p>'+
        '<p>Usually that is because their call could not go ahead: they did not show, they cancelled, or the salesperson could not make it. Now we are chasing a new booking.</p>'+
        '<p>Open the card, reach out on every channel, and send them the booking link. The moment they book a new call, move them back to their call stage. If they go quiet, move them to Not Qualified.</p>'+
      '</div>';
  }

  if(TAB==="bookinginterview"){
    g.innerHTML =
      '<div class="explain book">'+
        '<div class="explain-h">What is Booking Interview?</div>'+
        '<p>These people qualified on the intro call but have not booked their interview yet. A person only shows up here because someone moved them here on purpose.</p>'+
        '<p>The system already sent them the email and SMS with the interview booking link. Your job is to follow up on every channel until they actually book.</p>'+
        '<p>The moment they book their interview, move them to Interview Call Booked. If they go quiet, move them to Not Qualified.</p>'+
      '</div>';
  }

  if(TAB==="bookingreview"){
    g.innerHTML =
      '<div class="explain review">'+
        '<div class="explain-h">What is Booking Review?</div>'+
        '<p>These people had their interview but have not booked their review call yet. A person only shows up here because someone moved them here on purpose.</p>'+
        '<p>Nothing automatic goes out from this stage. It is on you to follow up by hand on every channel and get the review booked within the week.</p>'+
        '<p>The moment they book their review, move them to Review Call Booked. If they go quiet, move them to Not Qualified.</p>'+
      '</div>';
  }

  if(TAB==="cancelled"){
    g.innerHTML =
      '<div class="explain cancel">'+
        '<div class="explain-h">What is Cancelled?</div>'+
        '<p>These people cancelled their call. They are still in the system, and the CRM already sends them the cancelled sequence to win them back.</p>'+
        '<p>On top of that, reach out personally on every channel and offer them an easy way to grab a new time. The moment they book, they move back on their own.</p>'+
      '</div>';
  }

  if(!reps.length){
    const label = TAB==="noshow" ? "no-shows" : TAB==="rescheduling" ? "people to reschedule" : TAB==="bookinginterview" ? "people booking their interview" : TAB==="bookingreview" ? "people booking their review" : TAB==="cancelled" ? "cancelled calls" : "booked calls";
    const none = TAB==="noshow" ? "No no-shows right now. Nice." : TAB==="rescheduling" ? "Nobody is waiting to reschedule right now." : TAB==="bookinginterview" ? "Nobody is booking an interview right now." : TAB==="bookingreview" ? "Nobody is booking a review right now." : TAB==="cancelled" ? "No cancelled calls right now." : "No booked calls right now.";
    const msg = REP!=="all" ? esc(REP)+" has no "+label+" right now." : none;
    g.innerHTML += '<div class="empty-state">'+msg+'</div>';
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
      const dotCls = l.flagged ? "red" : l.status==="noshow" ? "amber" : l.status==="rescheduling" ? "violet" : l.status==="bookinginterview" ? "teal" : l.status==="bookingreview" ? "indigo" : l.status==="cancelled" ? "slate" : "green";
      row.innerHTML = '<span class="dotmark '+dotCls+'"></span>'+
        '<div class="who"><div class="nm">'+esc(l.name)+'</div><div class="co">'+meta+'</div></div>'+
        badge+'<span class="go">&rsaquo;</span>';
      row.addEventListener("click",()=>openSheet(l));
      rows.appendChild(row);
    });
    box.appendChild(rows); g.appendChild(box);
  });
}

function stageMover(l){
  const opts = DATA.stages.map(s=>{
    const label = s.auto ? esc(s.name)+" (automatic)" : esc(s.name);
    const dis = s.auto && s.id!==l.stageId ? " disabled" : "";
    return '<option value="'+esc(s.id)+'"'+(s.id===l.stageId?" selected":"")+dis+'>'+label+'</option>';
  }).join("");
  return '<div class="dohead">Move stage</div>'+
    '<div class="stagerow">'+
      '<select class="stagesel" data-opp="'+esc(l.id)+'">'+opts+'</select>'+
      '<span class="stagemsg" id="stagemsg"></span>'+
    '</div>'+
    '<div class="hint" style="margin-bottom:16px">Changing this moves the deal in the CRM right away. Stages marked automatic are greyed out, the CRM moves leads there on its own, so you cannot pick them.</div>';
}

function prepBlock(l){
  const rows = [
    ["Book an intro call", l.bookingLink],
    ["Book an interview call with Carlos", l.links.interviewCarlos],
    ["Open the pipeline", l.links.pipeline],
    ["Open the contact card in the CRM", l.links.contact],
    ["Conversify (LinkedIn chats)", l.links.conversify],
    ["Intro call script", l.links.script],
    ["Interview questions", l.links.interviewQuestions],
  ].filter(r=>r[1]);
  const appt = l.appointment && l.appointment.at
    ? '<div class="appt"><span class="ch">Call</span> '+esc(l.callType)+' &middot; '+esc(dayLabel(l.appointment.at, l.timezone))+'</div>' : "";
  const src = '<div class="srcnote"><b>'+esc(l.source)+'.</b> '+esc(l.sourceCheck)+'</div>';
  return '<div class="dohead">All the relevant links you might need</div>'+appt+src+
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
      out.push('<div class="channel"><div class="top"><span class="tag sms">SMS</span><b>Personal SMS through the CRM</b></div>'+
        '<textarea class="box editable msg-sms" rows="4">'+esc(m.sms)+'</textarea>'+
        '<div class="btnrow"><button class="btn solid" data-act="sms" data-id="'+esc(l.contactId)+'">Send SMS via the CRM</button>'+
        '<button class="btn" data-act="copy" data-field="msg-sms">Copy text</button></div>'+
        '<div class="hint">Edit the message if you like, then send. Goes to '+esc(l.phone)+' through the CRM.</div></div>');
    }else if(ch==="linkedin"){
      out.push('<div class="channel"><div class="top"><span class="tag also">LinkedIn</span><b>Message or connection request</b></div>'+
        '<textarea class="box editable msg-note" rows="3">'+esc(m.note)+'</textarea>'+
        '<div class="btnrow"><button class="btn" data-act="copy" data-field="msg-note">Copy note</button>'+
        '<a class="btn" href="'+esc(l.links.conversify)+'" target="_blank" rel="noopener">Open Conversify</a></div></div>');
    }else if(ch==="email"){
      out.push('<div class="channel"><div class="top"><span class="tag mail">Email</span><b>Personal email from our business inbox</b></div>'+
        '<div class="subjrow"><input class="subj-input msg-subject" value="'+esc(m.email.subject)+'"><button class="btn tiny" data-act="copy" data-field="msg-subject">Copy subject</button></div>'+
        '<textarea class="box editable msg-body" rows="7">'+esc(m.email.body)+'</textarea>'+
        '<div class="btnrow"><button class="btn" data-act="copy" data-field="msg-body">Copy email body</button></div>'+
        '<div class="hint">Edit anything you like, then copy. Send from our business inbox, not the CRM email.</div></div>');
    }
  });
  return out.join("");
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
    '<a class="btn" href="'+esc(l.links.conversify)+'" target="_blank" rel="noopener">Open Conversify</a></div></div>');
  blocks.push('<div class="channel reschedule"><div class="top"><span class="tag resc">Email</span><b>Email them</b></div>'+
    '<div class="subjrow"><input class="subj-input msg-subject" value="'+esc(m.email.subject)+'"><button class="btn tiny" data-act="copy" data-field="msg-subject">Copy subject</button></div>'+
    '<textarea class="box editable msg-body" rows="9">'+esc(m.email.body)+'</textarea>'+
    '<div class="btnrow"><button class="btn" data-act="copy" data-field="msg-body">Copy email body</button></div></div>');
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
  const link = (l.links && l.links.interviewBooking) || "";
  const linkcard = link ? linkCard("book", "Interview booking link", "Send them this so they can book their interview.", link) : "";
  const blocks = [];
  if(l.phone){
    blocks.push('<div class="channel book"><div class="top"><span class="tag bookint">SMS</span><b>Text them</b></div>'+
      '<textarea class="box editable msg-sms" rows="6">'+esc(m.sms)+'</textarea>'+
      '<div class="btnrow"><button class="btn solid" data-act="sms" data-id="'+esc(l.contactId)+'">Send SMS via the CRM</button>'+
      '<button class="btn" data-act="copy" data-field="msg-sms">Copy text</button></div></div>');
  }
  blocks.push('<div class="channel book"><div class="top"><span class="tag bookint">LinkedIn</span><b>Message them on LinkedIn</b></div>'+
    '<textarea class="box editable msg-note" rows="6">'+esc(m.note)+'</textarea>'+
    '<div class="btnrow"><button class="btn" data-act="copy" data-field="msg-note">Copy note</button>'+
    '<a class="btn" href="'+esc(l.links.conversify)+'" target="_blank" rel="noopener">Open Conversify</a></div></div>');
  blocks.push('<div class="channel book"><div class="top"><span class="tag bookint">Email</span><b>Email them</b></div>'+
    '<div class="subjrow"><input class="subj-input msg-subject" value="'+esc(m.email.subject)+'"><button class="btn tiny" data-act="copy" data-field="msg-subject">Copy subject</button></div>'+
    '<textarea class="box editable msg-body" rows="8">'+esc(m.email.body)+'</textarea>'+
    '<div class="btnrow"><button class="btn" data-act="copy" data-field="msg-body">Copy email body</button></div></div>');
  return '<div class="dohead">Get them to book the interview</div>'+linkcard+blocks.join("");
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
  const blocks = [];
  if(l.phone){
    blocks.push('<div class="channel review"><div class="top"><span class="tag bookrev">SMS</span><b>Text them</b></div>'+
      '<textarea class="box editable msg-sms" rows="6">'+esc(m.sms)+'</textarea>'+
      '<div class="btnrow"><button class="btn solid" data-act="sms" data-id="'+esc(l.contactId)+'">Send SMS via the CRM</button>'+
      '<button class="btn" data-act="copy" data-field="msg-sms">Copy text</button></div></div>');
  }
  blocks.push('<div class="channel review"><div class="top"><span class="tag bookrev">LinkedIn</span><b>Message them on LinkedIn</b></div>'+
    '<textarea class="box editable msg-note" rows="6">'+esc(m.note)+'</textarea>'+
    '<div class="btnrow"><button class="btn" data-act="copy" data-field="msg-note">Copy note</button>'+
    '<a class="btn" href="'+esc(l.links.conversify)+'" target="_blank" rel="noopener">Open Conversify</a></div></div>');
  blocks.push('<div class="channel review"><div class="top"><span class="tag bookrev">Email</span><b>Email them</b></div>'+
    '<div class="subjrow"><input class="subj-input msg-subject" value="'+esc(m.email.subject)+'"><button class="btn tiny" data-act="copy" data-field="msg-subject">Copy subject</button></div>'+
    '<textarea class="box editable msg-body" rows="8">'+esc(m.email.body)+'</textarea>'+
    '<div class="btnrow"><button class="btn" data-act="copy" data-field="msg-body">Copy email body</button></div></div>');
  return '<div class="dohead">Get them to book the review call</div>'+blocks.join("");
}

// The lead's own reschedule link, pulled from their the CRM confirmation
// email. Shown so a rep can see it, open it, or copy it straight from the card.
function linkCard(cls, lbl, note, url){
  return '<div class="linkrow '+cls+'">'+
    '<div class="linkrow-top"><span class="linkrow-lbl">'+lbl+'</span>'+
    '<button class="btn tiny" data-act="copy" data-text="'+esc(url)+'">Copy link</button></div>'+
    '<a class="linkrow-url" href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(url)+'</a>'+
    '<div class="hint">'+note+'</div></div>';
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
      "Only for a call that has not happened yet. This link moves THIS booked call to a new time for this one person, same call, new slot. It stops working once the call has passed or was cancelled. For anything else, use Book an intro call below.",
      l.rebookLink
    ));
  }
  if(l.bookingLink){
    out.push(linkCard(
      "book",
      "Book an intro call",
      "Send this whenever they need a fresh call: a no-show, a cancelled call, or a call that already passed. This is the link to use for rebooking, and it always works.",
      l.bookingLink
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
    '<div class="dohead" style="margin-top:16px">Log the call</div>'+
    '<a class="calllog" href="https://docs.google.com/spreadsheets/d/1coBj8aCR7DF6qBaW5eL0Qam9sdaHKGsnTXSc2dx3DlU/edit" target="_blank" rel="noopener">Open the call log</a>'+
    '<div class="hint" style="margin-bottom:16px">Log the call in the sheet only if you actually took it, and put your name on it. No-shows and calls you did not take are not logged.</div>';
}

function renderNotes(notes){
  const box = el("notes"); if(!box) return;
  if(!notes.length){ box.innerHTML = '<div class="notes-empty">No notes yet. Add the first one below.</div>'; return; }
  box.innerHTML = notes.map(n=>
    '<div class="note-item"><div class="note-body">'+esc(n.body)+'</div>'+
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
  const doHead = (l.status==="noshow"||l.status==="cancelled") ? "Nudge them to rebook, everywhere you can" : "Reach out, everywhere you can";
  sheet.innerHTML =
    '<div class="sh"><div><h2>'+esc(l.name)+'</h2><div class="role">'+esc(l.company||l.email)+' &middot; owned by '+esc(l.repName)+'</div></div>'+
      '<button class="x" data-act="close">&times;</button></div>'+
    '<div class="body">'+
      (l.status==="noshow"?'<div class="nshead">Did not show up. Give them an easy way back in.</div>':"")+
      (l.status==="cancelled"?'<div class="nshead cancel">Cancelled their call. Still in the system, reach out and give them an easy way to rebook.</div>':"")+
      (l.status==="rescheduling"?'<div class="nshead resched">We are getting this person to book a new time. Reach out on every channel and send the booking link.</div>':"")+
      (l.status==="bookinginterview"?'<div class="nshead book">They qualified but have not booked their interview yet. Follow up on every channel and send them the booking link.</div>':"")+
      (l.status==="bookingreview"?'<div class="nshead review">They had their interview but have not booked their review call yet. Follow up by hand and get it booked this week.</div>':"")+
      flagBox+
      '<div class="kv">'+
        '<div class="k">Stage</div><div class="v">'+esc(l.stage)+'</div>'+
        '<div class="k">Call</div><div class="v">'+esc(l.callType)+(l.appointment&&l.appointment.at?' &middot; '+esc(dayLabel(l.appointment.at,l.timezone)):"")+'</div>'+
        '<div class="k">Email</div><div class="v">'+esc(l.email||"None on file")+'</div>'+
        '<div class="k">Phone</div><div class="v">'+esc(l.phone||"None on file")+'</div>'+
      '</div>'+
      (l.status==="bookinginterview"||l.status==="bookingreview" ? "" : rebookRow(l))+
      sentBlock(l)+
      (l.status==="rescheduling"
        ? (rescheduleBlock(l)+stageMover(l)+notesBlock(l))
        : l.status==="bookinginterview"
        ? (interviewBlock(l)+stageMover(l)+notesBlock(l))
        : l.status==="bookingreview"
        ? (reviewBlock(l)+stageMover(l)+notesBlock(l))
        : ('<div class="dohead">'+doHead+'</div>'+channelBlocks(l)+stageMover(l)+notesBlock(l)+rescheduleBlock(l)))+
      prepBlock(l)+
    '</div>';
  el("scrim").classList.add("open");
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
  if(act==="copy"){
    const field=b.dataset.field;
    const node=field ? b.closest(".channel").querySelector("."+field) : null;
    const text=node ? node.value : (b.dataset.text||"");
    if(navigator.clipboard) navigator.clipboard.writeText(text);
    const old=b.textContent; b.textContent="Copied"; b.classList.add("done");
    setTimeout(()=>{ b.textContent=old; b.classList.remove("done"); },1500);
    return;
  }
  if(act==="sms"){
    const contactId=b.dataset.id;
    const ta=b.closest(".channel").querySelector(".msg-sms");
    const message=ta ? ta.value : "";
    if(!message.trim()){ b.textContent="Type a message first"; setTimeout(()=>{b.textContent="Send SMS via the CRM";},1600); return; }
    b.textContent="Sending..."; b.disabled=true;
    try{
      const r=await fetch("/api/send-sms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contactId,message})});
      const d=await r.json();
      if(r.ok && d.ok){ b.textContent="Sent"; b.classList.add("done"); }
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
