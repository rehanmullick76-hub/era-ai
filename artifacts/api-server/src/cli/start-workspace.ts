import { desc, eq } from "drizzle-orm";
import { db, pool, projectsTable, workspacesTable } from "@workspace/db";
import { queueWorkspace, runtimeEnabled } from "../lib/workspace-runner";

const projectIdArg = process.argv.find((arg) => arg.startsWith("--project-id="));
const requestedProjectId = projectIdArg?.slice("--project-id=".length);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const candidates = await db
    .select({
      projectId: workspacesTable.projectId,
      userId: workspacesTable.userId,
      state: workspacesTable.state,
      action: workspacesTable.action,
      phase: workspacesTable.phase,
      name: projectsTable.name,
    })
    .from(workspacesTable)
    .innerJoin(projectsTable, eq(workspacesTable.projectId, projectsTable.id))
    .where(eq(projectsTable.mode, "fullstack"))
    .orderBy(desc(workspacesTable.updatedAt));

  const selected = requestedProjectId
    ? candidates.filter((workspace) => workspace.projectId === requestedProjectId)
    : candidates;

  if (selected.length !== 1) {
    if (!selected.length) {
      throw new Error("No matching full-stack workspace was found.");
    }
    const list = candidates
      .map((workspace) => `${workspace.name}: ${workspace.projectId}`)
      .join("\n");
    throw new Error(
      `More than one full-stack workspace exists. Re-run with --project-id=<ID>:\n${list}`,
    );
  }

  const workspace = selected[0];
  if (!workspace) throw new Error("Workspace selection failed.");
  if (workspace.state === "running" && !workspace.action) {
    console.log(`Workspace "${workspace.name}" is already running.`);
    return;
  }

  if (workspace.action) {
    if (!["start", "restart", "rebuild"].includes(workspace.action)) {
      throw new Error(`Workspace already has an active "${workspace.action}" operation.`);
    }
    console.log(`Existing ${workspace.action} operation: ${workspace.phase}`);
  } else {
    if (!runtimeEnabled()) {
      throw new Error(
        "Daytona and Neon provider connections are not configured. Add both provider secrets, then retry.",
      );
    }
    await queueWorkspace(workspace.projectId, workspace.userId, "start");
    console.log(`Start queued for "${workspace.name}". Waiting for the build...`);
  }

  let lastPhase = "";
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const [current] = await db
      .select({
        state: workspacesTable.state,
        action: workspacesTable.action,
        phase: workspacesTable.phase,
        error: workspacesTable.error,
      })
      .from(workspacesTable)
      .where(eq(workspacesTable.projectId, workspace.projectId));

    if (!current) throw new Error("Workspace record disappeared while starting.");
    if (current.phase !== lastPhase) {
      lastPhase = current.phase;
      console.log(`${current.state}: ${current.phase}`);
    }
    if (current.state === "running" && !current.action) {
      console.log("Workspace is running. Open ERA Preview and load the private preview.");
      return;
    }
    if (current.state === "failed" && !current.action) {
      throw new Error(current.error || current.phase);
    }
    if (current.state === "stopped" && !current.action) {
      throw new Error(current.error || current.phase);
    }
    await sleep(5_000);
  }
  throw new Error("Start is still in progress. Check the workspace status in ERA.");
}

try {
  await main();
} catch (error) {
  console.error(`Workspace start failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
