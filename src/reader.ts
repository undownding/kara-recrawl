import type { WeiboCapture } from "./weibo";
import type { XiaohongshuCapture } from "./xiaohongshu";

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

export async function buildXiaohongshuReaderHtml(
  capture: XiaohongshuCapture,
  images: Blob[],
  canonicalUrl: string,
  videos: Blob[] = [],
): Promise<string> {
  if (images.length !== capture.images.length) throw new Error("Reader image count mismatch");
  if (videos.length !== capture.videos.length) throw new Error("Reader video count mismatch");
  const paragraphs = capture.description
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
  const figures: string[] = [];
  for (const [index, blob] of images.entries()) {
    if (!blob.type.startsWith("image/"))
      throw new Error(`Reader image ${index + 1} is not an image`);
    const bytes = Buffer.from(await blob.arrayBuffer());
    figures.push(
      `<figure><img src="data:${escapeHtml(blob.type)};base64,${bytes.toString("base64")}" alt="笔记配图 ${index + 1}" loading="lazy"></figure>`,
    );
  }
  for (const [index, blob] of videos.entries()) {
    if (blob.type !== "video/mp4") throw new Error(`Reader video ${index + 1} is not MP4`);
    const bytes = Buffer.from(await blob.arrayBuffer());
    figures.push(
      `<figure><video controls preload="metadata" playsinline src="data:video/mp4;base64,${bytes.toString("base64")}"></video></figure>`,
    );
  }
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(capture.title)}</title><link rel="canonical" href="${escapeHtml(canonicalUrl)}">
<style>.kara-recap-reader{max-width:46rem;margin:2rem auto;padding:0 1rem;font:1.1rem/1.8 system-ui,sans-serif}.kara-recap-reader article{overflow-wrap:anywhere}.kara-recap-reader figure{margin:1.5rem 0}.kara-recap-reader img,.kara-recap-reader video{display:block;max-width:100%;height:auto;border-radius:.5rem}.kara-recap-reader p{margin:.8rem 0}</style>
</head><body><main class="kara-recap-reader"><article><h1>${escapeHtml(capture.title)}</h1>${paragraphs}${figures.join("\n")}</article></main></body></html>`;
}

export async function buildReaderHtml(
  capture: WeiboCapture,
  images: Blob[],
  canonicalUrl: string,
  videos: Blob[] = [],
): Promise<string> {
  if (images.length !== capture.images.length) throw new Error("Reader image count mismatch");
  if (videos.length !== capture.videos.length) throw new Error("Reader video count mismatch");
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
  for (const [index, video] of capture.videos.entries()) {
    const blob = videos[index];
    if (blob.type !== "video/mp4") throw new Error(`Reader video ${index + 1} is not MP4`);
    const bytes = Buffer.from(await blob.arrayBuffer());
    const group = byPost.get(video.sourceStatusId) ?? [];
    group.push(
      `<figure><video controls preload="metadata" playsinline src="data:video/mp4;base64,${bytes.toString("base64")}"></video></figure>`,
    );
    byPost.set(video.sourceStatusId, group);
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
<style>.kara-recap-reader{max-width:46rem;margin:2rem auto;padding:0 1rem;font:1.1rem/1.8 system-ui,sans-serif}.kara-recap-reader article{overflow-wrap:anywhere}.kara-recap-reader section{margin:2rem 0;padding-top:1rem;border-top:1px solid #ddd}.kara-recap-reader figure{margin:1.5rem 0}.kara-recap-reader img,.kara-recap-reader video{display:block;max-width:100%;height:auto;border-radius:.5rem}.kara-recap-reader p{margin:.8rem 0}</style>
</head>
<body><main class="kara-recap-reader"><article><header><h1>微博正文</h1></header>${sections}</article></main></body>
</html>`;
}
