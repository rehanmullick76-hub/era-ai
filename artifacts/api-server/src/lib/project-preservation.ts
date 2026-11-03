import type { ExistingProjectFile, ResolvedGeneratedFile } from "./patchSafety";

/** Apply new-site defaults only to empty projects, never to follow-up edits. */
export const EDIT_PROJECT_SYSTEM = `You are ERA, a senior developer editing an EXISTING website, not generating a replacement.
The latest user request is the only change authorization. Earlier conversation explains context, not permission to rebuild.
Preserve all unrelated pages, text, images, branding, layout, colors, fonts, navigation, and functionality.
Use the existing site's styles and components as the design source of truth. Do not invent a new palette or theme.
The complete file inventory below is authoritative: files omitted from source context STILL EXIST.
Return only changed files. Do not regenerate every page, split the site, or add standard pages to meet a page count.
For existing files, use localized action:"patch" with exact unique find/replace strings from supplied source.
Never use action:"create" for a path in the inventory. Do not patch truncated or unseen source.
For genuinely new files, use action:"create" and complete content. Use "update" only if the user actually requested a substantial rewrite of that file.
Delete files only when the latest request explicitly requires deletion.
When ADDING A PAGE: create a separate HTML file (for example signup.html). Never replace index.html.
Reuse existing stylesheets unchanged. Put extra page-specific CSS/JS in NEW files loaded only by the new page.
The only permitted changes to existing HTML for a page addition are inserting navigation links to the new page; preserve all existing links and content verbatim.
Do not repair unrelated issues on old pages while adding a page.
Keep existing relative navigation conventions, and link the new page back to the home page.
Respond with a brief message followed by a fenced JSON array.
New file: {"path":"signup.html","action":"create","language":"html","content":"complete source"}
Patch: {"path":"index.html","action":"patch","edits":[{"find":"exact unique original","replace":"original with a minimal change"}]}
Delete (only if explicitly requested): {"path":"old.html","action":"delete"}
For conversation without build intent, return a short reply and a fenced JSON object {"message":"...","files":[]}.
Output valid JSON with escaped source strings. Never use omitted-code placeholders.`;

export function isPageAddition(prompt: string): boolean {
  // Automatic QA prompts are targeted fixes to files already created, not a
  // second request to add a page.
  if (/\n\nAdditionally, fix these issues found in the code:/i.test(prompt)) return false;
  // Only the original user request, not appended automatic QA instructions,
  // determines whether old pages must remain untouched.
  const request = prompt.split(/\n\nAdditionally, fix these issues/i)[0];
  const page = /\b(?:page|screen|sign[\s-]?up|register|login)\b|পেজ|পৃষ্ঠা/i;
  const add = /\b(?:add|create|build|make|new|another|signup)\b|বানাও|বানাতে|বানিয়ে|বানিয়ে|তৈরি|যোগ|নতুন|\b(?:banao|banate|banai|koro|akta|ekta)\b/i;
  const broadRewrite = /\b(?:redesign|rebuild|replace)\s+(?:(?:the|my|whole|entire|existing)\s+)*(?:website|site|project)\b/i;
  // Adding a button/field ON an existing page is an ordinary localized edit,
  // not a request for a separate new HTML document.
  const pageWord = /\b(?:page|screen)\b|পেজ|পৃষ্ঠা/i.exec(request);
  const beforePage = pageWord ? request.slice(0, pageWord.index) : request;
  if (/\b(?:button|form|field|link|section|modal|text|title|heading|colou?r)\b/i.test(beforePage) ||
      /\b(?:to|on|in|inside|within)\s+(?:(?:the|my|existing|home|main|current)\s+)*(?:page|screen)\b/i.test(request)) {
    return false;
  }
  return page.test(request) && add.test(request) && !broadRewrite.test(request);
}

/** New-page additions may insert links, but must not replace existing markup. */
function withoutAddedLinks(content: string, newPages: Set<string>, currentPath: string): string {
  const pointsToNewPage = (attributes: string) => {
    if (/\bon\w+\s*=/i.test(attributes)) return false;
    const href = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const value = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return false;
    try {
      const resolved = new URL(value, `https://era.invalid/${currentPath}`);
      return newPages.has(decodeURIComponent(resolved.pathname).replace(/^\/+/, ""));
    } catch { return false; }
  };
  const safeInsertedLink = (attributes: string, markup: string) =>
    pointsToNewPage(attributes) &&
    !/\bon[a-z0-9_-]*\s*=/i.test(markup) &&
    !/<\s*\/?\s*(?:script|style|iframe|object|embed|link|meta|base|svg|math|form|input|button|textarea|select|option|img|video|audio|details|summary|template|portal)\b/i.test(markup);
  // Permit a list item wrapper around a newly inserted navigation anchor.
  return content
    .replace(/<li\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<\/li>/gi,
      (match, attributes: string) =>
        safeInsertedLink(attributes, match) ? "" : match)
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
      (match, attributes: string) =>
        safeInsertedLink(attributes, match) ? "" : match);
}

/** Validate the ENTIRE resolved batch before returning any files to the UI. */
export function getProjectChangeViolation(
  prompt: string,
  originals: ExistingProjectFile[],
  generated: ResolvedGeneratedFile[],
  validateGeneratedFile?: (file: ResolvedGeneratedFile) => string | null,
): string | null {
  const pathKey = (path: string) => path.replace(/^(?:\.\/)+/, "");
  const seen = new Set<string>();
  const originalByPath = new Map(originals.map(file => [pathKey(file.path), file]));
  const additive = originals.length > 0 && isPageAddition(prompt);
  const newPages = new Set(generated.filter(file =>
    file.action === "create" && !originalByPath.has(pathKey(file.path)) && /\.html$/i.test(file.path),
  ).map(file => pathKey(file.path)));
  for (const file of generated) {
    const fileViolation = validateGeneratedFile?.(file);
    if (fileViolation) return fileViolation;
    if (/(?:^|\/)\.\.(?:\/|$)|\\|[?#]|^[a-z][a-z0-9+.-]*:|^\//i.test(file.path)) {
      return `Use a normal relative project path, not ${file.path}.`;
    }
    const path = pathKey(file.path);
    if (seen.has(path)) return `Duplicate output for ${file.path}.`;
    seen.add(path);
    const original = originalByPath.get(path);
    if (original && file.action === "create") {
      return `${file.path} already exists. Do not overwrite it with action:create.`;
    }
    if (original && /^migrations\/[a-zA-Z0-9_-]+\.sql$/i.test(path) &&
        (file.action === "delete" || file.content !== original.content)) {
      return `Existing SQL migration ${file.path} is immutable. Add a new numbered migration only if a schema change is required.`;
    }
    if (!additive || !original) continue;
    if (file.action === "delete") return `Adding a page must not delete ${file.path}.`;
    if (file.content === original.content) continue;
    if (!/\.html$/i.test(file.path)) {
      return `Adding a page must preserve existing ${file.path}; create page-specific CSS/JS files instead.`;
    }
    // Ignore whitespace between markup only, never whitespace inside user copy,
    // scripts, attributes, style declarations, etc.
    const normalized = (source: string) => source.replace(/>\s+</g, "><").trim();
    if (normalized(withoutAddedLinks(file.content, newPages, file.path)) !== normalized(original.content)) {
      return `Adding a page must preserve ${file.path}; only insert links to the new page.`;
    }
  }
  if (additive && generated.length > 0 && newPages.size === 0) {
    return "Create a separate new HTML page instead of replacing an existing page.";
  }
  return null;
}
