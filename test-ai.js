// 在 Node 中用最小 mock DOM 测试真实文件 lib/ai-detect.js 的 analyzePage，以及 lib/ai-llm.js 的解析。
const fs = require("fs");
const path = require("path");

// ---------------- 最小 DOM mock ----------------
function parseCompound(c) {
  let tag = "";
  let id = "";
  const classes = [];
  let i = 0;
  while (i < c.length && /[\w*-]/.test(c[i])) {
    tag += c[i];
    i++;
  }
  while (i < c.length) {
    if (c[i] === "#") {
      i++;
      let x = "";
      while (i < c.length && /[\w-]/.test(c[i])) {
        x += c[i];
        i++;
      }
      id = x;
    } else if (c[i] === ".") {
      i++;
      let x = "";
      while (i < c.length && /[\w-]/.test(c[i])) {
        x += c[i];
        i++;
      }
      classes.push(x);
    } else break;
  }
  if (tag === "*") tag = "";
  return { tag, id, classes };
}

function matchesCompound(e, c) {
  const p = parseCompound(c);
  if (p.tag && e.tagName && e.tagName.toLowerCase() !== p.tag.toLowerCase()) return false;
  if (p.id && e.id !== p.id) return false;
  for (const cl of p.classes) {
    if (!e.classList || !e.classList.contains(cl)) return false;
  }
  return true;
}

function descendants(node) {
  const out = [];
  (node.children || []).forEach((ch) => {
    out.push(ch);
    out.push.apply(out, descendants(ch));
  });
  return out;
}

function selectAll(root, sel) {
  const parts = sel.trim().split(/\s+/);
  let pool = descendants(root);
  for (let pi = 0; pi < parts.length; pi++) {
    const matched = pool.filter((e) => matchesCompound(e, parts[pi]));
    if (pi === parts.length - 1) return matched;
    const next = [];
    matched.forEach((m) => next.push.apply(next, descendants(m)));
    pool = next;
  }
  return pool;
}

function mk(tag, opts) {
  opts = opts || {};
  const classes = (opts.class ? opts.class.split(/\s+/) : []).filter(Boolean);
  const classList = classes.slice();
  classList.contains = function (c) {
    return this.indexOf(c) >= 0;
  };
  const el = {
    tagName: tag.toUpperCase(),
    id: opts.id || "",
    style: opts.style || {},
    attributes: opts.attr || {},
    children: [],
    parentElement: null,
    _text: typeof opts.text === "string" ? opts.text : null,
    classList: classList,
  };
  Object.defineProperty(el, "textContent", {
    get() {
      if (el._text != null) return el._text;
      return (el.children || []).map((c) => c.textContent).join("");
    },
  });
  el.getAttribute = (n) => (el.attributes[n] != null ? el.attributes[n] : "");
  el.querySelectorAll = (s) => selectAll(el, s);
  el.querySelector = (s) => selectAll(el, s)[0] || null;
  (opts.children || []).forEach((ch) => {
    ch.parentElement = el;
    el.children.push(ch);
  });
  return el;
}

// ---------------- 构造测试文档 ----------------
// 结构 1：ul.book-list > li.book-item*3（常见书籍列表）
function buildLiDoc() {
  const items = [];
  for (let i = 1; i <= 3; i++) {
    items.push(
      mk("li", {
        class: "book-item",
        children: [
          mk("a", { class: "cover", attr: { href: "/cover/" + i }, children: [mk("img", { attr: { src: "c" + i + ".jpg" } })] }),
          mk("a", { class: "book-name", attr: { href: "/book/" + i }, text: "书名" + i }),
          mk("span", { class: "author", text: "作者" + String.fromCharCode(64 + i) }),
          mk("p", { class: "intro", text: "这是第" + i + "本书的简介，讲述了很长很长的故事内容用于测试简介字段的识别是否准确。" }),
        ],
      })
    );
  }
  const ul = mk("ul", { class: "book-list", children: items });
  const body = mk("body", { children: [ul] });
  const html = mk("html", { children: [body] });
  const root = mk("__root", { children: [html] });
  return {
    querySelectorAll: (s) => selectAll(root, s),
    querySelector: (s) => selectAll(root, s)[0] || null,
    body,
  };
}

// 结构 2：div.grid > a.book*3（整张卡片即 <a>，含 img + 文本）
function buildGridDoc() {
  const items = [];
  for (let i = 1; i <= 3; i++) {
    items.push(
      mk("a", {
        class: "book",
        attr: { href: "/book/" + i },
        children: [mk("img", { attr: { src: "c" + i + ".jpg" } })],
        text: "书名" + i,
      })
    );
  }
  const grid = mk("div", { class: "grid", children: items });
  const body = mk("body", { children: [grid] });
  const html = mk("html", { children: [body] });
  const root = mk("__root", { children: [html] });
  return {
    querySelectorAll: (s) => selectAll(root, s),
    querySelector: (s) => selectAll(root, s)[0] || null,
    body,
  };
}

// ---------------- 载入真实文件 ----------------
global.window = {};
global.location = { href: "https://example.com/list" };
const load = (rel) => {
  const src = fs.readFileSync(path.join(__dirname, rel), "utf8");
  eval(src);
};
load("lib/ai-detect.js");
load("lib/ai-llm.js");
const AI = global.window.LSG_AI;
const LLM = global.window.LSG_LLM;

// ---------------- 断言 ----------------
let pass = 0,
  fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", msg);
  }
}

// ---- 结构 1：li 列表 ----
const r1 = AI.analyzePage(buildLiDoc());
ok(r1.itemSelector === "li.book-item", "结构1 itemSelector=li.book-item，实际: " + r1.itemSelector);
ok(r1.candidateCount === 3, "结构1 命中 3 项，实际: " + r1.candidateCount);
ok(r1.fields.title && r1.fields.title.sel === ".book-name", "结构1 title=.book-name，实际: " + (r1.fields.title && r1.fields.title.sel));
ok(r1.fields.author && r1.fields.author.sel === ".author", "结构1 author=.author，实际: " + (r1.fields.author && r1.fields.author.sel));
ok(r1.fields.coverUrl && r1.fields.coverUrl.sel === "img", "结构1 coverUrl=img，实际: " + (r1.fields.coverUrl && r1.fields.coverUrl.sel));
ok(r1.fields.bookUrl && r1.fields.bookUrl.sel === ".book-name", "结构1 bookUrl=.book-name，实际: " + (r1.fields.bookUrl && r1.fields.bookUrl.sel));
ok(r1.fields.intro && r1.fields.intro.sel === ".intro", "结构1 intro=.intro，实际: " + (r1.fields.intro && r1.fields.intro.sel));
ok(r1.confidence === 1, "结构1 置信度=1，实际: " + r1.confidence);
ok(r1.sample && r1.sample.title === "书名1", "结构1 样本书名，实际: " + (r1.sample && r1.sample.title));

// ---- 结构 2：a 网格（整卡即 <a>） ----
const r2 = AI.analyzePage(buildGridDoc());
ok(r2.itemSelector === "a.book", "结构2 itemSelector=a.book，实际: " + r2.itemSelector);
ok(r2.candidateCount === 3, "结构2 命中 3 项，实际: " + r2.candidateCount);
ok(r2.fields.coverUrl && r2.fields.coverUrl.sel === "img", "结构2 coverUrl=img，实际: " + (r2.fields.coverUrl && r2.fields.coverUrl.sel));
ok(r2.fields.title && r2.fields.title.sel === "@item", "结构2 title=@item，实际: " + (r2.fields.title && r2.fields.title.sel));
ok(r2.fields.bookUrl && r2.fields.bookUrl.sel === "@item", "结构2 bookUrl=@item，实际: " + (r2.fields.bookUrl && r2.fields.bookUrl.sel));
ok(r2.confidence >= 0.85, "结构2 置信度>=0.85，实际: " + r2.confidence);

// ---- 空页（无卡片） ----
const emptyDoc = {
  querySelectorAll: () => [],
  querySelector: () => null,
  body: mk("body", {}),
};
const r3 = AI.analyzePage(emptyDoc);
ok(r3.candidateCount === 0 && r3.confidence === 0, "空页返回 0 项 / 置信度 0");

// ---- LLM 解析：裸 JSON ----
const p1 = LLM.parseModelResponse(
  '{"ruleExplore":{"bookList":"li.book-item","bookUrl":"a","title":"a.book-name","author":".author","coverUrl":"img","intro":".intro"},"exploreUrl":"热门::https://x.com/hot?page=$$"}'
);
ok(p1.ok === true, "LLM 裸JSON解析 ok");
ok(p1.rules.explore && p1.rules.explore.bookList === "li.book-item", "LLM 解析出 explore.bookList");
ok(p1.exploreUrl === "热门::https://x.com/hot?page=$$", "LLM 解析出 exploreUrl");

// ---- LLM 解析：带 ```json 围栏 ----
const p2 = LLM.parseModelResponse(
  '好的，这是结果：\n```json\n{"ruleSearch":{"bookList":"li","bookUrl":"a","title":"a","searchUrl":"https://x.com/s?q={{key}}&page=$$"}}\n```'
);
ok(p2.ok === true, "LLM 围栏JSON解析 ok");
ok(p2.rules.search && p2.rules.search.searchUrl === "https://x.com/s?q={{key}}&page=$$", "LLM 解析出 search.searchUrl");

// ---- LLM 解析：无效 ----
const p3 = LLM.parseModelResponse("抱歉我无法访问该页面");
ok(p3.ok === false, "LLM 无效回复 ok=false");

// ---- 提示词构造 ----
const prompt = LLM.buildPrompt({ url: "https://x.com/list", title: "书库", htmlSample: "<ul><li>...</li></ul>" }, "explore");
ok(/书籍发现\/列表页/.test(prompt) && /bookList/.test(prompt), "buildPrompt 含目标与字段说明");

console.log("\nRESULT pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
