import { stat } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { KarakeepClient } from "./karakeep";

interface LinkRow {
  userId: string;
  type: string;
  url: string;
}

interface AssetRow {
  userId: string;
  bookmarkId: string | null;
  assetType: string;
  contentType: string | null;
  size: number;
}

export function promoteArchiveToReader(
  dbPath: string,
  bookmarkId: string,
  archiveAssetId: string,
  expectedUrl: string,
): void {
  const db = new Database(dbPath, { create: false, readwrite: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("BEGIN IMMEDIATE");
    try {
      const link = db
        .query(
          "SELECT b.userId, b.type, l.url FROM bookmarks b JOIN bookmarkLinks l ON l.id = b.id WHERE b.id = ?",
        )
        .get(bookmarkId) as LinkRow | null;
      if (!link || link.type !== "link" || link.url !== expectedUrl) {
        throw new Error(`Bookmark ${bookmarkId} does not match the expected link URL`);
      }
      const asset = db
        .query("SELECT userId, bookmarkId, assetType, contentType, size FROM assets WHERE id = ?")
        .get(archiveAssetId) as AssetRow | null;
      if (
        !asset ||
        asset.userId !== link.userId ||
        asset.bookmarkId !== bookmarkId ||
        asset.assetType !== "linkPrecrawledArchive" ||
        asset.contentType !== "text/html" ||
        asset.size <= 0
      ) {
        throw new Error(`Asset ${archiveAssetId} is not this bookmark's HTML archive`);
      }
      db.query(
        `UPDATE bookmarkLinks
         SET htmlContent = NULL, contentAssetId = ?, readerViewStatus = 'readable',
             readerViewScore = 100, readerViewReasons = NULL,
             readerViewClassifierVersion = NULL, crawledAt = unixepoch(), crawlStatus = 'success'
         WHERE id = ?`,
      ).run(archiveAssetId, bookmarkId);
      db.query("UPDATE bookmarks SET modifiedAt = unixepoch() WHERE id = ?").run(bookmarkId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const dbPath = Bun.env.KARAKEEP_DB_PATH;
  const bookmarkId = Bun.env.RECAP_BOOKMARK_ID;
  const apiKey = Bun.env.KARAKEEP_API_KEY;
  if (!dbPath || !bookmarkId || !apiKey)
    throw new Error("KARAKEEP_DB_PATH, RECAP_BOOKMARK_ID and KARAKEEP_API_KEY are required");
  if (!(await stat(dbPath)).isFile()) throw new Error(`Not a database file: ${dbPath}`);
  const server = Bun.env.KARAKEEP_URL || "https://cloud.karakeep.app";
  const client = new KarakeepClient(server, apiKey);
  const bookmark = await client.getBookmark(bookmarkId);
  if (bookmark.content?.type !== "link" || !bookmark.content.url)
    throw new Error(`Bookmark ${bookmarkId} is not a link`);
  const archive = bookmark.assets?.find(
    (asset) =>
      asset.assetType === "precrawledArchive" &&
      /^weibo-[A-Za-z0-9]+-reader\.html$/.test(asset.fileName ?? ""),
  );
  if (!archive) throw new Error(`No generated Weibo HTML archive on ${bookmarkId}`);
  const response = await fetch(
    new URL(`/api/v1/assets/${encodeURIComponent(archive.id)}`, server),
    { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(60_000) },
  );
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "text/html")
    throw new Error(`Could not read HTML archive ${archive.id}: HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes("<article>") || !html.includes("<section>"))
    throw new Error(`Archive ${archive.id} is not a generated reader page`);
  promoteArchiveToReader(dbPath, bookmarkId, archive.id, bookmark.content.url);
  const updated = await client.getBookmark(bookmarkId, true);
  if (updated.content?.htmlContent !== html || updated.content.readerViewStatus !== "readable")
    throw new Error(
      `Database updated, but Reader API has not returned the archive for ${bookmarkId}`,
    );
  console.log(
    `Reader ready: ${bookmarkId}, ${html.match(/<img\b/gi)?.length ?? 0} embedded images`,
  );
}

if (import.meta.main) await main();
