// Sign in for the Sales Toolkit. Only Aiconic emails (@aiconichub.com or
// @aiconichub.ai) can sign up or sign in. Every call to /api/ carries the
// signed-in person's token, and the server checks it again.
(function(){
  var SUPABASE_URL = "https://unbednxvxdwozjtqzwgq.supabase.co";
  var SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuYmVkbnh2eGR3b3pqdHF6d2dxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyOTg0NzEsImV4cCI6MjEwNTg3NDQ3MX0.OmYSRyx7-2qtwaw4zxygyQDTLZ5DpX1DZbuLrk15wP8";
  var ALLOWED = ["aiconichub.com","aiconichub.ai"];
  // A password reset link lands here with "type=recovery" in the address (or
  // our own "reset=1" marker). Read it before Supabase clears the address, so
  // the person always gets the "choose a new password" screen.
  var RECOVERY = /type=recovery/.test(location.hash) || /[?&]reset=1/.test(location.search);
  var domReady = false;
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  window.SB = sb;
  window.ME = null;
  // Listen right away, so the reset event is never missed.
  sb.auth.onAuthStateChange(function(ev){
    if(ev==="PASSWORD_RECOVERY"){ RECOVERY = true; if(domReady) showNewPass(); }
  });

  function allowed(email){ var d=String(email||"").trim().toLowerCase().split("@")[1]||""; return ALLOWED.indexOf(d)>-1; }
  function $(id){ return document.getElementById(id); }

  // Every /api/ call carries the token. A 401 or 403 from the server sends you back to sign in.
  var rawFetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    var url = typeof input==="string" ? input : (input && input.url) || "";
    if(url.indexOf("/api/")===0){
      init = init || {};
      var s = (await sb.auth.getSession()).data.session;
      var h = new Headers(init.headers || {});
      if(s) h.set("Authorization","Bearer "+s.access_token);
      init.headers = h;
      var r = await rawFetch(input, init);
      if(r.status===401){ showLogin("Your session expired. Please sign in again."); }
      return r;
    }
    return rawFetch(input, init);
  };

  var mode = "signin"; // signin | signup | reset | newpass
  function setMode(m, msg, isErr){
    mode = m;
    $("au-title").textContent = m==="signup" ? "Create your account" : m==="reset" ? "Reset your password" : m==="newpass" ? "Choose a new password" : "Sign in";
    $("au-email-row").hidden = (m==="newpass");
    $("au-pass-row").hidden = (m==="reset");
    $("au-pass-label").textContent = m==="newpass" ? "New password" : "Password";
    $("au-go").textContent = m==="signup" ? "Create account" : m==="reset" ? "Send reset link" : m==="newpass" ? "Save new password" : "Sign in";
    $("au-to-signup").hidden = (m!=="signin");
    $("au-to-reset").hidden = (m!=="signin");
    $("au-to-signin").hidden = (m==="signin");
    $("au-to-signin").textContent = m==="newpass" ? "Cancel" : "Back to sign in";
    $("au-email").required = (m!=="newpass");
    $("au-pass").setAttribute("autocomplete", (m==="signup"||m==="newpass") ? "new-password" : "current-password");
    $("au-pass").value = "";
    msgOut(msg||"", isErr);
  }
  function msgOut(t, isErr){ var el=$("au-msg"); el.textContent=t; el.className="au-msg"+(t?(isErr?" err":" ok"):""); }
  function clearResetUrl(){
    try{ if(/reset=1|type=recovery/.test(location.search+location.hash)) history.replaceState(null, "", location.pathname); }catch(_){}
  }
  function showNewPass(msg){
    $("au-form").classList.remove("au-wait");
    document.body.classList.add("locked");
    $("authgate").hidden = false;
    setMode("newpass", msg || "Choose a new password for your account. You will use it to sign in from now on.", false);
    setTimeout(function(){ try{ $("au-pass").focus(); }catch(_){} }, 50);
  }
  function showLogin(msg){
    $("au-form").classList.remove("au-wait");
    document.body.classList.add("locked");
    $("authgate").hidden = false;
    if(mode!=="newpass") setMode("signin", msg||"", !!msg);
  }

  function setMebar(name){
    $("mebar").innerHTML = 'Signed in as <b>'+String(name||"").replace(/</g,"&lt;")+'</b> <button type="button" id="chpass" class="au-link">Change password</button> <button type="button" id="signout" class="au-link">Sign out</button>';
    $("signout").addEventListener("click", async function(){ await sb.auth.signOut(); location.reload(); });
    $("chpass").addEventListener("click", function(){ showNewPass("Type your new password and save it."); });
  }

  // Opens the toolkit straight away and checks the person with the server in
  // the background, so nobody stares at a blank page while it runs.
  // While the server confirms who you are, show a short "Signing you in"
  // message instead of a blank page. The toolkit only opens after the server
  // check passes, same as before.
  function showWaiting(){
    document.body.classList.add("locked");
    $("authgate").hidden = false;
    $("au-form").classList.add("au-wait");
    $("au-title").textContent = "Signing you in...";
    msgOut("");
  }
  function stopWaiting(){ $("au-form").classList.remove("au-wait"); }

  async function enter(){
    var s = (await sb.auth.getSession()).data.session;
    if(!s){ showLogin(); return; }
    if(!allowed(s.user.email)){ await sb.auth.signOut(); showLogin("Use your Aiconic email (@aiconichub.com or @aiconichub.ai)."); return; }
    showWaiting();
    try{
      var r = await rawFetch("/api/send-email",{ headers:{ Authorization:"Bearer "+s.access_token } });
      var d = await r.json();
      if(!r.ok){ stopWaiting(); await sb.auth.signOut(); showLogin(d.error||"You do not have access."); return; }
      window.ME = d;
    }catch(_){ window.ME = { name: s.user.email, email: s.user.email, domain: "", from: "" }; }
    stopWaiting();
    $("authgate").hidden = true;
    document.body.classList.remove("locked");
    setMebar(window.ME.name || s.user.email);
    if(window.startApp) window.startApp();
  }

  document.addEventListener("DOMContentLoaded", function(){
    $("au-form").addEventListener("submit", async function(e){
      e.preventDefault();
      var email = $("au-email").value.trim().toLowerCase();
      var pass = $("au-pass").value;
      if(mode!=="newpass" && !allowed(email)){ msgOut("Use your Aiconic email (@aiconichub.com or @aiconichub.ai).", true); return; }
      var btn=$("au-go"); btn.disabled=true;
      try{
        if(mode==="signin"){
          var r1 = await sb.auth.signInWithPassword({ email: email, password: pass });
          if(r1.error){
            var em = String(r1.error.message||"");
            msgOut(/confirm/i.test(em) ? "Confirm your email first. Check your inbox for the link."
              : /invalid login/i.test(em) ? "That email and password do not match. If you are not sure of your password, click Forgot your password below and set a new one."
              : em, true);
          }
          else { await enter(); }
        }else if(mode==="signup"){
          if(pass.length<8){ msgOut("Use at least 8 characters for your password.", true); }
          else{
            var r2 = await sb.auth.signUp({ email: email, password: pass, options:{ emailRedirectTo: location.origin } });
            if(r2.error) msgOut(r2.error.message, true);
            else setMode("signin", "Check your inbox and click the link to confirm your email. Then sign in here.", false);
          }
        }else if(mode==="reset"){
          var r3 = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/?reset=1" });
          if(r3.error) msgOut(r3.error.message, true);
          else setMode("signin", "If that email has an account, a reset link is on its way. Open it on this computer and you will be asked to choose a new password.", false);
        }else if(mode==="newpass"){
          if(pass.length<8){ msgOut("Use at least 8 characters for your password.", true); }
          else{
            var r4 = await sb.auth.updateUser({ password: pass });
            if(r4.error) msgOut(/session/i.test(r4.error.message) ? "This reset link has expired. Click Cancel, then Forgot your password to get a new one." : r4.error.message, true);
            else { RECOVERY = false; clearResetUrl(); mode = "signin"; await enter(); }
          }
        }
      }finally{ btn.disabled=false; }
    });
    $("au-to-signup").addEventListener("click", function(){ setMode("signup"); });
    $("au-to-reset").addEventListener("click", function(){ setMode("reset"); });
    $("au-to-signin").addEventListener("click", function(){
      if(mode==="newpass"){ RECOVERY = false; clearResetUrl(); mode = "signin"; enter(); }
      else setMode("signin");
    });
    $("au-form").noValidate = true;
    domReady = true;
    setMode("signin");
    // Coming from a reset link: ask for the new password, never sign straight in.
    if(RECOVERY){ showNewPass(); return; }
    setTimeout(function(){ if(!RECOVERY && mode!=="newpass") enter(); }, 60);
  });
})();
