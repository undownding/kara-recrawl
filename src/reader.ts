import type { WeiboCapture } from "./weibo";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export async function buildReaderHtml(
  capture: WeiboCapture,
  images: Blob[],
  canonicalUrl: string,
): Promise<string> {
  if (images.length !== capture.images.length) throw new Error("Reader image count mismatch");
  const byPost = new Map<string, string[]>();
  for (const [index, image] of capture.images.entries()) {
    const bytes = Buffer.from(await images[index].arrayBuffer());
    const mime = images[index].type;
    if (!mime.startsWith("image/")) throw new Error(`Reader image ${index + 1} is not an image`);
    const item = `<figure><img src="data:${escapeHtml(mime)};base64,${bytes.toString("base64")}" alt="${image.role === "original" ? "原微博" : "转发微博"}配图 ${index + 1}" loading="lazy"></figure>`;
    const group = byPost.get(image.sourceStatusId) ?? [];
    group.push(item);
    byPost.set(image.sourceStatusId, group);
  }
  const sections = capture.posts
    .map((post) => {
      const heading = post.role === "original" ? "原微博" : "转发微博";
      const paragraphs = post.text
        .split(/\n+/)
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("\n");
      return `<section><h2>${heading}</h2>${paragraphs}${(byPost.get(post.id) ?? []).join("\n")}</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(capture.title)}</title>
<meta name="description" content="${escapeHtml(capture.title)}">
<link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<style>.kara-recap-reader{max-width:46rem;margin:2rem auto;padding:0 1rem;font:1.1rem/1.8 system-ui,sans-serif;color:#202124}.kara-recap-reader article{overflow-wrap:anywhere}.kara-recap-reader section{margin:2rem 0;padding-top:1rem;border-top:1px solid #ddd}.kara-recap-reader figure{margin:1.5rem 0}.kara-recap-reader img{display:block;max-width:100%;height:auto;border-radius:.5rem}.kara-recap-reader p{margin:.8rem 0}</style>
</head>
<body><main class="kara-recap-reader"><article><header><h1>微博正文</h1></header>${sections}</article></main></body>
</html>`;
}
