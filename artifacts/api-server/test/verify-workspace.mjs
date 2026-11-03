// Manual integration test. Provisions real free-trial resources, never CI auto-run.
// Run from repository root: node artifacts/api-server/test/verify-workspace.mjs
import assert from "node:assert/strict";
import { fullstackSource } from "./fixtures/fullstack-source.mjs";
const base=`https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const token=process.env.ERA_TEST_SESSION_TOKEN;
const otherToken=process.env.ERA_TEST_OTHER_SESSION_TOKEN;
if(!token||!otherToken) throw new Error("Set ERA_TEST_SESSION_TOKEN and ERA_TEST_OTHER_SESSION_TOKEN to two different era_session cookie values.");
const headers={"Content-Type":"application/json","Cookie":`era_session=${token}`};
const otherHeaders={"Cookie":`era_session=${otherToken}`};
async function api(path,method="GET",data){
  const r=await fetch(base+path,{method,headers,...(data?{body:JSON.stringify(data)}:{})});
  const d=await r.json();if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${d.error}`);return d;
}
async function wait(id,state,timeout=240_000){
  const until=Date.now()+timeout;let last;
  do{
    last=await api(`/projects/${id}/workspace`);
    if(last.state===state)return last;
    if(last.state==="failed")throw Error("Workspace failed: "+last.error+"\n"+last.logs);
    await new Promise(r=>setTimeout(r,2500));
  }while(Date.now()<until);
  throw Error("Workspace timeout: "+JSON.stringify(last));
}
let project;
try{
  const capabilities=await api("/runtime/capabilities");assert.equal(capabilities.enabled,true);
  project=await api("/projects","POST",{name:"ERA runtime integration check",mode:"fullstack"});
  console.log("Project created; uploading complete CRUD source.");
  for(const file of fullstackSource)await api(`/projects/${project.id}/files`,"POST",file);
  await api(`/projects/${project.id}/workspace`,"POST",{action:"start"});
  await wait(project.id,"running");console.log("Runtime and PostgreSQL provisioned; backend healthy.");
  const ticket=await api(`/projects/${project.id}/workspace/preview`,"POST",{});
  const previewBase=new URL(ticket.url);
  const previewHeaders={"Content-Type":"application/json","X-Daytona-Skip-Preview-Warning":"true"};
  async function preview(path,method="GET",data){
    const url=new URL(path,previewBase);url.search=previewBase.search;
    const r=await fetch(url,{method,headers:previewHeaders,...(data?{body:JSON.stringify(data)}:{})});
    assert.ok(r.ok,`Preview ${method} ${path} HTTP ${r.status}`);
    return r.json();
  }
  const note=await preview("/api/notes","POST",{title:"Persist after stop/start"});
  assert.ok(note.id);
  await preview("/api/notes/"+note.id,"PATCH",{title:"Persisted updated title"});
  assert.equal((await preview("/api/notes"))[0].title,"Persisted updated title");console.log("Real create/read/update passed.");
  await api(`/projects/${project.id}/workspace`,"POST",{action:"stop"});await wait(project.id,"stopped");
  await api(`/projects/${project.id}/workspace`,"POST",{action:"start"});await wait(project.id,"running");
  assert.equal((await preview("/api/notes"))[0].title,"Persisted updated title");console.log("Stop/start persistence passed.");
  const css=fullstackSource.find(f=>f.path==="public/styles.css");
  await api(`/projects/${project.id}/files`,"POST",{...css,content:css.content+"\nh1{letter-spacing:1px}"});
  await api(`/projects/${project.id}/workspace`,"POST",{action:"rebuild"});await wait(project.id,"running");
  assert.equal((await preview("/api/notes"))[0].title,"Persisted updated title");console.log("Edit/rebuild data preservation passed.");
  await preview("/api/notes/"+note.id,"DELETE");
  assert.equal((await preview("/api/notes")).length,0);console.log("Real delete passed.");
  const unauthorized=await fetch(base+`/projects/${project.id}/workspace`);assert.equal(unauthorized.status,401);
  for(const suffix of ["workspace","workspace/preview"]){
    const r=await fetch(base+`/projects/${project.id}/${suffix}`,{method:suffix.endsWith("preview")?"POST":"GET",headers:otherHeaders});
    assert.equal(r.status,404);
  }
  const traversal=await fetch(base+`/projects/${project.id}/files`,{method:"POST",headers,body:JSON.stringify({path:"../.env",content:"bad",language:"text"})});
  assert.equal(traversal.status,400);console.log("Ownership and hostile-path guards passed.");
  const noConfirm=await fetch(base+`/projects/${project.id}/workspace`,{method:"POST",headers,body:JSON.stringify({action:"delete"})});
  assert.equal(noConfirm.status,409);
  console.log("Destructive deletion requires confirmation.");
}finally{
  if(project){
    try{
      const status=await api(`/projects/${project.id}/workspace`);
      if(status.state!=="unprovisioned"){
        await api(`/projects/${project.id}/workspace`,"POST",{action:"delete",confirmDataLoss:true});
        await wait(project.id,"deleted",120_000);
      }
      await api(`/projects/${project.id}`,"DELETE");
      console.log("Temporary runtime, database and source project cleaned up.");
    }catch(e){console.log("Cleanup needs attention:",e.message);}
  }
}
