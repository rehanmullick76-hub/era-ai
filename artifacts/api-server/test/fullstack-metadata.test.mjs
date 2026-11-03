import test from "node:test";
import assert from "node:assert/strict";
import {withFullstackMetadata} from "../src/lib/fullstack-metadata.ts";
test("missing full-stack packaging is completed without another AI call",()=>{
  const files=withFullstackMetadata([{path:"server.mjs",content:"server",action:"create"}],[]);
  for(const path of ["package.json",".env.example","README.md"])assert.ok(files.some(f=>f.path===path));
});
test("metadata defaults do not overwrite existing design, source or instructions",()=>{
  const files=[{path:"public/index.html",content:"New page",action:"create"}];
  const result=withFullstackMetadata(files,[{path:"README.md"},{path:"package.json"},{path:".env.example"}]);
  assert.deepEqual(result,files);
});
test("greetings stay message-only and explicit deletions are not silently undone",()=>{
  assert.deepEqual(withFullstackMetadata([],[]),[]);
  assert.ok(!withFullstackMetadata([{path:"README.md",action:"delete"}],[]).some(f=>f.path==="README.md"&&f.action==="create"));
});
