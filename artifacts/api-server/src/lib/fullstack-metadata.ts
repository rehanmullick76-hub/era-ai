import type { ResolvedGeneratedFile } from "./patchSafety";

const defaults: ResolvedGeneratedFile[] = [
  {path:"package.json",action:"create",language:"json",content:JSON.stringify({
    private:true,type:"module",scripts:{start:"node --env-file-if-exists=.env server.mjs"},
    dependencies:{express:"5.2.1","@neondatabase/serverless":"1.0.2"},
  },null,2)},
  {path:".env.example",action:"create",language:"text",content:"PORT=3000\nDATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require\n"},
  {path:"README.md",action:"create",language:"markdown",content:`# Full-stack project

Requires Node.js 22+ and a private Neon PostgreSQL database.

1. Run npm install.
2. Copy .env.example to .env and replace its database placeholders.
3. From a machine with PostgreSQL TCP access, apply every migrations/*.sql file in filename order using psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f FILE. Set DATABASE_URL in that shell first.
4. Run node --env-file=.env server.mjs, then open http://localhost:3000.

The backend uses @neondatabase/serverless HTTPS SQL for its PostgreSQL API.
Keep .env and database credentials out of version control and browser code.
ERA private previews are limited trial development workspaces, not production hosting.
Stopping/rebuilding preserves database data; explicitly deleting a workspace/database removes it permanently.
`},
];

/** Missing packaging/docs are deterministic; never spend another model call to
 * invent them. Do not replace existing files or resurrect explicit deletions. */
export function withFullstackMetadata(files:ResolvedGeneratedFile[],existing:{path:string}[]):ResolvedGeneratedFile[]{
  if(!files.length)return files;
  const paths=new Set(existing.map(f=>f.path));
  const deleted=new Set<string>();
  for(const file of files){if(file.action==="delete"){paths.delete(file.path);deleted.add(file.path);}else paths.add(file.path);}
  return [...files,...defaults.filter(f=>!paths.has(f.path)&&!deleted.has(f.path))];
}
