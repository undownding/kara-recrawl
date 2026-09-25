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
    },
    [new Blob([Uint8Array.from([1, 2, 3])], { type: "image/jpeg" })],
    "https://m.weibo.cn/status/2",
  );
  expect(html).toContain("<h2>转发微博</h2>");
  expect(html).toContain("<h2>原微博</h2>");
  expect(html).toContain("转发 &lt;正文&gt;");
  expect(html).toContain('src="data:image/jpeg;base64,AQID"');
});
