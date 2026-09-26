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

test("keeps pictures and video from a mixed Weibo post", () => {
  const capture = collectCapture({
    id: "5341581767872275",
    text: "图文视频混排",
    pic_num: 2,
    pics: [
      { pid: "photo", large: { url: "https://wx1.sinaimg.cn/photo.jpg" } },
      {
        pid: "cover",
        type: "video",
        large: { url: "https://wx1.sinaimg.cn/cover.jpg" },
        videoSrc: "https://f.video.weibocdn.com/a.mp4",
      },
    ],
    page_info: {
      type: "video",
      media_info: { stream_url: "https://f.video.weibocdn.com/duplicate.mp4" },
    },
  });
  expect(capture.images.map((image) => image.key)).toEqual(["photo", "cover"]);
  expect(capture.videos.map((video) => video.url)).toEqual(["https://f.video.weibocdn.com/a.mp4"]);
});

test("uses page video for a Weibo post without pictures", () => {
  const capture = collectCapture({
    id: "5307996318208625",
    text: "纯视频",
    page_info: {
      type: "video",
      object_id: "1034:1",
      urls: { mp4_720p_mp4: "https://f.video.weibocdn.com/b.mp4" },
    },
  });
  expect(capture.images).toHaveLength(0);
  expect(capture.videos).toEqual([
    {
      key: "1034:1",
      url: "https://f.video.weibocdn.com/b.mp4",
      sourceStatusId: "5307996318208625",
      role: "original",
    },
  ]);
});

test("rejects a mixed Weibo post with an unavailable video", () => {
  expect(() =>
    collectCapture({
      id: "1",
      text: "混排",
      pics: [
        { pid: "photo", url: "https://wx1.sinaimg.cn/photo.jpg" },
        { pid: "video", type: "video", url: "https://wx1.sinaimg.cn/cover.jpg" },
      ],
    }),
  ).toThrow("missing video 1");
});
