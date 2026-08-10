// 纯转换逻辑（不依赖 DOM）：可在扩展面板与 Node 单测中复用
(function (global) {
  "use strict";

  // 把 URL 中的分页数字替换为阅读 APP 的 $$ 占位
  function paginize(u) {
    u = u.replace(/([?&](?:page|p)=)\d+/i, (m, p1) => p1 + "$$");
    u = u.replace(/\/(\d+)(?=\/|$)/, () => "/$$");
    return u;
  }

  // 占位符替换：{page}/{type} -> $$ ，{key} -> {{key}}
  function fillPlaceholders(tpl) {
    return tpl
      .split("{page}")
      .join("$$")
      .split("{type}")
      .join("$$")
      .split("{key}")
      .join("{{key}}");
  }

  // 模板模式：代入分类值生成 名称::url 多行（或单条）
  function batchTemplate(tpl, typesText) {
    const lines = String(typesText || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) {
      return fillPlaceholders(tpl);
    }
    return lines
      .map((line) => {
        let name = "",
          val = line;
        const idx = line.indexOf("::");
        if (idx >= 0) {
          name = line.slice(0, idx).trim();
          val = line.slice(idx + 2).trim();
        } else {
          name = val;
        }
        const url = paginize(
          tpl
            .split("{type}")
            .join(val)
            .split("{page}")
            .join("$$")
            .split("{key}")
            .join("{{key}}")
        );
        return name ? name + "::" + url : url;
      })
      .join("\n");
  }

  // 把生成器内部字段名映射为「阅读」APP 标准字段名
  function normalizeRule(rule) {
    const r = Object.assign({}, rule);
    if (r.bookUrl) {
      r.detailUrl = r.bookUrl;
      delete r.bookUrl;
    }
    if (r.chapterTitle) {
      r.chapterName = r.chapterTitle;
      delete r.chapterTitle;
    }
    return r;
  }

  const api = { paginize, fillPlaceholders, batchTemplate, normalizeRule };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.LSG_TRANSFORM = api;
})(typeof window !== "undefined" ? window : globalThis);
