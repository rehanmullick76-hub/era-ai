import test from "node:test";
import assert from "node:assert/strict";
import {safeExportPath,collectExportFiles} from "../../era/src/lib/fullstack-export.ts";
test("source export includes numbered migrations but excludes dumps and runtime data",()=>{
  for(const path of ["public/index.html","server.mjs","migrations/001_initial.sql","migrations/initial.sql"])assert.equal(safeExportPath(path),path);
  for(const path of ["../secret","/etc/passwd",".env",".env.production","data/records.json","dump.sql","backup.dump","private.key","node_modules/x.js","migrations/001_dump.sql","migrations/backup.sql"])assert.equal(safeExportPath(path),null,path);
});
test("source export always rewrites environment examples with placeholders",()=>{
  const files=collectExportFiles([{path:".env.example",content:"DATABASE_URL=actual-sensitive-value"},{path:"migrations/001_initial.sql",content:"CREATE TABLE IF NOT EXISTS notes(id serial);"}],"Example");
  assert.ok(files.some(f=>f.path==="migrations/001_initial.sql"));
  assert.ok(files.find(f=>f.path===".env.example").content.includes("USER:PASSWORD"));
  assert.ok(!JSON.stringify(files).includes("actual-sensitive-value"));
  assert.ok(files.some(f=>f.path==="SETUP.md"));
});
