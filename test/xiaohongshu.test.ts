import { expect, test } from "bun:test";
import { buildXiaohongshuReaderHtml } from "../src/reader";
import { parseXiaohongshuNote, resolveXiaohongshuUrl, xiaohongshuNoteId } from "../src/xiaohongshu";

const id = "6ab295510000000014001307";

test("recognizes note URLs and resolves the sample short link with GET", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    return new Response(null, {
      status: 302,
      headers: { location: `https://www.xiaohongshu.com/discovery/item/${id}?xsec_token=test` },
    });
  }) as typeof fetch;
  try {
    const url = await resolveXiaohongshuUrl(new URL("https://xhslink.cn/o/5WW1SnjhmYF"));
    expect(xiaohongshuNoteId(url)).toBe(id);
    expect(url.searchParams.get("xsec_token")).toBe("test");
    expect(xiaohongshuNoteId(new URL(`https://www.xiaohongshu.com/explore/${id}`))).toBe(id);
  } finally {
    globalThis.fetch = original;
  }
});

test("collects only note text and every carousel image", async () => {
  const capture = parseXiaohongshuNote(
    {
      noteId: id,
      type: "normal",
      title: "标题 <测试>",
      desc: "第一行\n第二行",
      imageList: [
        { urlDefault: "https://ci.xiaohongshu.com/one" },
        { infoList: [{ url: "https://sns-webpic-qc.xhscdn.com/two" }] },
      ],
      comments: [{ content: "不应抓取" }],
    },
    id,
  );
  expect(capture.images.map((image) => image.url)).toEqual([
    "https://ci.xiaohongshu.com/one",
    "https://sns-webpic-qc.xhscdn.com/two",
  ]);
  const html = await buildXiaohongshuReaderHtml(
    capture,
    [
      new Blob([Uint8Array.from([1])], { type: "image/jpeg" }),
      new Blob([Uint8Array.from([2])], { type: "image/jpeg" }),
    ],
    `https://www.xiaohongshu.com/explore/${id}`,
  );
  expect(html).toContain("标题 &lt;测试&gt;");
  expect(html).toContain("第一行");
  expect(html).toContain("笔记配图 2");
  expect(html).not.toContain("不应抓取");
});

test("rejects video and incomplete image posts", () => {
  expect(() =>
    parseXiaohongshuNote(
      { type: "video", title: "视频", imageList: [{ urlDefault: "https://ci.xiaohongshu.com/a" }] },
      id,
    ),
  ).toThrow("not an image post");
  expect(() =>
    parseXiaohongshuNote({ type: "normal", title: "图文", imageList: [{}] }, id),
  ).toThrow("missing image 1");
});
