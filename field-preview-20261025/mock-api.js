"use strict";
// This site is an entirely static synthetic UI exercise, not a live Nomatoka
// game. Intercept every application HTTP request. No credentials, users,
// production endpoints or real order writes exist in this preview.
(() => {
  const id="11111111-1111-4111-8111-111111111111";
  const accountId="ui-preview";
  const report={
    id:"fallen-trunk",kind:"obstruction-report",label:"Trunk encountered",
    area:"Short path",precision:"unlocated",
    summary:"Ortega reported a fallen trunk blocking the Short path.",
    source:{personId:"ortega",label:"Ortega",means:"physical contact"},
    delivery:{kind:"local report",receivedAt:"2026-10-25T12:31:00.000000Z"},
    relatedOrderId:id,retention:"received report; current conditions are not confirmed",
    unknown:["Exact position","Current condition","Other obstructions"],
    observedAt:null,coverage:null,prepareOrder:"inspect the fallen trunk"
  };
  const picture={
    revision:1,
    reference:{id:"staging-area",label:"Staging Area"},
    objective:{id:"ridge",label:"Ridge"},
    routes:[{id:"short",label:"Short path"},{id:"long",label:"Lower path"}],
    contact:{id:"ortega",label:"Ortega",state:"present",area:"Staging Area",source:"local contact"},
    reports:[report],
    radioOrder:null
  };
  const payload={
    "/api/commander":{commander:{id:accountId,displayName:"UI Preview"},
      control:{status:"active",version:1,grantId:id}},
    "/api/mercenaries":{accountId,mercenaries:[{id:"ortega",name:"Ortega",version:1,
      status:"ready",location:"Staging Area",currentOrder:null,lastResponse:null}]},
    "/api/orders/history":{accountId,entries:[],nextBeforeVersion:null},
    "/api/operations-picture":{accountId,picture},
    // Knowledge and the received operations-picture card are projections of
    // the SAME fictional contact report, not contradictory demo stories.
    "/api/knowledge":{accountId,knowledge:{
      revision:picture.revision,contact:"present",location:"Staging Area",
      report:report.summary,source:"local report",orderId:id,
      facts:[{kind:"obstruction",route:"short",routeName:"Short path",
        name:"fallen trunk",blocked:true,source:"physical-contact"}]
    }}
  };
  const response=(data,status=200)=>new Response(JSON.stringify(data),{
    status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
  });
  window.fetch=(input,options={})=>{
    const url=new URL(typeof input==="string"?input:input.url,location.href);
    if(url.origin!==location.origin) return Promise.reject(new Error("UI demo disallows external requests"));
    const method=(options.method||"GET").toUpperCase();
    if((method==="GET" || (method==="POST" && url.pathname==="/api/orders/history"))
      && Object.hasOwn(payload,url.pathname))
      return Promise.resolve(response(payload[url.pathname]));
    return Promise.resolve(response({error:{code:"ui_preview_only",
      message:"This synthetic UI build cannot perform game actions."}},405));
  };
  // Real game session actions are unsupported in this static test page.
  // Report this visibly without calling the original logout handler (which
  // would otherwise terminal-lock the UI before the fake endpoint rejects it).
  const notice=document.createElement("div");
  notice.id="ui-preview-notice";notice.setAttribute("role","status");
  notice.hidden=true;
  Object.assign(notice.style,{position:"fixed",top:"58px",left:"8px",right:"8px",
    zIndex:"200",pointerEvents:"none",maxWidth:"380px",margin:"auto",
    padding:"10px",border:"1px solid #c6a260",borderRadius:"7px",
    background:"#182318f5",color:"#f2d8a0",fontSize:"12px",
    textAlign:"center",boxShadow:"0 4px 18px #000b"});
  document.body.append(notice);
  let clearNotice;
  function showNotice(message){
    notice.textContent=message;notice.hidden=false;
    clearTimeout(clearNotice);
    clearNotice=setTimeout(()=>{notice.hidden=true;},4500);
  }
  document.addEventListener("click",event=>{
    if(!event.target.closest?.("#logout"))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showNotice("UI demonstration only. No live session to sign out of.");
  },true);
  // Capture and block the real order form before the game's listener sees it.
  // This is a deliberate preview safety gate, not a simulated order receipt.
  document.addEventListener("submit",event=>{
    if(event.target?.id!=="order-form")return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showNotice("UI demonstration only. No order was sent.");
    const label=document.querySelector("#access-status");
    if(label)label.textContent="UI demonstration only. No order was sent.";
  },true);
})();
