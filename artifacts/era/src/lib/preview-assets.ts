export interface PreviewAssetFile {
  path: string;
  content: string;
}

const PREVIEW_ORIGIN = "https://era-preview.invalid";

function resolveAssetPath(reference: string, currentPage: string): string | null {
  if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return null;
  try {
    const pagePath = currentPage.replace(/^\/+/, "");
    const resolved = new URL(reference, `${PREVIEW_ORIGIN}/${pagePath}`);
    if (resolved.origin !== PREVIEW_ORIGIN) return null;
    return decodeURIComponent(resolved.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
}

function attributeValue(tag: string, attribute: string): string | null {
  const match = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function escapeRawTextClosingTag(content: string, tag: "script" | "style"): string {
  return content.replace(new RegExp(`<\\/${tag}`, "gi"), `<\\/${tag}`);
}

/** Inline local assets using browser URL resolution relative to the current HTML page. */
export function inlinePreviewAssets(
  html: string,
  files: PreviewAssetFile[],
  currentPage: string,
): string {
  const byPath = new Map(files.map(file => [file.path.replace(/^\/+/, ""), file]));

  let content = html.replace(/<link\b[^>]*>/gi, tag => {
    const href = attributeValue(tag, "href");
    if (!href) return tag;
    const path = resolveAssetPath(href, currentPage);
    const asset = path ? byPath.get(path) : undefined;
    if (!asset || !/\.css$/i.test(asset.path)) return tag;
    return `<style>\n${escapeRawTextClosingTag(asset.content, "style")}\n</style>`;
  });

  content = content.replace(/<script\b[^>]*>\s*<\/script\s*>/gi, tag => {
    const src = attributeValue(tag, "src");
    if (!src) return tag;
    const path = resolveAssetPath(src, currentPage);
    const asset = path ? byPath.get(path) : undefined;
    if (!asset || !/\.js$/i.test(asset.path) || asset.path.includes("node_modules")) return tag;
    const type = attributeValue(tag, "type")?.toLowerCase() === "module"
      ? ' type="module"'
      : "";
    return `<script${type}>\n${escapeRawTextClosingTag(asset.content, "script")}\n</script>`;
  });

  return content;
}
