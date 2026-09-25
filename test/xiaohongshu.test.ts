import { expect, test } from "bun:test";
import { buildXiaohongshuReaderHtml } from "../src/reader";
import {
  NOTE_EXPRESSION,
  fetchPublicXiaohongshu,
  parsePublicXiaohongshuHtml,
  parseXiaohongshuNote,
  resolveXiaohongshuUrl,
  xiaohongshuAccessError,
  xiaohongshuNoteId,
} from "../src/xiaohongshu";

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
        { infoList: [{ url: "http://sns-webpic-qc.xhscdn.com/two" }] },
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

test("reads a note through Vue state wrappers", () => {
  const window = {
    __INITIAL_STATE__: {
      note: {
        _rawValue: {
          noteDetailMap: {
            _value: {
              [id]: {
                note: {
                  _rawValue: {
                    noteId: id,
                    type: "normal",
                    title: "图文",
                    desc: "正文",
                    imageList: { _value: [{ urlDefault: "https://ci.xiaohongshu.com/one" }] },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const raw = Function(
    "window",
    `return ${NOTE_EXPRESSION.replace("__NOTE_ID__", JSON.stringify(id))}`,
  )(window) as string;
  expect(parseXiaohongshuNote(JSON.parse(raw), id).images).toHaveLength(1);
});

test("identifies Xiaohongshu's IP risk page immediately", () => {
  expect(
    xiaohongshuAccessError(
      "https://www.xiaohongshu.com/website-login/error?error_code=300012&error_msg=IP%20at%20risk.",
      "安全限制",
      "IP at risk.",
    ),
  ).toContain("Check the container's outbound network/IP");
  expect(
    xiaohongshuAccessError(`https://www.xiaohongshu.com/explore/${id}`, "笔记", "正文"),
  ).toBeNull();
});

test("public HTML extracts the exact note and full ordered image list", () => {
  const state = {
    note: {
      noteDetailMap: {
        [id]: {
          note: {
            noteId: id,
            type: "normal",
            title: "公开图文",
            desc: "含有 } 的正文",
            imageList: [
              { urlDefault: "https://ci.xiaohongshu.com/first" },
              { urlDefault: "https://ci.xiaohongshu.com/second" },
            ],
          },
        },
        other: {
          note: {
            title: "推荐笔记",
            imageList: [{ urlDefault: "https://ci.xiaohongshu.com/wrong" }],
          },
        },
      },
    },
  };
  const html = `<html><script>window.__INITIAL_STATE__ = ${JSON.stringify(state)};</script></html>`;
  expect(parsePublicXiaohongshuHtml(html, id)?.images.map((image) => image.url)).toEqual([
    "https://ci.xiaohongshu.com/first",
    "https://ci.xiaohongshu.com/second",
  ]);
  expect(parsePublicXiaohongshuHtml("<title>安全限制</title>", id)).toBeNull();
  expect(
    parsePublicXiaohongshuHtml(`<script>window.__INITIAL_STATE__ = {"note":{}};</script>`, id),
  ).toBeNull();
});

test("public fetch rejects a redirected login page", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input, _init) => {
    const response = new Response("<title>登录</title>", {
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(response, "url", { value: "https://www.xiaohongshu.com/login" });
    return response;
  }) as typeof fetch;
  try {
    expect(
      await fetchPublicXiaohongshu(new URL(`https://www.xiaohongshu.com/explore/${id}`)),
    ).toBeNull();
  } finally {
    globalThis.fetch = original;
  }
});
