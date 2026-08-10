// 选择器生成引擎（在 content script 隔离世界中运行，挂到 window.LSG 供 picker.js 使用）
(function () {
  "use strict";

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/([^\w-])/g, "\\$1");
  }

  function q(sel) {
    try {
      return document.querySelectorAll(sel);
    } catch (e) {
      return [];
    }
  }

  // 选择器是否在整个文档中唯一定位到 el
  function isUnique(sel, el) {
    const list = q(sel);
    return list.length === 1 && list[0] === el;
  }

  // 为单个元素生成「最短且稳定」的唯一选择器
  function uniqueSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) {
      const s = "#" + cssEscape(el.id);
      if (isUnique(s, el)) return s;
    }
    const classes = el.classList ? Array.from(el.classList) : [];
    const tag = el.tagName.toLowerCase();

    if (classes.length) {
      const combo = "." + classes.map(cssEscape).join(".");
      if (isUnique(combo, el)) return combo;
      const tagCombo = tag + combo;
      if (isUnique(tagCombo, el)) return tagCombo;
      // 单个 class 中找唯一者
      for (let i = classes.length - 1; i >= 0; i--) {
        const sel = "." + cssEscape(classes[i]);
        if (isUnique(sel, el)) return sel;
      }
      // 两两组合找唯一者
      for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) {
          const sel = "." + cssEscape(classes[i]) + "." + cssEscape(classes[j]);
          if (isUnique(sel, el)) return sel;
        }
      }
    }
    const cand = pathFromAnchor(el);
    if (isUnique(cand, el)) return cand;
    return pathSelector(el);
  }

  // 以最近的「稳定祖先」(有 id 或唯一 class) 为起点，向下拼接 tag/class + nth-of-type 路径
  function pathFromAnchor(el) {
    let anchor = el;
    let n = el;
    while (n && n !== document.body) {
      if (n.id && isUnique("#" + cssEscape(n.id), n)) {
        anchor = n;
        break;
      }
      if (n.classList && n.classList.length) {
        const combo = "." + Array.from(n.classList).map(cssEscape).join(".");
        if (isUnique(combo, n)) {
          anchor = n;
          break;
        }
      }
      n = n.parentElement;
    }
    const parts = [];
    let node = el;
    while (node) {
      let sel = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) {
        sel += "." + Array.from(node.classList).map(cssEscape).join(".");
      }
      if (node !== anchor) {
        let i = 1;
        let sib = node.previousElementSibling;
        while (sib) {
          if (sib.tagName === node.tagName) i++;
          sib = sib.previousElementSibling;
        }
        sel += ":nth-of-type(" + i + ")";
      }
      parts.unshift(sel);
      if (node === anchor) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  // 兜底：基于 nth-of-type 的 DOM 路径（从 body 开始，保证唯一）
  function pathSelector(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let sel = node.tagName.toLowerCase();
      if (node.id) {
        sel += "#" + cssEscape(node.id);
        parts.unshift(sel);
        break;
      }
      let n = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) n++;
        sib = sib.previousElementSibling;
      }
      sel += ":nth-of-type(" + n + ")";
      parts.unshift(sel);
      node = node.parentElement;
      if (node === document.body) {
        parts.unshift("body");
        break;
      }
    }
    return parts.join(" > ");
  }

  // 相对选择器：在 within 容器内需能定位到 el（用于列表内的子字段）
  function relativeSelector(el, within) {
    if (!within) return uniqueSelector(el);
    const classes = el.classList ? Array.from(el.classList) : [];
    const tag = el.tagName.toLowerCase();
    if (classes.length) {
      for (const c of classes) {
        const sel = "." + cssEscape(c);
        const list = within.querySelectorAll(sel);
        if (list.length >= 1 && Array.from(list).includes(el)) return sel;
      }
      const combo = "." + classes.map(cssEscape).join(".");
      const list = within.querySelectorAll(combo);
      if (list.length >= 1 && Array.from(list).includes(el)) return combo;
    }
    return tag;
  }

  function commonParent(a, b) {
    let n = a;
    while (n) {
      if (n.contains(b)) return n;
      n = n.parentElement;
    }
    return null;
  }

  // 列表模式：选两个同列表元素，生成可复用的「列表项」选择器
  function listSelector(a, b) {
    const shared = a.classList
      ? Array.from(a.classList).filter((c) => b.classList && b.classList.contains(c))
      : [];
    const tag = a.tagName.toLowerCase();
    let itemSel = shared.length
      ? tag + "." + shared.map(cssEscape).join(".")
      : tag;
    const parent = commonParent(a, b) || document;
    const items = parent.querySelectorAll(itemSel);
    const arr = Array.from(items);
    if (arr.length === 0 || !arr.includes(a) || !arr.includes(b)) {
      itemSel = uniqueSelector(a); // 退化为单元素选择器
    }
    return itemSel;
  }

  function sampleText(el, max) {
    max = max || 80;
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t.slice(0, max);
  }

  function attrValue(el, name) {
    return el.getAttribute(name) || "";
  }

  // ---------------- 抽取 / 预览相关 ----------------

  // 绝对化相对 URL（用于预览封面/链接）
  function toAbs(url) {
    if (!url) return "";
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return url;
    }
  }

  function queryAll(sel) {
    try {
      return Array.from(document.querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  }

  function extractTextOf(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function firstMatch(root, sel) {
    if (!sel) return null;
    try {
      return root.querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  // 解析选择器；"@item" 表示直接取列表项自身（整张卡片即目标元素时使用）
  function resolve(root, sel) {
    if (!sel) return null;
    if (sel === "@item") return root;
    return firstMatch(root, sel);
  }

  // 按规则对象在当前文档中抽取样本（用于 webView 预览 / 调试）
  // rule 形如 { bookList, bookUrl, title, author, coverUrl, intro, detailUrl,
  //            chapterList, chapterUrl, chapterTitle, name }
  function extractRule(rule) {
    const out = [];
    const listSel = rule.bookList || rule.chapterList;
    if (!listSel) return out;
    const items = queryAll(listSel);
    items.slice(0, 30).forEach((it) => {
      const rec = {};
      const nameSel = rule.title || rule.chapterTitle || rule.name;
      const linkSel = rule.bookUrl || rule.chapterUrl || rule.detailUrl;
      if (nameSel) {
        const e = resolve(it, nameSel);
        if (e) rec.title = extractTextOf(e);
      }
      if (rule.author) {
        const e = resolve(it, rule.author);
        if (e) rec.author = extractTextOf(e);
      }
      if (rule.coverUrl) {
        const e = resolve(it, rule.coverUrl);
        if (e) rec.coverUrl = toAbs(e.getAttribute("src") || "");
      }
      if (linkSel) {
        const e = resolve(it, linkSel);
        if (e) rec.link = toAbs(e.getAttribute("href") || "");
      }
      if (rule.intro) {
        const e = resolve(it, rule.intro);
        if (e) rec.intro = extractTextOf(e).slice(0, 120);
      }
      out.push(rec);
    });
    return out;
  }

  window.LSG = {
    cssEscape,
    uniqueSelector,
    relativeSelector,
    listSelector,
    commonParent,
    sampleText,
    attrValue,
    pathSelector,
    queryAll,
    toAbs,
    extractRule,
  };
})();
