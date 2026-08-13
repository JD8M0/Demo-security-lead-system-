// D3MO Supabase bridge — authenticated, owner-scoped lead synchronization
(function(){
  'use strict';

  var SUPABASE_URL='https://asxgjgcphhtbewlhmbog.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY='sb_publishable_lhHJwomvquf44EQUD6UBvA_37fo1YfR';
  var STORAGE_KEY='d3mo-pig-v4';
  var db=null;
  var syncQueue=Promise.resolve();
  var appStarted=false;

  function setSyncState(state,message){
    var el=document.getElementById('d3mo-sync-state');
    if(!el){
      el=document.createElement('div');
      el.id='d3mo-sync-state';
      el.style.cssText='position:fixed;right:12px;bottom:12px;z-index:9000;padding:7px 10px;border-radius:5px;background:#0f1318;border:1px solid #2a3d52;color:#a8b8c8;font:11px Inter,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)';
      document.body.appendChild(el);
    }
    var colors={syncing:'#f0c040',synced:'#35d07f',offline:'#ff9f43',error:'#ff5b5b'};
    el.style.color=colors[state]||'#a8b8c8';
    el.textContent=message;
  }

  function loadSupabaseClient(){
    return new Promise(function(resolve,reject){
      if(window.supabase&&window.supabase.createClient){resolve();return;}
      var s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload=resolve;
      s.onerror=function(){reject(new Error('Could not load Supabase client'));};
      document.head.appendChild(s);
    });
  }

  function toDb(l,userId){
    return {
      id:l.id,
      user_id:userId,
      name:l.name||'',
      category:l.category||'',
      address:l.address||'',
      city:l.city||'',
      state:l.state||'',
      phone:l.phone||'',
      website:l.website||'',
      contact_name:l.contactName||'',
      contact_title:l.contactTitle||'',
      contact_email:l.contactEmail||'',
      score:Number(l.score)||0,
      risks:Array.isArray(l.risks)?l.risks:[],
      services:Array.isArray(l.services)?l.services:[],
      summary:l.summary||'',
      estimated_value:Number(l.estimatedValue)||0,
      status:l.status||'Saved',
      source:l.source||'',
      notes:l.notes||'',
      call_log:Array.isArray(l.callLog)?l.callLog:[],
      submitted_date:l.submittedDate||null,
      payout:Number(l.bonusAmount)||0,
      created_at:l.dateAdded||new Date().toISOString(),
      updated_at:l.lastUpdated||new Date().toISOString()
    };
  }

  function fromDb(r){
    return {
      id:r.id,
      name:r.name||'',
      category:r.category||'',
      address:r.address||'',
      city:r.city||'',
      state:r.state||'',
      phone:r.phone||'',
      website:r.website||'',
      contactName:r.contact_name||'',
      contactTitle:r.contact_title||'',
      contactEmail:r.contact_email||'',
      score:Number(r.score)||0,
      risks:r.risks||[],
      services:r.services||[],
      summary:r.summary||'',
      estimatedValue:Number(r.estimated_value)||0,
      status:r.status||'Saved',
      source:r.source||'',
      notes:r.notes||'',
      callLog:r.call_log||[],
      submittedDate:r.submitted_date||null,
      bonusAmount:Number(r.payout)||0,
      submissionRecord:true,
      dateAdded:r.created_at||new Date().toISOString(),
      lastUpdated:r.updated_at||new Date().toISOString()
    };
  }

  function readLocal(){
    try{
      var raw=localStorage.getItem(STORAGE_KEY);
      var parsed=raw?JSON.parse(raw):[];
      return Array.isArray(parsed)?parsed:[];
    }catch(e){return [];}
  }

  function writeLocal(items){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(items||[]));}catch(e){}
  }

  function mergeLeads(local,cloud){
    var merged=new Map();
    (cloud||[]).forEach(function(lead){merged.set(lead.id,lead);});
    (local||[]).forEach(function(lead){
      if(!lead||!lead.id)return;
      var current=merged.get(lead.id);
      if(!current){merged.set(lead.id,lead);return;}
      var localTime=Date.parse(lead.lastUpdated||lead.dateAdded||0)||0;
      var cloudTime=Date.parse(current.lastUpdated||current.dateAdded||0)||0;
      if(localTime>cloudTime)merged.set(lead.id,lead);
    });
    return Array.from(merged.values());
  }

  function refreshUI(){
    try{if(window.renderDashboard)window.renderDashboard();}catch(e){}
    try{if(window.updateTopbarEarnings)window.updateTopbarEarnings();}catch(e){}
    try{if(window.populateLoadSelect)window.populateLoadSelect();}catch(e){}
    try{if(window.populateOutreachSelect)window.populateOutreachSelect();}catch(e){}
  }

  async function startApp(){
    if(appStarted)return;
    appStarted=true;
    if(window.d3moAppInit)await window.d3moAppInit();
    else refreshUI();
  }

  function showLogin(){
    if(document.getElementById('d3mo-auth-gate'))return;
    var gate=document.createElement('div');
    gate.id='d3mo-auth-gate';
    gate.style.cssText='position:fixed;inset:0;z-index:9999;background:#050709;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,sans-serif;color:#f0f4f8';
    gate.innerHTML='<div style="width:min(420px,100%);background:#0f1318;border:1px solid #2a3d52;border-radius:10px;padding:22px"><div style="font-family:Rajdhani,sans-serif;font-size:24px;font-weight:700;color:#f0c040;margin-bottom:4px">D3MO Lead Engine</div><div style="font-size:12px;color:#a8b8c8;margin-bottom:18px">Sign in to keep your lead research private and synchronized.</div><input id="d3mo-auth-email" type="email" placeholder="Your email" style="width:100%;background:#151b23;border:1px solid #2a3d52;color:#f0f4f8;padding:10px;border-radius:5px;margin-bottom:10px"><button id="d3mo-auth-send" style="width:100%;border:0;border-radius:5px;background:#d4a017;color:#000;padding:10px;font-weight:700;cursor:pointer">Email me a sign-in link</button><div id="d3mo-auth-msg" style="font-size:12px;color:#a8b8c8;margin-top:10px;line-height:1.5"></div></div>';
    document.body.appendChild(gate);
    document.getElementById('d3mo-auth-send').onclick=async function(){
      var email=document.getElementById('d3mo-auth-email').value.trim();
      var msg=document.getElementById('d3mo-auth-msg');
      if(!email){msg.textContent='Enter your email first.';return;}
      msg.textContent='Sending sign-in link...';
      var result=await db.auth.signInWithOtp({email:email,options:{emailRedirectTo:location.origin+location.pathname}});
      msg.textContent=result.error?('Error: '+result.error.message):'Check your email, then open the sign-in link on this device.';
    };
  }

  function hideLogin(){
    var gate=document.getElementById('d3mo-auth-gate');
    if(gate)gate.remove();
  }

  async function cloudLoad(){
    var local=readLocal();
    var session=(await db.auth.getSession()).data.session;
    if(!session){
      window.leads=local;
      showLogin();
      setSyncState('offline','Local only — sign in to sync');
      refreshUI();
      return false;
    }

    hideLogin();
    setSyncState('syncing','Loading lead research...');
    var res=await db.from('leads').select('*').order('created_at',{ascending:true});
    if(res.error){
      console.warn('Supabase load failed; using local storage:',res.error);
      window.leads=local;
      setSyncState('error','Cloud load failed — local copy active');
      refreshUI();
      return false;
    }

    var cloud=(res.data||[]).map(fromDb);
    window.leads=mergeLeads(local,cloud);
    writeLocal(window.leads);
    refreshUI();

    if(local.some(function(l){return !cloud.some(function(c){return c.id===l.id;});})){
      await cloudSave();
    }else{
      setSyncState('synced','Lead research synced');
    }
    return true;
  }

  async function performCloudSave(){
    var snapshot=Array.isArray(window.leads)?window.leads.slice():[];
    writeLocal(snapshot);

    var session=(await db.auth.getSession()).data.session;
    if(!session){
      showLogin();
      setSyncState('offline','Saved locally — sign in to sync');
      return false;
    }

    setSyncState('syncing','Saving lead research...');
    var rows=snapshot.map(function(lead){return toDb(lead,session.user.id);});
    if(rows.length){
      var upsert=await db.from('leads').upsert(rows,{onConflict:'id'});
      if(upsert.error){
        console.warn('Supabase upsert failed; local copy retained:',upsert.error);
        setSyncState('error','Cloud save failed — local copy retained');
        return false;
      }
    }

    var cloudIds=await db.from('leads').select('id');
    if(cloudIds.error){
      console.warn('Supabase delete check failed:',cloudIds.error);
      setSyncState('error','Saved, but cleanup check failed');
      return false;
    }

    var keep=new Set(snapshot.map(function(lead){return lead.id;}));
    var removed=(cloudIds.data||[]).map(function(row){return row.id;}).filter(function(id){return !keep.has(id);});
    if(removed.length){
      var deletion=await db.from('leads').delete().in('id',removed);
      if(deletion.error){
        console.warn('Supabase delete failed:',deletion.error);
        setSyncState('error','Saved, but deletion did not sync');
        return false;
      }
    }

    setSyncState('synced','Lead research synced');
    return true;
  }

  function cloudSave(){
    syncQueue=syncQueue.then(performCloudSave,performCloudSave);
    return syncQueue;
  }

  async function start(){
    try{
      await loadSupabaseClient();
      db=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
      window.d3moSupabase=db;
      window.saveLeads=cloudSave;
      window.loadLeads=cloudLoad;
      db.auth.onAuthStateChange(function(event,session){
        if(session){
          hideLogin();
          setTimeout(cloudLoad,0);
        }else if(event==='SIGNED_OUT'){
          showLogin();
          setSyncState('offline','Local only — sign in to sync');
        }
      });
      await cloudLoad();
    }catch(e){
      console.warn('Supabase bridge unavailable; staying on local storage:',e);
      window.leads=readLocal();
      setSyncState('error','Cloud unavailable — local copy active');
      refreshUI();
    }
    await startApp();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
})();
