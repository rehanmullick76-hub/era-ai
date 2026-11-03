import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Resolve extensionless production imports using the same bundler as the API.
const { outputFiles } = await build({
  entryPoints: [new URL("../src/lib/fullstack-completeness.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
});
const { ensureFullstackCompleteness } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

const source = [
  { path: "public/index.html", content: "<!doctype html><h1>Original design</h1>" },
  { path: "server.mjs", content: "const rows = await sql`SELECT id, title FROM notes`;" },
  { path: "package.json", content: JSON.stringify({ type: "module", dependencies: { express: "5.2.1", "@neondatabase/serverless": "1.0.2" } }) },
  { path: "README.md", content: "Setup" },
  { path: ".env.example", content: "PORT=3000" },
];
const migration = { path: "migrations/001_initial.sql", content: "CREATE TABLE IF NOT EXISTS notes(id serial PRIMARY KEY, title text NOT NULL);", action: "create", language: "sql" };
const generated = () => source.map(file => ({ ...file, action: "create" }));

test("missing SQL migration gets one scoped repair based on actual source", async () => {
  let calls = 0;
  const files = generated();
  const completed = await ensureFullstackCompleteness(files, [], async (missing, context) => {
    calls++;
    assert.deepEqual(missing, ["migrations/001_initial.sql"]);
    assert.equal(context.find(file => file.path === "server.mjs").content, source[1].content);
    return [migration];
  });
  assert.equal(calls, 1);
  assert.deepEqual(completed, [...files, migration]);
  assert.equal(completed[0].content, source[0].content);
});

test("complete new or existing projects do not spend another model call", async () => {
  const unexpected = async () => assert.fail("repair should not run");
  const complete = [...generated(), migration];
  assert.deepEqual(await ensureFullstackCompleteness(complete, [], unexpected), complete);
  const changes = [{ path: "public/new.html", content: "New page", action: "create" }];
  assert.deepEqual(await ensureFullstackCompleteness(changes, [...source, migration], unexpected), changes);
});

test("empty message-only results skip full-stack validation and repair", async () => {
  const unexpected = async () => assert.fail("an empty reply should not trigger repair");
  assert.deepEqual(await ensureFullstackCompleteness([], [], unexpected), []);
});

test("completeness repair normalizes ./ paths and keeps only requested missing files", async () => {
  const repaired = await ensureFullstackCompleteness(generated(), [], async (missing) => {
    assert.deepEqual(missing, ["migrations/001_initial.sql"]);
    return [
      { ...migration, path: "./migrations/001_initial.sql" },
      { path: "./public/unrequested.html", content: "unrequested file", action: "create" },
    ];
  });
  assert.deepEqual(repaired.at(-1), migration);
  assert.equal(repaired.length, generated().length + 1);
});

test("repair cannot overwrite design, add extra files, duplicate paths or use destructive SQL", async () => {
  for (const additions of [
    [migration, { path: "public/index.html", content: "Redesigned", action: "update" }],
    [migration, migration],
    [{ ...migration, action: "update" }],
    [{ ...migration, content: "DROP TABLE notes;" }],
    [],
  ]) {
    await assert.rejects(ensureFullstackCompleteness(generated(), [], async () => additions));
  }
});

test("unsafe original source, explicit deletions and exhausted repair calls still fail", async () => {
  const unexpected = async () => assert.fail("repair should not run");
  await assert.rejects(ensureFullstackCompleteness([...generated(), { ...migration, content: "DELETE FROM notes;" }], [], unexpected), /Unsafe migration/);
  await assert.rejects(ensureFullstackCompleteness([{ path: migration.path, action: "delete" }], [...source, migration], unexpected), /SQL migration/);
  let calls = 0;
  await assert.rejects(ensureFullstackCompleteness(generated(), [], async () => {
    calls++;
    throw new Error("Provider limit");
  }), /Provider limit/);
  assert.equal(calls, 1);
});

test("unsafe generated demo-data migration gets one scoped, additive repair", async () => {
  const existing = [...source, migration];
  const badMigration = {
    path: "migrations/002_demo.sql",
    content: "INSERT INTO products(name) VALUES ('Demo');",
    action: "create",
    language: "sql",
  };
  const serverChange = {
    path: "server.mjs",
    content: "const demoProducts = await seedProductsThroughAppApi();",
    action: "update",
    language: "javascript",
  };
  const safeMigration = {
    path: "migrations/002_products.sql",
    content: "CREATE TABLE IF NOT EXISTS products(id serial PRIMARY KEY, name text NOT NULL);",
    action: "create",
    language: "sql",
  };
  let calls = 0;
  const repaired = await ensureFullstackCompleteness(
    [serverChange, badMigration],
    existing,
    async () => assert.fail("required-file repair should not run"),
    async (issue, _generated, context) => {
      calls++;
      assert.match(issue, /demo\/sample records/);
      assert.equal(context.find(file => file.path === "migrations/001_initial.sql").content, migration.content);
      return [serverChange, safeMigration];
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(repaired, [serverChange, safeMigration]);
  assert.ok(!repaired.some(file => file.content.includes("INSERT INTO")));
});

test("migration recovery cannot modify an already-existing migration", async () => {
  const existing = [...source, migration];
  const invalid = { ...migration, action: "update", content: "INSERT INTO notes(title) VALUES ('unsafe');" };
  await assert.rejects(
    ensureFullstackCompleteness(
      [invalid],
      existing,
      async () => assert.fail("required-file repair should not run"),
      async () => [{ ...migration, action: "create" }],
    ),
    /Existing migrations were preserved/,
  );
});

test("migration recovery cannot silently accept an empty correction", async () => {
  await assert.rejects(
    ensureFullstackCompleteness(
      [{ path: "migrations/002_demo.sql", content: "INSERT INTO products(name) VALUES ('Demo');", action: "create" }],
      [...source, migration],
      async () => assert.fail("required-file repair should not run"),
      async () => [],
    ),
    /no corrected files/,
  );
});
