import { expect, test } from "bun:test";
import type { Bookmark, KarakeepClient } from "../src/karakeep";
import { processBookmark } from "../src/main";

test("saves all media from the three video share links and skips existing attachments", async () => {
  const previousFetch = globalThis.fetch;
  const previousScreenshot = Bun.env.SKIP_SCREENSHOT;
  const previousDbPath = Bun.env.KARAKEEP_DB_PATH;
  Bun.env.SKIP_SCREENSHOT = "1";
  delete Bun.env.KARAKEEP_DB_PATH;

  const cases = [
    {
      share: "https://mapp.api.weibo.cn/fx/610c030b54cfef7644e6d8f520a2ebb9.html",
      target: "https://m.weibo.cn/status/5341581767872275",
      images: 2,
      videos: 1,
    },
    {
      share: "https://mapp.api.weibo.cn/fx/a03627b1b6d2b1782bbeacb4eeeacbcf.html",
      target: "https://m.weibo.cn/status/5307996318208625",
      images: 0,
      videos: 1,
    },
    {
      share: "https://xhslink.cn/o/1907fG3p5ca",
      target: "https://www.xiaohongshu.com/discovery/item/677b7760000000000403ede8?type=video",
      images: 1,
      videos: 1,
    },
  ];
  const xhsNote = {
    noteData: {
      data: {
        noteData: {
          noteId: "677b7760000000000403ede8",
          type: "video",
          title: "录像",
          imageList: [{ infoList: [{ url: "https://sns-webpic-qc.xhscdn.com/cover.jpg" }] }],
          video: {
            media: {
              stream: { h264: [{ masterUrl: "https://sns-video-v6.xhscdn.com/movie.mp4" }] },
            },
          },
        },
      },
    },
  };
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const sample = cases.find((item) => item.share === url);
    if (sample) return new Response(null, { status: 302, headers: { location: sample.target } });
    if (url.includes("/statuses/show?id=")) {
      const id = new URL(url).searchParams.get("id")!;
      const mixed = id === "5341581767872275";
      return Response.json({
        ok: 1,
        data: {
          id,
          text: "微博视频",
          pic_num: mixed ? 2 : 0,
          pics: mixed
            ? [
                { pid: "photo", large: { url: "https://wx1.sinaimg.cn/photo.jpg" } },
                {
                  pid: "cover",
                  type: "video",
                  large: { url: "https://wx1.sinaimg.cn/cover.jpg" },
                  videoSrc: "https://f.video.weibocdn.com/movie.mp4",
                },
              ]
            : [],
          page_info: {
            type: "video",
            urls: { mp4_720p_mp4: "https://f.video.weibocdn.com/movie.mp4" },
          },
        },
      });
    }
    if (url === cases[2].target) {
      const response = new Response(
        `<script>window.__INITIAL_STATE__ = ${JSON.stringify(xhsNote)};</script>`,
        { headers: { "content-type": "text/html" } },
      );
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    if (url.endsWith(".jpg"))
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    if (url.endsWith(".mp4"))
      return new Response(new Uint8Array([0, 1, 2, 3]), {
        headers: { "content-type": "video/mp4" },
      });
    throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
  }) as typeof fetch;

  try {
    for (const [caseIndex, sample] of cases.entries()) {
      const bookmark: Bookmark = {
        id: `video-${caseIndex}`,
        content: { type: "link", url: sample.share },
      };
      const assets: NonNullable<Bookmark["assets"]> = [];
      const uploaded = new Map<string, { fileName: string; type: string }>();
      let archive = "";
      const client = {
        async importSingleFile(_url: string, html: string, fileName: string) {
          archive = html;
          if (!assets.some((asset) => asset.fileName === fileName))
            assets.push({ id: "archive", fileName, assetType: "precrawledArchive" });
          return bookmark;
        },
        async getBookmark() {
          return { ...bookmark, assets: assets.map((asset) => ({ ...asset })) };
        },
        async upload(blob: Blob, fileName: string) {
          const id = `asset-${uploaded.size + 1}`;
          uploaded.set(id, { fileName, type: blob.type });
          return id;
        },
        async attachAsset(_bookmarkId: string, id: string, assetType: string) {
          assets.push({ id, fileName: uploaded.get(id)?.fileName, assetType });
        },
        async updateBookmark() {
          return bookmark;
        },
      } as unknown as KarakeepClient;
      await processBookmark(client, bookmark);
      expect(assets.filter((asset) => asset.assetType === "bannerImage")).toHaveLength(
        sample.images,
      );
      expect(assets.filter((asset) => asset.assetType === "userUploaded")).toHaveLength(
        sample.videos,
      );
      expect([...uploaded.values()].filter((asset) => asset.type === "video/mp4")).toHaveLength(
        sample.videos,
      );
      expect(archive).toContain("<video controls");
      const count = uploaded.size;
      await processBookmark(client, bookmark);
      expect(uploaded.size).toBe(count);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousScreenshot === undefined) delete Bun.env.SKIP_SCREENSHOT;
    else Bun.env.SKIP_SCREENSHOT = previousScreenshot;
    if (previousDbPath === undefined) delete Bun.env.KARAKEEP_DB_PATH;
    else Bun.env.KARAKEEP_DB_PATH = previousDbPath;
  }
});
