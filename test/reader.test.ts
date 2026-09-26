import { expect, test } from "bun:test";
import { buildReaderHtml } from "../src/reader";

test("renders readable repost sections with embedded original pictures", async () => {
  const html = await buildReaderHtml(
    {
      title: "转发 <正文>",
      description: "转发 <正文>\n\n原文",
      posts: [
        { id: "2", text: "转发 <正文>", role: "repost" },
        { id: "1", text: "原文", role: "original" },
      ],
      images: [
        { key: "p", url: "https://wx1.sinaimg.cn/p.jpg", sourceStatusId: "1", role: "original" },
      ],
      videos: [],
    },
    [new Blob([Uint8Array.from([1, 2, 3])], { type: "image/jpeg" })],
    "https://m.weibo.cn/status/2",
  );
  expect(html).toContain("<h2>转发微博</h2>");
  expect(html).toContain("<h2>原微博</h2>");
  expect(html).toContain("转发 &lt;正文&gt;");
  expect(html).toContain('src="data:image/jpeg;base64,AQID"');
  expect(html).toContain('<main class="kara-recap-reader">');
  const styles = html.match(/<style>(.*?)<\/style>/s)?.[1];
  expect(styles).toBeDefined();
  const selectors = [...styles!.matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim());
  expect(selectors.length).toBeGreaterThan(0);
  expect(selectors.every((selector) => selector.startsWith(".kara-recap-reader"))).toBe(true);
});

test("embeds a playable MP4 in the Weibo reader", async () => {
  const html = await buildReaderHtml(
    {
      title: "视频",
      description: "视频",
      posts: [{ id: "1", text: "视频", role: "original" }],
      images: [],
      videos: [
        {
          key: "video",
          url: "https://f.video.weibocdn.com/a.mp4",
          sourceStatusId: "1",
          role: "original",
        },
      ],
    },
    [],
    "https://m.weibo.cn/status/1",
    [new Blob([Uint8Array.from([0, 1, 2])], { type: "video/mp4" })],
  );
  expect(html).toContain(
    '<video controls preload="metadata" playsinline src="data:video/mp4;base64,AAEC"',
  );
});
