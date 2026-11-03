import test from "node:test";
import assert from "node:assert/strict";
import {isAiJobRead} from "../src/lib/aiRatePolicy.ts";
test("job polling does not consume the model-call rate allowance",()=>{
  assert.equal(isAiJobRead("GET","/jobs"),true);
  assert.equal(isAiJobRead("GET","/jobs/job-id"),true);
  for(const [method,path] of [["POST","/generate"],["POST","/plan"],["POST","/security"],["POST","/jobs"],["GET","/jobsmith"]])
    assert.equal(isAiJobRead(method,path),false);
});
