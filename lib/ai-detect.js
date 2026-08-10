// 离线「AI」可视化辅助：不依赖任何外部服务，纯 DOM 结构分析自动识别书籍列表与字段。
// 设计为可在 content script 与 Node 单测中复用的自包含模块（UMD）。
// 对外暴露 window.LSG_AI / module.exports，核心 API：analyzePage(doc)。
(function (global) {
  "use strict";

  function cssEscape(s) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
    return String(s).replace(/([^\w-])/g, "\\$1");
  }

  // 选择器是否在整个文档中唯一定位到 el
  function isUnique(doc, sel, el) {
    let list;
    try {
      list = doc.querySelectorAll(sel);
    } catch (e) {
      return false;
    }
    return list.length === 1 && list[0] === el;
  }

  // 为单元素生成最短稳定唯一选择器（id > 唯一 class 组合 > tag）
  function uni(doc, el) {
    if (!el || el.nodeType === undefined) return "";
    if (el.id) {
      const s = "#" + cssEscape(el.id);
      if (isUnique(doc, s, el)) return s;
    }
    const classes = el.classList ? Array.from(el.classList) : [];
    const tag = el.tagName.toLowerCase();
    if (classes.length) {
      const combo = "." + classes.map(cssEscape).join(".");
      if (isUnique(doc, combo, el)) return combo;
      const tc = tag + combo;
      if (isUnique(doc, tc, el)) return tc;
      for (let i = classes.length - 1; i >= 0; i--) {
        const s = "." + cssEscape(classes[i]);
        if (isUnique(doc, s, el)) return s;
      }
      for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) {
          const s = "." + cssEscape(classes[i]) + "." + cssEscape(classes[j]);
          if (isUnique(doc, s, el)) return s;
        }
      }
    }
    // 兜底：锚点 + nth-of-type（尽力而为，不保证全局唯一）
    return tag + ":nth-of-type(1)";
  }

  // 在 within 容器内的相对选择器（列表子字段用它，extractRule 才能正确命中）
  function rel(doc, el, within) {
    if (!within) return uni(doc, el);
    const classes = el.classList ? Array.from(el.classList) : [];
    if (classes.length) {
      for (const c of classes) {
        const sel = "." + cssEscape(c);
        const list = within.querySelectorAll(sel);
        if (list.length && Array.from(list).indexOf(el) >= 0) return sel;
      }
      const combo = "." + classes.map(cssEscape).join(".");
      const list = within.querySelectorAll(combo);
      if (list.length && Array.from(list).indexOf(el) >= 0) return combo;
    }
    const tag = el.tagName.toLowerCase();
    const list = within.querySelectorAll(tag);
    if (list.length && Array.from(list).indexOf(el) >= 0) return tag;
    return uni(doc, el);
  }

  function commonClasses(a, b) {
    const ca = a.classList ? Array.from(a.classList) : [];
    const cb = b.classList ? Array.from(b.classList) : [];
    return ca.filter((c) => cb.indexOf(c) >= 0);
  }

  const cleanText = (el) => ((el && el.textContent) || "").replace(/\s+/g, " ").trim();

  // 元素是否像一个「书籍卡片」：含封面图（img 或 background-image）且有文本，或含链接且有短文本
  function isCard(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "img" || tag === "script" || tag === "style" || tag === "br" || tag === "input")
      return false;
    const hasImg = el.querySelectorAll("img").length > 0;
    const bg =
      el.style && el.style.backgroundImage && /url\(/i.test(el.style.backgroundImage);
    const t = cleanText(el);
    const hasText = t.length >= 2;
    if ((hasImg || bg) && hasText) return true;
    const hasLink = el.querySelectorAll("a").length > 0;
    if (hasLink && hasText && t.length <= 80) return true;
    return false;
  }

  function cardScore(el) {
    let s = el.querySelectorAll("img").length * 2;
    s += el.querySelectorAll("a").length;
    return s;
  }

  // 在全文档中找书籍列表项：先收集所有「卡片」元素，再按父容器内的卡片兄弟数排序
  function findItems(doc) {
    const all = doc.querySelectorAll("*");
    const cards = [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (isCard(el)) cards.push(el);
    }
    if (!cards.length) return [];
    const scored = cards.map((el) => {
      const parent = el.parentElement;
      let sibCount = 0;
      if (parent && parent.children) {
        for (let k = 0; k < parent.children.length; k++) {
          if (isCard(parent.children[k])) sibCount++;
        }
      }
      return { el, sibCount };
    });
    scored.sort(
      (x, y) => y.sibCount - x.sibCount || cardScore(y.el) - cardScore(x.el)
    );
    const best = scored[0];
    if (!best || best.sibCount < 3) {
      // 卡片数不足，退化为单元素（仍尝试识别字段）
      return best ? [best.el] : [];
    }
    const parent = best.el.parentElement;
    const items = [];
    if (parent && parent.children) {
      for (let k = 0; k < parent.children.length; k++) {
        if (isCard(parent.children[k])) items.push(parent.children[k]);
      }
    }
    return items.length ? items : [best.el];
  }

  // 列表项选择器：共用 tag + 公共 class
  function itemListSelector(doc, items) {
    if (!items.length) return "";
    const a = items[0];
    const b = items[1] || items[0];
    const common = commonClasses(a, b);
    const tag = a.tagName.toLowerCase();
    let sel = common.length ? tag + "." + common.map(cssEscape).join(".") : tag;
    if (doc.querySelectorAll(sel).length !== items.length) {
      const p = a.parentElement;
      if (p && p.classList && p.classList.length) {
        sel = "." + Array.from(p.classList).map(cssEscape).join(".") + " > " + sel;
      }
    }
    return sel;
  }

  // 在某一项内识别各字段。返回 { title, author, coverUrl, bookUrl, intro, kind }，每个 {sel, text}
  function detectFields(doc, item) {
    const fields = {};
    const els = [item].concat(Array.from(item.querySelectorAll("*")));

    // 封面：第一张 img，否则带 background-image 的元素
    let cover = item.querySelectorAll("img")[0] || null;
    if (!cover) {
      for (const e of els) {
        const bg = e.style && e.style.backgroundImage;
        if (bg && /url\(/i.test(bg)) {
          cover = e;
          break;
        }
      }
    }
    if (cover) fields.coverUrl = { sel: rel(doc, cover, item), text: "" };

    // 书名：偏好 <a>/<h*>/.title 且不含图片、文本长度适中的文本元素
    let titleEl = null;
    let titleScore = -1;
    for (const e of els) {
      const t = cleanText(e);
      if (t.length < 2 || t.length > 40) continue;
      if (e.querySelectorAll("img").length > 0) continue; // 含图（多为封面）不作为书名
      const tag = e.tagName.toLowerCase();
      let s = 0;
      if (tag === "a" || /^h[1-6]$/.test(tag)) s += 3;
      if (e.classList) {
        const cls = e.classList;
        if (
          cls.contains("title") ||
          cls.contains("bookname") ||
          cls.contains("name") ||
          cls.contains("book-title")
        )
          s += 3;
        if (
          cls.contains("author") ||
          cls.contains("writer") ||
          cls.contains("intro") ||
          cls.contains("desc") ||
          cls.contains("cover")
        )
          s -= 2;
      }
      if (e.getAttribute && e.getAttribute("href")) s += 1;
      if (s > titleScore) {
        titleScore = s;
        titleEl = e;
      }
    }
    if (titleEl && titleScore >= 0) {
      fields.title = {
        sel: rel(doc, titleEl, item),
        text: cleanText(titleEl).slice(0, 40),
      };
    } else if (!titleEl && item.tagName && item.tagName.toLowerCase() === "a") {
      // 整张卡片即 <a>（含 img + 文本）的情况：书名就是该 <a> 自身的文本
      const t = cleanText(item);
      if (t.length >= 2 && t.length <= 40) {
        titleEl = item;
        fields.title = { sel: "@item", text: t.slice(0, 40) };
      }
    }

    // 书籍链接：书名若为 <a> 则用之；否则找书名的最近 <a> 祖先；再退化为封面 <a>
    let linkEl = null;
    if (titleEl && titleEl.tagName.toLowerCase() === "a" && titleEl.getAttribute("href")) {
      linkEl = titleEl;
    } else {
      let n = titleEl;
      while (n && n !== item) {
        if (n.tagName && n.tagName.toLowerCase() === "a" && n.getAttribute("href")) {
          linkEl = n;
          break;
        }
        n = n.parentElement;
      }
    }
    if (!linkEl && cover && cover.tagName.toLowerCase() === "a" && cover.getAttribute("href")) {
      linkEl = cover;
    }
    if (linkEl) {
      fields.bookUrl = {
        sel: linkEl === item ? "@item" : rel(doc, linkEl, item),
        text: "",
      };
    }

    // 作者：含「著/作者/编/绘/译」或 class 暗示，且文本较短
    let authorEl = null;
    let authorScore = -1;
    for (const e of els) {
      if (e === titleEl) continue;
      const t = cleanText(e);
      if (t.length < 2 || t.length > 16) continue;
      if (e.querySelectorAll("img").length > 0) continue;
      let s = 0;
      if (/著|作者|编|绘|译|文[:：]/.test(t)) s += 4;
      if (/[一-龥]{2,5}(著|编|绘|译)/.test(t)) s += 2;
      if (e.classList) {
        const c = e.classList;
        for (const name of ["author", "writer", "zuozhe", "artist"]) {
          if (c.contains(name)) s += 4;
        }
      }
      if (e.tagName.toLowerCase() === "a" || e.tagName.toLowerCase() === "span") s += 1;
      if (s > authorScore) {
        authorScore = s;
        authorEl = e;
      }
    }
    if (authorEl && authorScore >= 1) {
      fields.author = {
        sel: rel(doc, authorEl, item),
        text: cleanText(authorEl).slice(0, 16),
      };
    }

    // 简介：排除标题/作者/封面后文本最长者
    let introEl = null;
    let introLen = 30;
    for (const e of els) {
      if (e === titleEl || e === authorEl || e === cover) continue;
      if (e.querySelectorAll("img").length > 0) continue;
      const len = cleanText(e).length;
      if (len > introLen) {
        introLen = len;
        introEl = e;
      }
    }
    if (introEl) {
      fields.intro = {
        sel: rel(doc, introEl, item),
        text: cleanText(introEl).slice(0, 60),
      };
    }

    // 分类/标签：class 暗示
    for (const e of els) {
      if (e.classList) {
        const c = e.classList;
        for (const name of ["tag", "category", "class", "type", "genre", "label", "cat"]) {
          if (c.contains(name)) {
            fields.kind = { sel: rel(doc, e, item), text: cleanText(e).slice(0, 16) };
            break;
          }
        }
      }
      if (fields.kind) break;
    }

    return fields;
  }

  function computeConfidence(fields) {
    let c = 0;
    if (fields.coverUrl) c += 0.25;
    if (fields.title) c += 0.3;
    if (fields.bookUrl) c += 0.2;
    if (fields.author) c += 0.1;
    if (fields.intro) c += 0.1;
    if (fields.kind) c += 0.05;
    c = Math.min(1, c + 0.15);
    return Math.round(c * 100) / 100;
  }

  // 主入口：分析整个文档，返回可填充到扩展规则的结果
  function analyzePage(doc) {
    const items = findItems(doc);
    if (!items.length) {
      return { itemSelector: "", fields: {}, confidence: 0, candidateCount: 0 };
    }
    const itemSelector = itemListSelector(doc, items);
    const fields = detectFields(doc, items[0]);
    const confidence = computeConfidence(fields);
    // 取首个样本的字段文本，便于侧栏预览
    const sample = {};
    Object.keys(fields).forEach((k) => (sample[k] = fields[k].text));
    return {
      itemSelector,
      fields,
      confidence,
      candidateCount: items.length,
      sample,
      sampleTitle: (fields.title && fields.title.text) || "",
    };
  }

  const api = {
    analyzePage,
    findItems,
    detectFields,
    itemListSelector,
    isCard,
    rel,
    uni,
    computeConfidence,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.LSG_AI = api;
})(typeof window !== "undefined" ? window : globalThis);
