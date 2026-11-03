import { db, workspacesTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { daytona, type RuntimeCredentials } from "./workspace-provider";
import { decryptRuntimeCredentials, redactRuntimeLog } from "./workspace-policy";

type Row=typeof workspacesTable.$inferSelect;
const cache=new Map<string,{until:number;logs:string}>();
export async function runtimeLogs(row:Row):Promise<string>{
  if(row.state!=="running"||!row.sandboxId)return "";
  const old=cache.get(row.projectId);
  if(old&&old.until>Date.now())return old.logs;
  try{
    const sandbox=await daytona().get(row.sandboxId);
    if(sandbox.state==="stopped"||sandbox.state==="archived"){
      await db.update(workspacesTable).set({state:"stopped",runtimeUntil:null,phase:"Provider auto-suspended the inactive preview. Data is preserved; start it explicitly.",updatedAt:new Date()})
        .where(and(eq(workspacesTable.projectId,row.projectId),eq(workspacesTable.state,"running"),isNull(workspacesTable.action)));
      return "\nRuntime has auto-suspended. Start it explicitly to resume.";
    }
    if(sandbox.state!=="started")return "\nRuntime is temporarily unavailable. No automatic start was triggered.";
    const result=await sandbox.process.executeCommand("tail -c 12000 /tmp/era-runtime.log",undefined,undefined,5);
    const credentials=row.credentials?decryptRuntimeCredentials<RuntimeCredentials>(row.credentials):null;
    const secrets=credentials?[credentials.ownerUrl,credentials.runtimeUrl,new URL(credentials.ownerUrl).password,new URL(credentials.runtimeUrl).password]:[];
    const logs=redactRuntimeLog(result.result??"",secrets);
    if(cache.size>10)cache.clear();
    cache.set(row.projectId,{until:Date.now()+5000,logs});
    return logs;
  }catch{return "\nRuntime logs temporarily unavailable. No restart was triggered.";}
}
