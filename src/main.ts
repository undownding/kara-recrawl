import { screenshot } from "./browser";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { KarakeepClient, type Bookmark } from "./karakeep";
import {
  imageFileName,
  imageAttachment,
  legacyImageFileName,
  sanitizedChineseImageFileName,
  screenshotFileName,
} from "./naming";
import { buildReaderHtml, buildXiaohongshuReaderHtml } from "./reader";
import { promoteArchiveToReader } from "./promote-reader";
import { fetchWeibo } from "./weibo";
import { captureXiaohongshu, resolveXiaohongshuUrl, xiaohongshuNoteId } from "./xiaohongshu";

const IMAGE_LIMIT = 30 * 1024 * 1024;

interface ReaderArchive {
  assetId: string;
  html: string;
}

function strategy(url: URL): "weibo" | null {
  if (
    ["m.weibo.cn", "weibo.cn"].includes(url.hostname) &&
    /^\/(?:status|detail)\/[A-Za-z0-9]+\/?$/.test(url.pathname)
  ) {
    return "weibo";
  }
  return null;
}

async function resolveWeiboShareUrl(url: URL): Promise<URL> {
  if (url.hostname !== "mapp.api.weibo.cn" || !/^\/fx\/[a-f0-9]+\.html$/i.test(url.pathname)) {
    return url;
  }
  const response = await fetch(url, {
    method: "HEAD",
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const location = response.headers.get("location");
  if (!location || response.status < 300 || response.status >= 400) {
    throw new Error(`Could not resolve Weibo share URL: HTTP ${response.status}`);
  }
  return new URL(location, url);
}

async function downloadImage(
  value: string,
  source: "weibo" | "xiaohongshu" = "weibo",
): Promise<Blob> {
  const url = new URL(value);
  if (url.protocol === "http:") url.protocol = "https:";
  const allowed =
    source === "weibo"
      ? url.hostname === "sinaimg.cn" || url.hostname.endsWith(".sinaimg.cn")
      : ["xhscdn.com", "xiaohongshu.com"].some(
          (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
        );
  if (url.protocol !== "https:" || !allowed)
    throw new Error(`Unexpected ${source} image host: ${url.hostname}`);
  const response = await fetch(url, {
    headers: {
      referer: source === "weibo" ? "https://m.weibo.cn/" : "https://www.xiaohongshu.com/",
      "user-agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status} ${url}`);
  const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "";
  if (!mime.startsWith("image/")) throw new Error(`Unexpected image content type: ${mime}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > IMAGE_LIMIT) throw new Error(`Image exceeds ${IMAGE_LIMIT} bytes: ${url}`);
  const blob = await response.blob();
  if (!blob.size || blob.size > IMAGE_LIMIT) throw new Error(`Invalid image size: ${url}`);
  return new Blob([blob], { type: mime });
}

async function ensureArchiveContent(
  client: KarakeepClient,
  bookmark: Bookmark,
  html: string,
  canonicalUrl: string,
  prefix: "weibo" | "xiaohongshu",
): Promise<ReaderArchive> {
  const outputDir = Bun.env.READER_OUTPUT_DIR;
  const outputPath = outputDir
    ? join(outputDir, `${prefix}-${bookmark.id}-reader.html`)
    : undefined;
  if (outputDir && outputPath) {
    await mkdir(outputDir, { recursive: true });
    await Bun.write(outputPath, html);
  }
  const fileName = `${prefix}-${new URL(canonicalUrl).pathname.split("/").pop()}-reader.html`;
  let imported: Bookmark;
  try {
    imported = await client.importSingleFile(bookmark.content?.url ?? canonicalUrl, html, fileName);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('HTTP 400 {"error":"Unsupported asset type"}')
    ) {
      throw new Error(
        `Karakeep rejected HTML archive upload for ${bookmark.id}` +
          `${outputPath ? `; generated HTML: ${outputPath}` : ""}.`,
        { cause: error },
      );
    }
    throw error;
  }
  if (imported.id !== bookmark.id)
    throw new Error(`SingleFile imported a different bookmark: ${imported.id}`);
  const current = await client.getBookmark(bookmark.id);
  const archive = current.assets?.find(
    (asset) => asset.assetType === "precrawledArchive" && asset.fileName === fileName,
  );
  if (!archive)
    throw new Error(`Karakeep did not attach HTML archive ${fileName} to ${bookmark.id}`);
  return { assetId: archive.id, html };
}

async function writeReaderIfAvailable(
  client: KarakeepClient,
  bookmark: Bookmark,
  archive: ReaderArchive,
  expectedUrl: string,
): Promise<boolean> {
  const dbPath = Bun.env.KARAKEEP_DB_PATH;
  if (!dbPath) return false;
  let dbFile: Awaited<ReturnType<typeof stat>>;
  try {
    dbFile = await stat(dbPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  if (!dbFile.isFile()) throw new Error(`KARAKEEP_DB_PATH is not a file: ${dbPath}`);
  promoteArchiveToReader(dbPath, bookmark.id, archive.assetId, expectedUrl);
  const updated = await client.getBookmark(bookmark.id, true);
  if (
    updated.content?.htmlContent !== archive.html ||
    updated.content.readerViewStatus !== "readable"
  ) {
    throw new Error(`Reader API did not return the generated HTML for ${bookmark.id}`);
  }
  return true;
}

async function processXiaohongshu(
  client: KarakeepClient,
  bookmark: Bookmark,
  url: URL,
): Promise<string> {
  const id = xiaohongshuNoteId(url);
  if (!id) throw new Error(`Unsupported Xiaohongshu note URL: ${url}`);
  const skipScreenshot = Bun.env.SKIP_SCREENSHOT === "1";
  const { capture, screenshot: shot } = await captureXiaohongshu(url, !skipScreenshot);
  if (capture.images.length > 100)
    throw new Error(`Too many Xiaohongshu images: ${capture.images.length}`);
  const images: Blob[] = [];
  for (const image of capture.images) images.push(await downloadImage(image.url, "xiaohongshu"));
  const html = await buildXiaohongshuReaderHtml(capture, images, url.href);
  const archive = await ensureArchiveContent(client, bookmark, html, url.href, "xiaohongshu");
  const current = await client.getBookmark(bookmark.id);
  const assets = current.assets ?? [];
  for (const [index, blob] of images.entries()) {
    const ext =
      blob.type === "image/png"
        ? "png"
        : blob.type === "image/webp"
          ? "webp"
          : blob.type === "image/gif"
            ? "gif"
            : "jpg";
    const fileName = `xiaohongshu-${id}-image-${String(index + 1).padStart(2, "0")}.${ext}`;
    const assetType = index === 0 ? "bannerImage" : "bookmarkAsset";
    if (assets.some((asset) => asset.assetType === assetType && asset.fileName === fileName))
      continue;
    const assetId = await client.upload(blob, fileName);
    if (index === 0) {
      const existingBanner = assets.find(
        (asset) => asset.assetType === "bannerImage" && !asset.fileName,
      );
      if (existingBanner) {
        await client.replaceAsset(bookmark.id, existingBanner.id, assetId);
        existingBanner.id = assetId;
        existingBanner.fileName = fileName;
        continue;
      }
    }
    await client.attachAsset(bookmark.id, assetId, assetType);
    assets.push({ id: assetId, fileName, assetType });
  }
  const screenshotName = `xiaohongshu-${id}-screenshot.png`;
  if (
    shot &&
    !assets.some((asset) => asset.assetType === "screenshot" && asset.fileName === screenshotName)
  ) {
    const assetId = await client.upload(shot, screenshotName);
    const oldShot = assets.find((asset) => asset.assetType === "screenshot" && !asset.fileName);
    if (oldShot) await client.replaceAsset(bookmark.id, oldShot.id, assetId);
    else await client.attachAsset(bookmark.id, assetId, "screenshot");
  }
  await client.updateBookmark(bookmark.id, capture.title, capture.description);
  const readerReady = await writeReaderIfAvailable(
    client,
    bookmark,
    archive,
    bookmark.content?.url ?? url.href,
  );
  if (skipScreenshot)
    return `updated Xiaohongshu without screenshot (Reader ${readerReady ? "ready" : "skipped"})`;
  return readerReady
    ? "updated Xiaohongshu with Reader"
    : "updated Xiaohongshu archive only (Reader skipped)";
}

export async function processBookmark(client: KarakeepClient, bookmark: Bookmark): Promise<string> {
  const initial = bookmark.content ? bookmark : await client.getBookmark(bookmark.id);
  const rawUrl = initial.content?.type === "link" ? initial.content.url : undefined;
  let url: URL | undefined;
  try {
    if (rawUrl) {
      const parsed = new URL(rawUrl);
      url =
        parsed.hostname === "xhslink.cn"
          ? await resolveXiaohongshuUrl(parsed)
          : await resolveWeiboShareUrl(parsed);
    }
  } catch (error) {
    if (rawUrl && /(?:mapp\.api\.weibo\.cn|xhslink\.cn)/.test(rawUrl))
      throw new Error(`Could not resolve share URL: ${rawUrl}`, { cause: error });
    // Invalid URLs cannot match a strategy.
  }
  if (url && xiaohongshuNoteId(url)) return processXiaohongshu(client, initial, url);
  if (!url || strategy(url) !== "weibo") {
    return "skipped";
  }

  const capture = await fetchWeibo(url);
  if (capture.images.length > 100)
    throw new Error(`Too many Weibo images: ${capture.images.length}`);
  const imageBlobs: Blob[] = [];
  for (const image of capture.images) imageBlobs.push(await downloadImage(image.url));
  const html = await buildReaderHtml(capture, imageBlobs, url.href);
  const archive = await ensureArchiveContent(client, initial, html, url.href, "weibo");
  const skipScreenshot = Bun.env.SKIP_SCREENSHOT === "1";
  const shot = skipScreenshot ? null : await screenshot(url.href, capture.title);
  const current = await client.getBookmark(bookmark.id);
  const assets = current.assets ?? [];
  const status = url.pathname.match(/^\/(?:status|detail)\/([A-Za-z0-9]+)/)?.[1];
  if (!status) throw new Error(`Cannot extract status ID from ${url}`);

  let repostIndex = 0;
  let bannerIndex = 0;
  for (const [index, image] of capture.images.entries()) {
    const blob = imageBlobs[index];
    const legacyNames = new Set([
      legacyImageFileName(bookmark.id, image.key, image.url, blob.type),
      sanitizedChineseImageFileName(status, index, blob.type),
      imageFileName(status, index, blob.type),
    ]);
    if (image.role === "original") {
      const target = imageAttachment(
        "original",
        status,
        image.sourceStatusId,
        bannerIndex++,
        blob.type,
      );
      const fileName = target.fileName;
      const oldUserAssets = assets.filter(
        (asset) =>
          asset.assetType === "userUploaded" && !!asset.fileName && legacyNames.has(asset.fileName),
      );
      if (
        !assets.some((asset) => asset.assetType === "bannerImage" && asset.fileName === fileName)
      ) {
        const assetId = await client.upload(blob, fileName);
        const existingBanner = assets.find(
          (asset) => asset.assetType === "bannerImage" && !asset.fileName,
        );
        if (existingBanner) {
          await client.replaceAsset(bookmark.id, existingBanner.id, assetId);
          existingBanner.id = assetId;
          existingBanner.fileName = fileName;
        } else {
          await client.attachAsset(bookmark.id, assetId, target.assetType);
          assets.push({ id: assetId, fileName, assetType: "bannerImage" });
        }
      }
      for (const obsolete of oldUserAssets) await client.detachAsset(bookmark.id, obsolete.id);
      continue;
    }

    const target = imageAttachment(
      "repost",
      status,
      image.sourceStatusId,
      repostIndex++,
      blob.type,
    );
    const fileName = target.fileName;
    const obsolete = assets.filter(
      (asset) =>
        asset.assetType === "userUploaded" &&
        !!asset.fileName &&
        (legacyNames.has(asset.fileName) || asset.fileName === fileName),
    );
    if (
      !assets.some((asset) => asset.assetType === "bookmarkAsset" && asset.fileName === fileName)
    ) {
      const assetId = await client.upload(blob, fileName);
      await client.attachAsset(bookmark.id, assetId, target.assetType);
      assets.push({ id: assetId, fileName, assetType: "bookmarkAsset" });
    }
    for (const duplicate of obsolete) {
      await client.detachAsset(bookmark.id, duplicate.id);
    }
  }

  const screenshotName = screenshotFileName(status);
  if (shot && !assets.some((asset) => asset.fileName === screenshotName)) {
    const assetId = await client.upload(shot, screenshotName);
    const legacy = assets.find(
      (asset) =>
        asset.assetType === "screenshot" &&
        (asset.fileName === `weibo-${bookmark.id}-screenshot.png` ||
          asset.fileName === "screenshot.jpeg"),
    );
    if (legacy) await client.replaceAsset(bookmark.id, legacy.id, assetId);
    else await client.attachAsset(bookmark.id, assetId, "screenshot");
  }

  await client.updateBookmark(bookmark.id, capture.title, capture.description);
  const readerReady = await writeReaderIfAvailable(
    client,
    bookmark,
    archive,
    initial.content?.url ?? url.href,
  );
  if (skipScreenshot)
    return `updated without screenshot (Reader ${readerReady ? "ready" : "skipped"})`;
  return readerReady ? "updated with Reader" : "updated archive only (Reader skipped)";
}
