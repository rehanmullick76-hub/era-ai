import { and, eq, sql, or, isNull, lt, inArray } from "drizzle-orm";
import { db, workspacesTable, runtimeBudgetTable, filesTable } from "@workspace/db";
import type { Sandbox } from "@daytona/sdk";
import { createDatabase, databaseCredentials, daytona, neon, createSandbox, buildSandbox, type RuntimeCredentials } from "./workspace-provider";
import { canReserveRuntimeBudget, decryptRuntimeCredentials, encryptRuntimeCredentials, redactRuntimeLog, runtimeBudgetLimitCents, runtimeBudgetWindowId, sourceRevision, validateWorkspaceSource } from "./workspace-policy";
import { logger } from "./logger";
import { runtimeProvidersConfigured } from "./runtime-funding";

type Row = typeof workspacesTable.$inferSelect;
type Action = "start" | "stop" | "restart" | "rebuild" | "delete";
export function runtimeConfigured(): boolean {
  return runtimeProvidersConfigured(process.env.DAYTONA_API_KEY ?? "", process.env.NEON_API_KEY ?? "");
}
export function runtimeEnabled(): boolean {
  return runtimeConfigured();
}
export function publicWorkspace(projectId: string, row?: Row, currentRevision: string | null = null) {
  return { projectId, state: row?.state ?? "unprovisioned", phase: row?.phase ?? "Start a trial workspace to build and preview this project.",
    logs: row?.logs ?? "", revision: row?.revision ?? null, currentRevision, error: row?.error ?? null,
    databaseState: row?.databaseId ? "provisioned" : "unprovisioned" };
}
export async function queueWorkspace(projectId: string, userId: string, action: Action): Promise<void> {
  if (!["stop","delete"].includes(action) && !runtimeEnabled()) throw new Error("Workspace runtime is unavailable because Daytona and Neon connections are not configured.");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7318291)`);
    const [old] = await tx.select().from(workspacesTable).where(eq(workspacesTable.projectId,projectId)).for("update");
    if (old?.state === "deleting") throw new Error("Workspace cleanup is in progress. Wait for it to finish before starting another operation.");
    if (old?.action) {
      if (action === "stop" && old.action !== "delete") {
        // Persist a stop request without replacing the in-flight action. The
        // worker observes this after the build/health check and suspends it.
        await tx.update(workspacesTable).set({
          runtimeUntil: new Date(0),
          phase: "Stop requested; suspending after the current operation",
          updatedAt: new Date(),
        }).where(eq(workspacesTable.projectId, projectId));
        return;
      }
      throw new Error("A workspace operation is already running. Its progress is saved; wait or retry after it finishes.");
    }
    if (["stop","delete"].includes(action) && !old) throw new Error("No workspace has been provisioned.");
    if (!["stop","delete"].includes(action)) {
      const sources=await tx.select().from(filesTable).where(eq(filesTable.projectId,projectId));
      validateWorkspaceSource(sources);
      const budgetId=runtimeBudgetWindowId();
      await tx.insert(runtimeBudgetTable).values({id:budgetId}).onConflictDoNothing();
      const [budget]=await tx.select().from(runtimeBudgetTable).where(eq(runtimeBudgetTable.id,budgetId)).for("update");
      const creates = !old?.sandboxId;
      const revision = sourceRevision(sources.map(file => ({ path: file.path, content: file.content })));
      const canResume = action === "start" && !!old?.sandboxId && !!old.databaseId && old.revision === revision;
      const reserveCents = canResume ? 0 : 5;
      const maxProjects = Math.min(3, Number(process.env.ERA_RUNTIME_MAX_PROJECTS ?? 3));
      const provisioned=await tx.select().from(workspacesTable);
      const resourceCount=provisioned.filter(w=>w.sandboxId||w.databaseId||w.action).length;
      const owned=provisioned.filter(w=>w.userId===userId&&(w.sandboxId||w.databaseId||w.action));
      if (!old && owned.length>=2) throw new Error("Trial accounts can provision at most two project workspaces.");
      const active=await tx.select().from(workspacesTable)
        .where(inArray(workspacesTable.state, ["running","queued","provisioning","building"]));
      const sameOwnerRunning=active.find(w=>
        w.projectId!==projectId&&w.userId===userId&&w.state==="running"&&!w.action);
      if(sameOwnerRunning)await tx.update(workspacesTable).set({
        action:"stop",state:"queued",
        phase:"Stopping your other running workspace before starting this one",
        runtimeUntil:new Date(0),updatedAt:new Date(),
      }).where(eq(workspacesTable.projectId,sameOwnerRunning.projectId));
      const blockingWorkspace=active.find(w=>w.projectId!==projectId&&
        !(w.userId===userId&&(w.state==="running"||
          (w.state==="queued"&&w.action==="stop"))));
      if(blockingWorkspace)throw new Error("Free trial allows one running workspace globally. Stop the other workspace first.");
      const maxCents = runtimeBudgetLimitCents(process.env.ERA_RUNTIME_FREE_TRIAL_BUDGET_USD);
      if (!canReserveRuntimeBudget(budget.reservedCents,reserveCents,maxCents)||!Number.isFinite(maxProjects) ||
          (creates && !old?.databaseId && resourceCount>=maxProjects))
        throw new Error("ERA's shared $5 internal reservation cap for today has been reached. It is an internal free-trial safety limit; no paid capacity will be purchased.");
      await tx.update(runtimeBudgetTable).set({reservedCents:budget.reservedCents+reserveCents,
        provisions:budget.provisions+(creates?1:0)}).where(eq(runtimeBudgetTable.id,budgetId));
    }
    if (old) await tx.update(workspacesTable).set({action,state:"queued",error:null,phase:`Queued: ${action}`,leaseUntil:null,runtimeUntil:null,updatedAt:new Date()})
      .where(eq(workspacesTable.projectId,projectId));
    else await tx.insert(workspacesTable).values({projectId,userId,action});
  });
  void runWorkspaceJobs();
}
async function performWorkspace(row: Row) {
  const id=row.projectId;
  let budgetReservationCents = ["start","restart","rebuild"].includes(row.action ?? "")
    ? (row.action==="start"&&row.sandboxId&&row.databaseId&&row.revision?0:5)
    : 0;
  let reachedRunning = false;
  let secrets=[process.env.GOOGLE_AI_API_KEY??"",process.env.DAYTONA_API_KEY??"",process.env.NEON_API_KEY??"",
    process.env.SESSION_SECRET??"",process.env.DATABASE_URL??"",process.env.RAZORPAY_KEY_SECRET??""];
  const update=async (values: Partial<typeof workspacesTable.$inferInsert>)=>{
    await db.update(workspacesTable).set({...values,updatedAt:new Date()}).where(eq(workspacesTable.projectId,id));
  };
  const log=async (text:string)=>{
    const clean=redactRuntimeLog(text,secrets);
    await db.update(workspacesTable).set({logs:sql`right(${workspacesTable.logs} || ${"\n"+clean},16000)`,updatedAt:new Date()}).where(eq(workspacesTable.projectId,id));
  };
  let sandbox: Sandbox|undefined;
  try {
    if(row.action!=="stop" && row.action!=="delete" && !runtimeEnabled())
      throw new Error("Workspace runtime is unavailable because Daytona or Neon provider credentials are not configured.");
    if (row.credentials && row.action!=="delete" && row.action!=="stop") {
      const creds=decryptRuntimeCredentials<RuntimeCredentials>(row.credentials);
      secrets.push(creds.ownerUrl,creds.runtimeUrl,new URL(creds.runtimeUrl).password,new URL(creds.ownerUrl).password);
    }
    if (row.action==="delete") {
      await update({state:"deleting",phase:"Deleting workspace and project database (source retained)"});
      if (row.sandboxId) {
        try { await daytona().delete(await daytona().get(row.sandboxId)); }
        catch(e:any) { if (!/not found/i.test(e.message) && e.statusCode!==404) throw new Error("Runtime cleanup failed; use Delete again to retry. Source and cleanup records were retained."); }
        await update({sandboxId:null,runtimeUntil:null});
      }
      if (row.databaseId) { await neon(`/projects/${row.databaseId}`,"DELETE"); await update({databaseId:null,credentials:null}); }
      await update({state:"deleted",action:null,phase:"Workspace/database deleted; generated source retained",revision:null,leaseUntil:null,logs:""});
      return;
    }
    if (row.action==="stop") {
      if (row.sandboxId) {
        sandbox=await daytona().get(row.sandboxId);
        if(sandbox.state!=="stopped"&&sandbox.state!=="archived")await sandbox.stop(60);
      }
      await update({state:"stopped",action:null,phase:"Stopped; project database and source are preserved",runtimeUntil:null,leaseUntil:null});
      return;
    }
    const files=await db.select().from(filesTable).where(eq(filesTable.projectId,id));
    const revision=sourceRevision(files.map(f=>({path:f.path,content:f.content})));
    const canResume=row.action==="start"&&!!row.sandboxId&&!!row.databaseId&&row.revision===revision;
    budgetReservationCents=canResume?0:5;
    validateWorkspaceSource(files);
    await update({state:"provisioning",phase:"Provisioning an isolated runtime and private project database"});
    let databaseId=row.databaseId;
    if (!databaseId) {
      databaseId=(await createDatabase(id)).id;
      await update({databaseId});
    }
    let credentials:RuntimeCredentials;
    if(row.credentials) credentials=decryptRuntimeCredentials(row.credentials);
    else {
      credentials=await databaseCredentials(databaseId);
      await update({credentials:encryptRuntimeCredentials(credentials)});
    }
    secrets.push(credentials.ownerUrl,credentials.runtimeUrl,new URL(credentials.runtimeUrl).password,new URL(credentials.ownerUrl).password);
    sandbox=row.sandboxId?await daytona().get(row.sandboxId):await createSandbox(id);
    await update({sandboxId:sandbox.id,state:"building",phase:"Installing dependencies, applying migrations and starting backend"});
    const resumed = await buildSandbox(sandbox,credentials,files,revision,log,
      row.action === "start" && row.revision === revision);
    const stopAfterBuild = await db.transaction(async tx => {
      const [latestWorkspaceState] = await tx.select({ runtimeUntil: workspacesTable.runtimeUntil })
        .from(workspacesTable).where(eq(workspacesTable.projectId, id)).for("update");
      if (latestWorkspaceState?.runtimeUntil && latestWorkspaceState.runtimeUntil <= new Date()) {
        await tx.update(workspacesTable).set({
          state:"queued", action:"stop", phase:"Stopping because Preview closed during the build",
          revision, starts:row.starts+1, error:null, updatedAt:new Date(),
        }).where(eq(workspacesTable.projectId, id));
        return true;
      }
      await tx.update(workspacesTable).set({
        state:"running", action:null, phase:"Frontend/backend ready. This run suspends after 10 minutes.",
        revision, runtimeUntil:new Date(Date.now()+10*60_000), starts:row.starts+1,
        error:null, leaseUntil:null, updatedAt:new Date(),
      }).where(eq(workspacesTable.projectId, id));
      return false;
    });
    if (stopAfterBuild) {
      await sandbox.stop(60);
      if(budgetReservationCents>0){
        await refundRuntimeBudget(budgetReservationCents,runtimeBudgetWindowId(row.updatedAt));
        budgetReservationCents=0;
      }
      await update({
        state:"stopped", action:null, phase:"Stopped after Preview closed",
        error:null, leaseUntil:null, runtimeUntil:null,
      });
      await log("Preview closed during the build; the runtime was stopped after health check.");
      return;
    }
    reachedRunning=true;
    if (resumed) await log("Resumed the existing build without reinstalling dependencies or rerunning migrations.");
    await log("Backend health check passed. Private preview is ready.");
  } catch(error) {
    const message=redactRuntimeLog(error instanceof Error?error.message:"Workspace operation failed.",secrets);
    if(!reachedRunning&&budgetReservationCents>0){
      try{
        await refundRuntimeBudget(budgetReservationCents,runtimeBudgetWindowId(row.updatedAt));
        budgetReservationCents=0;
      }catch(refundError){
        logger.error({projectId:id,message:refundError instanceof Error?refundError.message:"Unknown error"},
          "Failed to refund workspace reservation after operation failure");
      }
    }
    let stopFailure: string | null = null;
    if(sandbox) {
      try { await sandbox.stop(30); }
      catch(stopError) {
        stopFailure = redactRuntimeLog(stopError instanceof Error ? stopError.message : "Runtime stop failed.", secrets);
      }
    }
    const failureDetail = stopFailure ? `${message} Runtime stop also failed: ${stopFailure}` : message;
    await log(failureDetail);
    const failureState = await db.transaction(async tx => {
      const [latestWorkspaceState] = await tx.select({ runtimeUntil: workspacesTable.runtimeUntil })
        .from(workspacesTable).where(eq(workspacesTable.projectId, id)).for("update");
      const stopRequested = Boolean(latestWorkspaceState?.runtimeUntil && latestWorkspaceState.runtimeUntil <= new Date());
      if (stopRequested && !stopFailure) {
        await tx.update(workspacesTable).set({
          state:"stopped", action:null, phase:"Stopped after Preview closed; the build did not finish.",
          error:message, leaseUntil:null, runtimeUntil:null, updatedAt:new Date(),
        }).where(eq(workspacesTable.projectId, id));
        return "stopped";
      }
      if (stopRequested) {
        // Keep a durable stop action so another worker can retry after this
        // operation's lease expires.
        await tx.update(workspacesTable).set({
          state:"queued", action:"stop", phase:"Runtime stop failed; retrying cleanup.",
          error:failureDetail, updatedAt:new Date(),
        }).where(eq(workspacesTable.projectId, id));
        return "retry-stop";
      }
      await tx.update(workspacesTable).set({
        state:"failed",action:null,
        phase:stopFailure ? "Workspace cleanup failed; stop the runtime or retry." : "Operation failed; source/database retained. Retry explicitly.",
        error:failureDetail,leaseUntil:null,runtimeUntil:null,updatedAt:new Date(),
      }).where(eq(workspacesTable.projectId, id));
      return "failed";
    });
    if (failureState === "stopped" || failureState === "retry-stop") {
      logger.warn({projectId:id,message:failureDetail},"Workspace operation ended while stopping after Preview closed");
      return;
    }
    logger.warn({projectId:id,message:failureDetail},"Workspace operation failed");
  }
}
async function refundRuntimeBudget(cents:number,budgetId:string):Promise<void>{
  if(cents<=0)return;
  await db.update(runtimeBudgetTable)
    .set({reservedCents:sql`greatest(0,${runtimeBudgetTable.reservedCents}-${cents})`})
    .where(eq(runtimeBudgetTable.id,budgetId));
}
let busy=false;
export async function runWorkspaceJobs() {
  if(busy)return;
  busy=true;
  try{
    const rows=await db.select().from(workspacesTable).where(or(sql`${workspacesTable.action} IS NOT NULL`,
      eq(workspacesTable.state,"running")))
      .orderBy(sql`CASE WHEN ${workspacesTable.action} = 'stop' THEN 0 ELSE 1 END`,workspacesTable.updatedAt);
    for(const row of rows){
      if(!row.action && row.runtimeUntil && row.runtimeUntil<=new Date()){
        await db.update(workspacesTable).set({action:"stop",state:"queued",phase:"Suspending the expired trial run"}).where(eq(workspacesTable.projectId,row.projectId));
        continue;
      }
      if(!row.action)continue;
      const [claimed]=await db.update(workspacesTable).set({leaseUntil:new Date(Date.now()+120_000),attempts:row.attempts+1})
        .where(and(eq(workspacesTable.projectId,row.projectId),or(isNull(workspacesTable.leaseUntil),lt(workspacesTable.leaseUntil,new Date())))).returning();
      if(!claimed)continue;
      const heartbeat=setInterval(()=>void db.update(workspacesTable).set({leaseUntil:new Date(Date.now()+120_000)})
        .where(eq(workspacesTable.projectId,row.projectId)).catch(()=>{}),20_000);
      try{await performWorkspace(claimed);}finally{clearInterval(heartbeat);}
    }
  }catch(e){logger.error({message:e instanceof Error?e.message:"Unknown worker failure"},"Workspace worker unavailable");}
  finally{busy=false;}
}
export function startWorkspaceRunner() {
  const timer=setInterval(()=>void runWorkspaceJobs(),10_000);timer.unref();
  void runWorkspaceJobs();
}
