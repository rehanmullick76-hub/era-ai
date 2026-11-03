import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, filesTable, projectsTable, workspacesTable } from "@workspace/db";
import { ControlWorkspaceBody, GetWorkspaceParams } from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";
import { publicWorkspace, queueWorkspace, runtimeConfigured, runtimeEnabled } from "../lib/workspace-runner";
import { daytona, isPrivateProviderPreview } from "../lib/workspace-provider";
import { runtimeLogs } from "../lib/workspace-logs";
import { sourceRevision } from "../lib/workspace-policy";

const router=Router();
router.get("/runtime/capabilities",authMiddleware,(_req,res)=>{
  const configured=runtimeConfigured();
  const enabled=runtimeEnabled();
  res.json({configured,enabled,notice:enabled
    ?"Development preview: at most 3 provisioned workspaces globally, 2 per account, 1 running at a time; shared $5 internal reservation cap, 10-minute runs and 5-minute idle suspension. The cap is not a provider spend limit. Provider credits and billing follow your Daytona/Neon account settings; ERA does not check wallet balance or change auto-top-up. Not production hosting."
    :configured
      ?"Full-stack generation remains available. Configure Daytona and Neon provider connections to start a private development runtime."
      :"Full-stack generation requires Daytona and Neon provider connections. Source generation/export and existing workspace cleanup remain available."});
});
router.use("/projects/:id/workspace",authMiddleware);
async function owned(req:any) {
  if(!GetWorkspaceParams.safeParse(req.params).success)return null;
  const [project]=await db.select().from(projectsTable).where(and(eq(projectsTable.id,req.params.id),eq(projectsTable.userId,req.userId)));
  return project?.mode==="fullstack"?project:null;
}
router.get("/projects/:id/workspace",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(!await owned(req)){res.status(404).json({error:"Full-stack project not found"});return;}
  const [row]=await db.select().from(workspacesTable).where(eq(workspacesTable.projectId,req.params.id));
  const files=await db.select({path:filesTable.path,content:filesTable.content}).from(filesTable)
    .where(eq(filesTable.projectId,req.params.id));
  const currentRevision=files.length?sourceRevision(files):null;
  const workspace=publicWorkspace(req.params.id,row,currentRevision);
  const logs=row?await runtimeLogs(row):"";
  if(logs)workspace.logs+="\nRuntime:\n"+logs;
  res.json(workspace);
});
router.post("/projects/:id/workspace",async(req,res)=>{
  if(!await owned(req)){res.status(404).json({error:"Full-stack project not found"});return;}
  const body=ControlWorkspaceBody.safeParse(req.body);
  if(!body.success){res.status(400).json({error:"Invalid workspace action"});return;}
  if(body.data.action==="delete"&&!body.data.confirmDataLoss){res.status(409).json({error:"Explicit confirmation is required: this permanently deletes the project's database records and runtime."});return;}
  try {
    await queueWorkspace(req.params.id,(req as any).userId,body.data.action);
    const [row]=await db.select().from(workspacesTable).where(eq(workspacesTable.projectId,req.params.id));
    const files=await db.select({path:filesTable.path,content:filesTable.content}).from(filesTable)
      .where(eq(filesTable.projectId,req.params.id));
    const currentRevision=files.length?sourceRevision(files):null;
    res.status(202).json(publicWorkspace(req.params.id,row,currentRevision));
  }catch(e){res.status(409).json({error:e instanceof Error?e.message:"Workspace operation rejected"});}
});
router.post("/projects/:id/workspace/preview",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(!await owned(req)){res.status(404).json({error:"Full-stack project not found"});return;}
  const [row]=await db.select().from(workspacesTable).where(eq(workspacesTable.projectId,req.params.id));
  if(row?.state!=="running"||!row.sandboxId||!row.runtimeUntil||row.runtimeUntil<=new Date()){res.status(409).json({error:"Start the workspace and wait for a successful build first."});return;}
  try{
    const sandbox=await daytona().get(row.sandboxId);
    const preview=await sandbox.getSignedPreviewUrl(3000,300);
    // Separate preview origins are mandatory, never ERA's own origin.
    if(!await isPrivateProviderPreview(preview.url,sandbox)){
      res.status(502).json({error:"Runtime returned an unrecognized preview origin."});return;
    }
    res.json({url:preview.url,expiresAt:new Date(Date.now()+300_000).toISOString()});
  }catch{res.status(502).json({error:"Private preview unavailable. The workspace may have idled; restart it explicitly."});}
});
export default router;
