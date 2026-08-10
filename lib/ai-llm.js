// 大模型辅助（纯函数，不发网络请求）：构造提示词 + 解析模型返回。
// 网络请求在 sidepanel.js 中发起（需要 API Key）。本模块可在 Node 单测。
(function (global) {
  "use strict";

  // 构造给兼容 OpenAI 的对话模型的提示词
  function buildPrompt(pageInfo, target) {
    const url = (pageInfo && pageInfo.url) || "";
    const title = (pageInfo && pageInfo.title) || "";
    const html = ((pageInfo && pageInfo.htmlSample) || "").slice(0, 8000);
    const targetName =
      target === "search" ? "搜索结果页" : target === "toc" ? "目录页" : "书籍发现/列表页";
    return [
      "你是一个为「阅读」(Legado) APP 生成书源规则的助手。",
      "请根据下面的网页信息，为【" + targetName + "】生成 CSS 选择器规则。",
      "网页地址：" + url,
      "网页标题：" + title,
      "要求：",
      "1. 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。",
      "2. 选择器为相对于列表项的 CSS 选择器（列表项内的子元素使用 .class 或 tag，不要写绝对路径）。",
      "3. 字段名使用：bookList(列表项选择器)、bookUrl(书籍链接)、title(书名)、author(作者)、coverUrl(封面图片)、intro(简介)、kind(分类/标签)、lastChapter(最新章节)。",
      "4. 目录页使用 chapterList(章节列表)、chapterUrl(章节链接)、chapterTitle(章节标题)。",
      "5. 搜索页额外给出 searchUrl（关键词位置替换为 {{key}}，分页用 $$）；发现页额外给出 exploreUrl（每行 分类名::URL，分页用 $$）。",
      "6. 无法识别的字段值为空字符串 \"\"。",
      '示例结构：{"ruleExplore":{"bookList":"li.book-item","bookUrl":"a","title":"a.book-name","author":".author","coverUrl":"img","intro":".intro"},"exploreUrl":"热门::https://x.com/hot?page=$$"}',
      "网页 HTML 片段如下：",
      "-----BEGIN HTML-----",
      html,
      "-----END HTML-----",
    ].join("\n");
  }

  // 从模型文本中提取第一个 JSON 对象
  function extractJSON(text) {
    if (!text) return null;
    let s = text;
    // 去掉 ```json ... ``` 代码围栏
    s = s.replace(/```(?:json)?/gi, "");
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start < 0 || end < 0 || end <= start) return null;
    const chunk = s.slice(start, end + 1);
    try {
      return JSON.parse(chunk);
    } catch (e) {
      return null;
    }
  }

  // 把模型的 JSON 归一化为 { tabId: {field: selector} } 形式，便于直接写入扩展 data
  function parseModelResponse(text) {
    const json = extractJSON(text);
    if (!json) return { ok: false, error: "未从模型返回中找到 JSON 对象" };
    const map = {
      ruleExplore: "explore",
      ruleSearch: "search",
      ruleBookInfo: "bookInfo",
      ruleToc: "toc",
      ruleContent: "content",
    };
    const rules = {};
    let anyField = false;
    for (const k in map) {
      const src = json[k];
      if (src && typeof src === "object") {
        const fields = {};
        for (const fk in src) {
          const v = src[fk];
          if (typeof v === "string" && v.trim()) {
            fields[fk] = v.trim();
            anyField = true;
          }
        }
        if (Object.keys(fields).length) rules[map[k]] = fields;
      }
    }
    // 也兼容扁平写法（直接给 explore/search 对象）
    for (const k in map) {
      const short = map[k];
      if (json[short] && typeof json[short] === "object" && !rules[short]) {
        const fields = {};
        for (const fk in json[short]) {
          const v = json[short][fk];
          if (typeof v === "string" && v.trim()) {
            fields[fk] = v.trim();
            anyField = true;
          }
        }
        if (Object.keys(fields).length) rules[short] = fields;
      }
    }
    const out = {
      ok: anyField,
      rules: rules,
      error: anyField ? null : "模型未返回任何有效选择器",
    };
    if (typeof json.exploreUrl === "string" && json.exploreUrl.trim())
      out.exploreUrl = json.exploreUrl.trim();
    if (typeof json.searchUrl === "string" && json.searchUrl.trim())
      out.searchUrl = json.searchUrl.trim();
    return out;
  }

  const api = { buildPrompt, extractJSON, parseModelResponse };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.LSG_LLM = api;
})(typeof window !== "undefined" ? window : globalThis);
