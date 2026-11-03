/** Resolve project-local HTML links without allowing external origins/schemes. */
export function normalizePreviewPath(href: string, currentPage = "index.html"): string | null {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href.trim())) return null;
  try {
    const url = new URL(href, `https://preview.invalid/${currentPage}`);
    if (url.origin !== "https://preview.invalid") return null;
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    return /\.html$/i.test(path) ? path : null;
  } catch { return null; }
}

export function injectPreviewScript(html: string, script: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, closingHead => `${script}${closingHead}`);
  const bodyOpen = html.match(/<body\b[^>]*>/i)?.[0];
  if (bodyOpen) {
    return html.replace(bodyOpen, `${bodyOpen}${script}`);
  }
  const htmlOpen = html.match(/<html\b[^>]*>/i)?.[0];
  if (htmlOpen) {
    return html.replace(htmlOpen, `${htmlOpen}<head>${script}</head>`);
  }
  if (/<!doctype\b/i.test(html)) return html.replace(/<!doctype[^>]*>/i, doctype => `${doctype}${script}`);
  return script + html;
}
