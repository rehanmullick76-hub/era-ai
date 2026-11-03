export const SITE_ORIGIN = "https://era-ai-69zg.onrender.com";

const INDEXABLE_PATHS = new Set(["/", "/pricing", "/docs", "/database", "/about"]);

function normalizePath(path: string) {
  const pathname = path.split(/[?#]/, 1)[0] || "/";
  return pathname.replace(/\/+$/, "") || "/";
}

function setMeta(attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"]`,
  );

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  element.content = content;
}

function setCanonical(path: string) {
  let element = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );

  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }

  element.href = new URL(normalizePath(path), `${SITE_ORIGIN}/`).toString();
}

export function applyPageSeo({
  path,
  title,
  description,
}: {
  path: string;
  title: string;
  description: string;
}) {
  const normalizedPath = normalizePath(path);
  const canonicalUrl = new URL(normalizedPath, `${SITE_ORIGIN}/`).toString();
  const imageUrl = new URL("/opengraph.jpg", `${SITE_ORIGIN}/`).toString();

  document.title = title;
  setMeta("name", "description", description);
  setMeta("name", "robots", "index, follow");
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:type", "website");
  setMeta("property", "og:site_name", "ERA");
  setMeta("property", "og:locale", "en_US");
  setMeta("property", "og:url", canonicalUrl);
  setMeta("property", "og:image", imageUrl);
  setMeta("name", "twitter:card", "summary_large_image");
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setMeta("name", "twitter:image", imageUrl);
  setCanonical(normalizedPath);
}

export function applyRouteRobotsPolicy(path: string) {
  const normalizedPath = normalizePath(path);
  const isIndexable = INDEXABLE_PATHS.has(normalizedPath);
  setMeta("name", "robots", isIndexable ? "index, follow" : "noindex, nofollow");

  if (!isIndexable) {
    document.head
      .querySelector<HTMLLinkElement>('link[rel="canonical"]')
      ?.remove();
  }
}
