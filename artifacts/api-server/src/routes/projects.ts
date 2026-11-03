import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { aiGenerateJobsTable, db, projectsTable, filesTable, workspacesTable } from "@workspace/db";
import { runtimeConfigured } from "../lib/workspace-runner";
import { daytona, neon } from "../lib/workspace-provider";
import { RUNTIME_LIMITS, safeWorkspacePath } from "../lib/workspace-policy";
import {
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_FILES,
  MAX_PROJECT_SOURCE_BYTES,
  isProjectFileUsageWithinLimits,
  projectFileUsageAfterUpsert,
} from "../lib/project-file-limits";
import {
  CreateProjectBody,
  GetProjectParams,
  ListProjectsResponse,
  GetProjectResponse,
  DeleteProjectResponse,
  UpsertFileParams,
  UpsertFileBody,
  UpsertFileResponse,
  ListFilesParams,
  ListFilesResponse,
  DeleteFileParams,
  DeleteFileResponse,
} from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

router.use("/projects", authMiddleware);
router.use("/projects/:id", authMiddleware);

router.get("/projects", async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;
  const projects = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId))
    .orderBy(desc(projectsTable.updatedAt));
  res.json(ListProjectsResponse.parse(projects.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }))));
});

router.post("/projects", async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if(parsed.data.mode==="fullstack"&&!runtimeConfigured()){
    res.status(409).json({error:"Full-stack generation requires the Daytona and Neon provider connections."});return;
  }
  const [project] = await db.insert(projectsTable).values({
    userId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    mode: parsed.data.mode,
  }).returning();
  res.status(201).json(GetProjectResponse.parse({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }));
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, userId)));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(GetProjectResponse.parse({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }));
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = (req as any).userId as string;
  const projectId = params.data.id;
  const claim = await db.transaction(async tx => {
    // Serialize project deletion with workspace operations queued through the
    // shared runtime lock, then keep the local cleanup state retryable.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7318291)`);
    const [project] = await tx.select().from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
      .for("update");
    if (!project) return { status: "not-found" as const };
    const [activeJob] = await tx.select({ id: aiGenerateJobsTable.id })
      .from(aiGenerateJobsTable)
      .where(and(
        eq(aiGenerateJobsTable.projectId, projectId),
        inArray(aiGenerateJobsTable.status, ["queued", "running"]),
      ))
      .limit(1);
    if (activeJob) return { status: "busy" as const, reason: "generation" as const };
    const [workspace] = await tx.select().from(workspacesTable)
      .where(eq(workspacesTable.projectId, projectId)).for("update");
    if (workspace && (workspace.action || workspace.state === "deleting" ||
        (workspace.leaseUntil && workspace.leaseUntil > new Date()))) {
      return { status: "busy" as const, reason: "workspace" as const };
    }
    if (workspace) {
      await tx.update(workspacesTable).set({
        state: "deleting",
        action: null,
        phase: "Deleting project runtime and database",
        error: null,
        leaseUntil: null,
        updatedAt: new Date(),
      }).where(eq(workspacesTable.projectId, projectId));
    }
    return { status: "claimed" as const, workspace };
  });

  if (claim.status === "not-found") {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (claim.status === "busy") {
    res.status(409).json({
      error: claim.reason === "generation"
        ? "AI generation is still running. Wait for it to finish before deleting this project."
        : "A workspace operation is still running. Wait for it to finish, then retry project deletion.",
    });
    return;
  }

  try {
    const workspace = claim.workspace;
    if (workspace?.sandboxId) {
      try {
        const client = daytona();
        await client.delete(await client.get(workspace.sandboxId));
      } catch (error) {
        const providerError = error as { statusCode?: number; status?: number; message?: string };
        if (providerError.statusCode !== 404 && providerError.status !== 404 &&
            !/not found/i.test(providerError.message ?? "")) throw error;
      }
      await db.update(workspacesTable).set({ sandboxId: null, runtimeUntil: null, updatedAt: new Date() })
        .where(eq(workspacesTable.projectId, projectId));
    }
    if (workspace?.databaseId) {
      await neon(`/projects/${encodeURIComponent(workspace.databaseId)}`, "DELETE");
      await db.update(workspacesTable).set({ databaseId: null, credentials: null, updatedAt: new Date() })
        .where(eq(workspacesTable.projectId, projectId));
    }

    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7318291)`);
      const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable)
        .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId))).for("update");
      if (!project) throw new Error("Project is no longer available.");
      await tx.delete(workspacesTable).where(eq(workspacesTable.projectId, projectId));
      await tx.delete(projectsTable).where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)));
    });
    res.json(DeleteProjectResponse.parse({ success: true }));
  } catch (error) {
    req.log.warn({ projectId, message: error instanceof Error ? error.message : "Unknown cleanup failure" },
      "Project cleanup failed; project source and retry state are retained");
    await db.update(workspacesTable).set({
      state: "failed",
      action: null,
      phase: "Cleanup failed; project source and remaining resources are retained. Retry project deletion.",
      error: "Could not remove all workspace resources. Project data is retained; retry deletion.",
      leaseUntil: null,
      updatedAt: new Date(),
    }).where(eq(workspacesTable.projectId, projectId));
    res.status(502).json({ error: "Could not remove all workspace resources. Project data is retained; retry deletion." });
  }
});

router.get("/projects/:id/files", async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;
  const params = ListFilesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, userId)));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const files = await db.select().from(filesTable).where(eq(filesTable.projectId, params.data.id));
  res.json(ListFilesResponse.parse(files.map((f) => ({
    ...f,
    updatedAt: f.updatedAt.toISOString(),
  }))));
});

router.post("/projects/:id/files", async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;
  const params = UpsertFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpsertFileBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if(!safeWorkspacePath(body.data.path)){
    res.status(400).json({error:"Unsafe or reserved workspace file path"});return;
  }
  if (Buffer.byteLength(body.data.content, "utf8") > MAX_PROJECT_FILE_BYTES) {
    res.status(413).json({ error: "A project file cannot exceed 500 KB." });
    return;
  }

  const result = await db.transaction(async tx => {
    const [project] = await tx.select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, userId)))
      .for("update");
    if (!project) return { status: "not-found" as const };

    const existingFiles = await tx.select({ path: filesTable.path, content: filesTable.content })
      .from(filesTable)
      .where(eq(filesTable.projectId, params.data.id));
    const projected = projectFileUsageAfterUpsert(existingFiles, body.data.path, body.data.content);
    if (!isProjectFileUsageWithinLimits(
      projected,
      Math.min(RUNTIME_LIMITS.maxFiles, MAX_PROJECT_FILES),
      Math.min(RUNTIME_LIMITS.maxBytes, MAX_PROJECT_SOURCE_BYTES),
    ))
      return { status: "too-large" as const };

    const [file] = await tx.insert(filesTable).values({
      projectId: params.data.id,
      path: body.data.path,
      content: body.data.content,
      language: body.data.language,
    }).onConflictDoUpdate({
      target: [filesTable.projectId, filesTable.path],
      set: {
        content: body.data.content,
        language: body.data.language,
        updatedAt: new Date(),
      },
    }).returning();
    if (!file) return { status: "save-failed" as const };
    await tx.update(projectsTable)
      .set({ updatedAt: new Date() })
      .where(eq(projectsTable.id, params.data.id));
    return { status: "saved" as const, file };
  });
  if (result.status === "not-found") {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (result.status === "too-large") {
    res.status(413).json({ error: "A project can contain at most 100 files and 1 MB of source." });
    return;
  }
  if (result.status === "save-failed") {
    res.status(500).json({ error: "Failed to save file" });
    return;
  }

  res.json(UpsertFileResponse.parse({ ...result.file, updatedAt: result.file.updatedAt.toISOString() }));
});

router.delete("/projects/:id/files/*filePath", async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = raw;
  const filePathRaw = req.params.filePath;
  const filePath = Array.isArray(filePathRaw) ? filePathRaw.join("/") : filePathRaw;

  const params = DeleteFileParams.safeParse({ id, filePath });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, userId)));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [target] = await db.delete(filesTable)
    .where(and(eq(filesTable.projectId, params.data.id), eq(filesTable.path, filePath)))
    .returning({ id: filesTable.id });
  if (!target) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  await db
    .update(projectsTable)
    .set({ updatedAt: new Date() })
    .where(eq(projectsTable.id, params.data.id));

  res.json(DeleteFileResponse.parse({ success: true }));
});

export default router;
