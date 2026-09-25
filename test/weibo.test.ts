import { expect, test } from "bun:test";
import { collectCapture, htmlToText, statusId } from "../src/weibo";

test("extracts sample status ID", () => {
  expect(statusId(new URL("https://m.weibo.cn/status/5345913905089244"))).toBe("5345913905089244");
});

test("keeps Chinese text, emoji alt text, and line breaks", () => {
  expect(htmlToText('<p>中文<img alt="[笑]" src="x"><br>第二行&nbsp;&amp;</p>')).toBe(
    "中文[笑]\n第二行 &",
  );
});

test("collects every repost level and deduplicates images", () => {
  const capture = collectCapture({
    id: "3",
    text: "<p>转发正文</p>",
    pic_num: 1,
    pics: [{ pid: "c", large: { url: "https://wx1.sinaimg.cn/large/c.jpg" } }],
    retweeted_status: {
      id: "2",
      text_raw: "中间转发",
      pic_num: 1,
      pics: [{ pid: "b", large: { url: "https://wx1.sinaimg.cn/large/b.jpg" } }],
      retweeted_status: {
        id: "1",
        text: "原文",
        pic_num: 2,
        pics: [
          { pid: "a", large: { url: "https://wx1.sinaimg.cn/large/a.jpg" } },
          { pid: "b", large: { url: "https://wx1.sinaimg.cn/large/b.jpg" } },
        ],
      },
    },
  });
  expect(capture.title).toBe("转发正文");
  expect(capture.description).toContain("中间转发");
  expect(capture.description).toContain("原文");
  expect(capture.images.map((image) => image.key)).toEqual(["c", "b", "a"]);
  expect(capture.images.map((image) => image.role)).toEqual(["repost", "original", "original"]);
  expect(capture.images.map((image) => image.sourceStatusId)).toEqual(["3", "1", "1"]);
});

test("rejects an incomplete image list", () => {
  expect(() =>
    collectCapture({
      id: "1",
      text: "正文",
      pic_num: 2,
      pics: [{ url: "https://wx1.sinaimg.cn/a.jpg" }],
    }),
  ).toThrow("provided 1/2 images");
});

test("treats a standalone post's pictures as original banners", () => {
  const capture = collectCapture({
    id: "5345913905089244",
    text: "试试会不会夹",
    pics: [{ pid: "first", large: { url: "https://wx1.sinaimg.cn/large/first.jpg" } }],
  });
  expect(capture.images).toEqual([
    {
      key: "first",
      url: "https://wx1.sinaimg.cn/large/first.jpg",
      sourceStatusId: "5345913905089244",
      role: "original",
    },
  ]);
});
