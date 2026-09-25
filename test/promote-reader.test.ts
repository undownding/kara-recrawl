import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promoteArchiveToReader } from "../src/promote-reader";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test("promotes only the matching HTML archive to Reader content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kara-recap-reader-"));
  dirs.push(dir);
  const path = join(dir, "db.db");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE bookmarks (id TEXT PRIMARY KEY, userId TEXT, type TEXT, modifiedAt INTEGER);
    CREATE TABLE bookmarkLinks (
      id TEXT PRIMARY KEY, url TEXT, htmlContent TEXT, contentAssetId TEXT,
      readerViewStatus TEXT, readerViewScore INTEGER, readerViewReasons TEXT,
      readerViewClassifierVersion INTEGER, crawledAt INTEGER, crawlStatus TEXT
    );
    CREATE TABLE assets (
      id TEXT PRIMARY KEY, userId TEXT, bookmarkId TEXT, assetType TEXT,
      contentType TEXT, size INTEGER
    );
    INSERT INTO bookmarks (id, userId, type) VALUES ('b1', 'u1', 'link');
    INSERT INTO bookmarkLinks (id, url, htmlContent) VALUES ('b1', 'https://m.weibo.cn/status/1', 'old');
    INSERT INTO assets (id, userId, bookmarkId, assetType, contentType, size)
      VALUES ('a1', 'u1', 'b1', 'precrawledArchive', 'text/html', 100);
    INSERT INTO assets (id, userId, bookmarkId, assetType, contentType, size)
      VALUES ('other', 'u2', 'b1', 'precrawledArchive', 'text/html', 100);
  `);
  expect(() => promoteArchiveToReader(path, "b1", "other", "https://m.weibo.cn/status/1")).toThrow(
    "not this bookmark's HTML archive",
  );
  expect(
    (
      db.query("SELECT htmlContent FROM bookmarkLinks WHERE id = 'b1'").get() as {
        htmlContent: string;
      }
    ).htmlContent,
  ).toBe("old");
  promoteArchiveToReader(path, "b1", "a1", "https://m.weibo.cn/status/1");
  expect(
    db
      .query(
        "SELECT contentAssetId, htmlContent, readerViewStatus FROM bookmarkLinks WHERE id = 'b1'",
      )
      .get(),
  ).toEqual({
    contentAssetId: "a1",
    htmlContent: null,
    readerViewStatus: "readable",
  });
  db.close();
});
