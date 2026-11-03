import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";

// Exercise the actual shared completion/recovery callback without launching a
// browser or making another paid/quota-consuming model/provider request.
const source=readFileSync(new URL("../../era/src/pages/builder.tsx",import.meta.url),"utf8");
const start=source.indexOf("applyGeneratedFilesRef.current = async ");
const end=source.indexOf("\n  useEffect(",start);
assert.ok(start>=0&&end>start,"Could not locate the shared generation callback");
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function callback(project,cache){
  let writes=0,reads=0;
  const mutation={mutateAsync:async()=>{writes++;throw Error("Must not replay server-saved files");}};
  const ref={current:null};
  new Function("project","queryClient","getListFilesQueryKey","projectId","applyGeneratedFilesRef","upsertFile","deleteFile",code)(
    project,{refetchQueries:async()=>{reads++;},getQueryData:()=>cache.current},id=>["files",id],"test-project",ref,mutation,mutation);
  return {apply:(files,id="test-project")=>ref.current(files,id),counts:()=>({writes,reads})};
}
test("normal completion and reload recovery never overwrite newer full-stack edits",async()=>{
  const stale=[{path:"server.mjs",action:"update",content:"stale model output",language:"javascript"}];
  const cache={current:[{path:"server.mjs",content:"newer edit from another tab"}]};
  const operation=callback({mode:"fullstack"},cache);
  assert.equal((await operation.apply(stale))[0].content,"newer edit from another tab");
  cache.current=[{path:"server.mjs",content:"even newer edit before recovery"}];
  assert.equal((await operation.apply(stale))[0].content,"even newer edit before recovery");
  assert.deepEqual(operation.counts(),{writes:0,reads:2});
});
test("unknown project metadata cannot trigger browser file writes",async()=>{
  const operation=callback(undefined,{current:[]});
  await assert.rejects(operation.apply([]),/metadata/);
  assert.deepEqual(operation.counts(),{writes:0,reads:0});
});
test("a result from a previous project cannot write into the newly opened project",async()=>{
  const operation=callback({mode:"frontend"},{current:[]});
  await assert.rejects(operation.apply([], "previous-project"),/Project changed/);
  assert.deepEqual(operation.counts(),{writes:0,reads:0});
});
