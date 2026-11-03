// Opt-in real AI/provider test. Uses free Gemini quota and trial runtime budget.
import assert from "node:assert/strict";
const base=`https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const token=process.env.ERA_TEST_SESSION_TOKEN;
if(!token) throw new Error("Set ERA_TEST_SESSION_TOKEN to an era_session cookie value before running live generation verification.");
const headers={"Content-Type":"application/json","Cookie":`era_session=${token}`};
async function api(path,method="GET",data){
  const r=await fetch(base+path,{method,headers,...(data?{body:JSON.stringify(data)}:{})});
  const d=await r.json();if(!r.ok)throw Error(`${r.status}: ${d.error}`);return d;
}
async function waitWorkspace(id,wanted){
  for(let i=0;i<80;i++){
    const state=await api(`/projects/${id}/workspace`);
    if(state.state===wanted)return state;
    if(state.state==="failed")throw Error(state.error+"\n"+state.logs);
    await new Promise(r=>setTimeout(r,2500));
  }
  throw Error("Workspace timed out");
}
let project;
try{
  project=await api("/projects","POST",{name:"Temporary live AI full-stack verification",mode:"fullstack"});
  // A slow job must be pollable without consuming its model-call allowance.
  for(let i=0;i<25;i++){
    const response=await fetch(base+"/ai/jobs/00000000-0000-4000-8000-000000000000",{headers});
    assert.equal(response.status,404);
  }
  console.log("Job-status reads no longer exhaust the model-call rate limit.");
  const job=await api("/ai/generate","POST",{projectId:project.id,files:[],history:[],
    prompt:"Build a very small complete full-stack notes CRUD app. Use exactly public/index.html, public/styles.css, public/app.js, server.mjs, package.json, migrations/001_initial.sql, .env.example, README.md. Node Express 5.2.1 and @neondatabase/serverless 1.0.2 with Neon HTTPS SQL, no pg/TCP. notes table has id serial and title text. GET /api/notes returns array of {id,title}; POST /api/notes accepts {title}, PATCH /api/notes/:id accepts {title}, DELETE /api/notes/:id returns {success:true}. Healthz checks SELECT 1. Use prepared query parameters. Minimal clean styling, all four CRUD actions in browser. Keep every file complete but short."});
  let state;
  for(let i=0;i<45;i++){
    state=await api("/ai/jobs/"+job.id);
    if(state.status==="succeeded"||state.status==="failed")break;
    await new Promise(r=>setTimeout(r,5000));
  }
  if(state?.status!=="succeeded"){
    console.log(JSON.stringify({generationStatus:state?.status,error:state?.error,errorStatus:state?.errorStatus}));
    process.exitCode=1;
  }else{
    const files=await api(`/projects/${project.id}/files`);
    assert.ok(files.some(f=>f.path==="server.mjs"));
    assert.ok(files.some(f=>/^migrations\/.+\.sql$/.test(f.path)));
    console.log(JSON.stringify({generationStatus:"succeeded",model:state.result.model,filePaths:files.map(f=>f.path),
      inputTokens:state.result.inputTokens,outputTokens:state.result.outputTokens,creditsCharged:state.result.creditsCharged}));
    await api(`/projects/${project.id}/workspace`,"POST",{action:"start"});
    await waitWorkspace(project.id,"running");
    const ticket=await api(`/projects/${project.id}/workspace/preview`,"POST",{});
    const signed=new URL(ticket.url);
    async function preview(path,method="GET",data){
      const url=new URL(path,signed);url.search=signed.search;
      const r=await fetch(url,{method,headers:{"Content-Type":"application/json","X-Daytona-Skip-Preview-Warning":"true"},
        ...(data?{body:JSON.stringify(data)}:{})});
      assert.ok(r.ok,`Generated API ${method} ${path}: HTTP ${r.status}`);
      return r.json();
    }
    const note=await preview("/api/notes","POST",{title:"Live AI-created source, real PostgreSQL data"});
    assert.ok(note.id);
    assert.ok((await preview("/api/notes")).some(n=>n.id===note.id));
    await preview("/api/notes/"+note.id,"PATCH",{title:"Edited through the generated backend"});
    assert.ok((await preview("/api/notes")).some(n=>n.title==="Edited through the generated backend"));
    await preview("/api/notes/"+note.id,"DELETE");
    assert.equal((await preview("/api/notes")).length,0);
    console.log("Live AI-generated source built successfully and passed real PostgreSQL CRUD.");
  }
}finally{
  if(project){
    const workspace=await api(`/projects/${project.id}/workspace`);
    if(workspace.state!=="unprovisioned"){
      await api(`/projects/${project.id}/workspace`,"POST",{action:"delete",confirmDataLoss:true});
      await waitWorkspace(project.id,"deleted");
    }
    await api(`/projects/${project.id}`,"DELETE");
    console.log("Temporary AI project, runtime and database cleaned up.");
  }
}
