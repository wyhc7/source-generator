// 在 Node 中用最小 mock DOM 测试真实文件 selector-generator.js 的 extractRule
const fs = require("fs");
const path = require("path");

// ---- 最小 DOM mock ----
function makeEl(opts) {
  return {
    textContent: opts.textContent || "",
    getAttribute: (n) => (opts.attr && opts.attr[n] != null ? opts.attr[n] : ""),
    querySelector: (sel) => (opts.children && opts.children[sel]) || null,
    querySelectorAll: () => [],
  };
}
const items = [
  makeEl({
    children: {
      "a.book-link": makeEl({ textContent: "书名一", attr: { href: "/book/1" } }),
      ".author": makeEl({ textContent: "作者A" }),
      ".cover": makeEl({ attr: { src: "cover1.jpg" } }),
    },
  }),
  makeEl({
    children: {
      "a.book-link": makeEl({ textContent: "书名二", attr: { href: "/book/2" } }),
      ".author": makeEl({ textContent: "作者B" }),
      ".cover": makeEl({ attr: { src: "cover2.jpg" } }),
    },
  }),
  makeEl({
    children: {
      "a.book-link": makeEl({ textContent: "书名三", attr: { href: "/book/3" } }),
      ".author": makeEl({ textContent: "作者C" }),
      ".cover": makeEl({ attr: { src: "cover3.jpg" } }),
    },
  }),
];

global.window = {};
global.location = { href: "https://example.com/list" };
global.document = {
  querySelectorAll: (sel) => (sel === "ul.book-list > li.book-item" ? items : []),
  querySelector: () => null,
  body: makeEl({}),
};

// 载入真实文件（其 IIFE 会把 LSG 挂到 global.window 上）
const src = fs.readFileSync(
  path.join(__dirname, "lib", "selector-generator.js"),
  "utf8"
);
eval(src);
const LSG = global.window.LSG;

// ---- 断言 ----
let pass = 0,
  fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", msg);
  }
}

const rule = {
  bookList: "ul.book-list > li.book-item",
  title: "a.book-link",
  author: ".author",
  coverUrl: ".cover",
  bookUrl: "a.book-link",
};
const res = LSG.extractRule(rule);
ok(res.length === 3, "应抽取到 3 条，实际 " + res.length);
ok(res[0].title === "书名一", "第一条书名");
ok(res[2].author === "作者C", "第三条作者");
ok(res[0].coverUrl === "https://example.com/cover1.jpg", "封面绝对化: " + res[0].coverUrl);
ok(res[1].link === "https://example.com/book/2", "链接绝对化: " + res[1].link);

// 空列表
const empty = LSG.extractRule({ bookList: "x.y" });
ok(empty.length === 0, "无匹配时返回空数组");

console.log("\nRESULT pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
