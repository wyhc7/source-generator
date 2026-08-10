// 内容脚本：可视化点选层 + 搜索请求捕获
(function () {
  "use strict";

  let state = null; // { field, mode:'single'|'list', firstEl, firstSel }
  let searchCap = null; // { keyword, done }
  let box = null;
  let tip = null;
  let badge = null;
  let aiOverlay = null; // AI 可视化浮层
  const L = window.LSG;

  function ensureUI() {
    if (box) return;
    box = document.createElement("div");
    box.id = "lsg-box";
    tip = document.createElement("div");
    tip.id = "lsg-tip";
    badge = document.createElement("div");
    badge.id = "lsg-badge";
    document.documentElement.appendChild(box);
    document.documentElement.appendChild(tip);
    document.documentElement.appendChild(badge);
  }

  function showTip(text) {
    tip.textContent = text;
    tip.style.display = "block";
  }
  function hideUI() {
    if (box) box.style.display = "none";
    if (tip) tip.style.display = "none";
    if (badge) badge.style.display = "none";
  }

  function positionBox(el) {
    const r = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.top = r.top + "px";
    box.style.left = r.left + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    // tip 跟随元素上方
    tip.style.top = Math.max(0, r.top - 26) + "px";
    tip.style.left = r.left + "px";
  }

  function onMouseMove(e) {
    if (!state) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (el.id === "lsg-box" || el.id === "lsg-tip" || el.id === "lsg-badge") return;
    state.cursor = el;
    positionBox(el);
    let preview;
    if (state.mode === "collect") {
      const a = el.closest("a") || el;
      preview = "收集·已选 " + state.collect.length + " 个 → " + (a.textContent || "").trim().slice(0, 24);
    } else if (state.mode === "list" && state.firstEl) {
      preview = L.listSelector(state.firstEl, el);
      showTip("列表·第二元素 → " + preview);
      return;
    } else {
      preview = L.uniqueSelector(el);
      showTip(
        (state.mode === "list" ? "列表·第一元素 → " : "单选 → ") + preview
      );
      return;
    }
    showTip(preview);
  }

  function onClick(e) {
    if (!state) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = e.target;
    if (!el || el.nodeType !== 1) return;

    if (state.mode === "collect") {
      const a = el.closest("a") || el;
      const href = a.href || location.pathname + location.search;
      const text = (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30);
      state.collect.push({ text: text, href: href });
      badge.textContent = "已收集 " + state.collect.length + " 个分类，按 Enter 完成";
      badge.style.display = "block";
      return;
    }
    if (state.mode === "single") {
      const sel = L.uniqueSelector(el);
      finish({
        field: state.field,
        selector: sel,
        text: L.sampleText(el),
        href: L.attrValue(el, "href"),
        src: L.attrValue(el, "src"),
        warn: checkSelector(el, sel),
      });
    } else {
      if (!state.firstEl) {
        state.firstEl = el;
        state.firstSel = L.uniqueSelector(el);
        badge.textContent = "已选第一元素，请点击同列表中的第二个元素";
        badge.style.display = "block";
        return;
      }
      const sel = L.listSelector(state.firstEl, el);
      finish({ field: state.field, selector: sel, list: true, warn: checkSelector(state.firstEl, sel) });
    }
  }

  function onKey(e) {
    if (!state) return;
    if (e.key === "Escape") {
      cancel();
      return;
    }
    if (state.mode === "collect") {
      if (e.key === "Enter") finishCollect();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      navigate(e.key);
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      const target = state.cursor || e.target;
      if (state.mode === "list" && !state.firstEl) {
        state.firstEl = target;
        state.firstSel = L.uniqueSelector(target);
        badge.textContent = "已选第一元素，请点击同列表中的第二个元素（或再按 Enter 确认）";
        badge.style.display = "block";
        return;
      }
      if (state.mode === "list") {
        const sel = L.listSelector(state.firstEl, target);
        finish({ field: state.field, selector: sel, list: true, warn: checkSelector(state.firstEl, sel) });
      } else {
        const sel = L.uniqueSelector(target);
        finish({
          field: state.field,
          selector: sel,
          text: L.sampleText(target),
          href: L.attrValue(target, "href"),
          src: L.attrValue(target, "src"),
          warn: checkSelector(target, sel),
        });
      }
    }
  }

  function navigate(key) {
    if (!state.cursor) return;
    let next = null;
    if (key === "ArrowUp") next = state.cursor.parentElement;
    else if (key === "ArrowDown") next = state.cursor.firstElementChild;
    else if (key === "ArrowLeft") next = state.cursor.previousElementSibling;
    else if (key === "ArrowRight") next = state.cursor.nextElementSibling;
    if (next && next.nodeType === 1) {
      state.cursor = next;
      positionBox(next);
      showTip("键盘导航 → " + L.uniqueSelector(next));
    }
  }

  function checkSelector(el, sel) {
    const warns = [];
    if (!sel) {
      warns.push("生成的选择器为空");
      return warns;
    }
    try {
      if (document.querySelectorAll(sel).length === 0) warns.push("页面上无匹配元素");
    } catch (err) {
      warns.push("选择器语法异常");
    }
    if (el) {
      try {
        if (typeof ShadowRoot !== "undefined" && el.getRootNode && el.getRootNode() instanceof ShadowRoot) {
          warns.push("元素位于 Shadow DOM 内，可能无法稳定匹配");
        }
      } catch (err) {}
      try {
        if (el.ownerDocument && el.ownerDocument !== document) warns.push("元素位于 iframe 内");
      } catch (err) {}
    }
    if (/_[0-9a-f]{6,}/i.test(sel) || /[a-z0-9_-]*[0-9a-f]{10,}/i.test(sel)) {
      warns.push("选择器含疑似动态 class（每次加载可能变化）");
    }
    return warns;
  }

  function finish(result) {
    chrome.runtime.sendMessage({ type: "LSG_PICKED", ...result });
    stopPick();
  }

  function finishCollect() {
    chrome.runtime.sendMessage({ type: "LSG_COLLECTED", items: state.collect });
    stopPick();
  }

  function cancel() {
    chrome.runtime.sendMessage({ type: "LSG_CANCEL" });
    stopPick();
  }

  function stopPick() {
    state = null;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    hideUI();
  }

  function startPick(msg) {
    removeAIOverlay();
    ensureUI();
    state = {
      field: msg.field,
      mode: msg.mode || "single",
      firstEl: null,
      firstSel: null,
      collect: [],
      cursor: null,
    };
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    if (state.mode === "collect") {
      showTip("发现收集：点击页面上的分类链接（Enter 完成，Esc 取消）");
    } else {
      showTip(
        state.mode === "list" ? "列表模式：点击第一个元素" : "单选模式：点击目标元素（Esc 取消）"
      );
    }
  }

  // ---------------- 搜索 URL 捕获 ----------------
  function reportSearch(url, method, body) {
    let out = url;
    if (method === "GET" && searchCap && searchCap.keyword) {
      out = url.split(searchCap.keyword).join("{{key}}");
    }
    chrome.runtime.sendMessage({
      type: "LSG_SEARCH_URL",
      url: out,
      method: method || "GET",
      charset: "utf-8",
      body: body == null ? "" : typeof body === "string" ? body : String(body),
    });
  }

  function onSearchSubmit(e) {
    if (!searchCap || searchCap.done || !e.target.action) return;
    const form = e.target;
    const params = new URLSearchParams(new FormData(form));
    params.forEach((v, k) => {
      if (String(v).indexOf(searchCap.keyword) !== -1) params.set(k, "{{key}}");
    });
    if ((form.method || "get").toLowerCase() === "get") {
      const out = form.action + "?" + params.toString();
      searchCap.done = true;
      badge.style.display = "none";
      reportSearch(out, "GET", null);
    } else {
      e.preventDefault();
      searchCap.done = true;
      badge.style.display = "none";
      reportSearch(form.action, "POST", params.toString());
    }
  }

  function startSearchCapture(msg) {
    searchCap = { keyword: msg.keyword || "", done: false };
    showTip("搜索捕获中：请在页面搜索框输入关键词并提交…");
    badge.textContent = "搜索捕获模式已开启";
    badge.style.display = "block";

    // 若之前已打过补丁，先还原，避免重复包裹导致重复捕获
    if (window.__lsgOrigFetch) window.fetch = window.__lsgOrigFetch;
    if (window.__lsgOrigOpen) XMLHttpRequest.prototype.open = window.__lsgOrigOpen;
    if (window.__lsgOrigSend) XMLHttpRequest.prototype.send = window.__lsgOrigSend;
    window.__lsgOrigFetch = window.fetch;
    window.__lsgOrigOpen = XMLHttpRequest.prototype.open;
    window.__lsgOrigSend = XMLHttpRequest.prototype.send;

    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      if (!searchCap.done && url && searchCap.keyword && url.indexOf(searchCap.keyword) !== -1) {
        searchCap.done = true;
        badge.style.display = "none";
        reportSearch(url, (init && init.method) || "GET", init && init.body ? init.body : null);
      }
      return window.__lsgOrigFetch.apply(this, arguments);
    };
    XMLHttpRequest.prototype.open = function (m, u) {
      this._lsg_m = m;
      this._lsg_u = u;
      return window.__lsgOrigOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (b) {
      if (!searchCap.done && this._lsg_u && searchCap.keyword && this._lsg_u.indexOf(searchCap.keyword) !== -1) {
        searchCap.done = true;
        badge.style.display = "none";
        reportSearch(this._lsg_u, this._lsg_m || "GET", b || null);
      }
      return window.__lsgOrigSend.apply(this, arguments);
    };

    document.removeEventListener("submit", onSearchSubmit, true);
    document.addEventListener("submit", onSearchSubmit, true);
  }

  // ---------------- 按规则抽取样本（webView 预览 / 调试） ----------------
  function handleExtract(msg) {
    const rule = msg.rule || {};
    const results = L.extractRule(rule);
    chrome.runtime.sendMessage({ type: "LSG_EXTRACT_RESULT", results, ruleId: msg.ruleId });
  }

  // ---------------- 读取 cookie（用于抓取 cf_clearance） ----------------
  function handleGetCookie() {
    chrome.runtime.sendMessage({ type: "LSG_COOKIE", cookie: document.cookie || "" });
  }

  // ---------------- Cloudflare 盾绕过 ----------------
  function isCloudflare() {
    const t = document.title || "";
    if (/just a moment/i.test(t)) return true;
    if (document.querySelector("#challenge-stage, #cf-challenge-running, iframe[src*='challenges.cloudflare.com']"))
      return true;
    if (
      document.querySelector("input[type=checkbox][name=checkbox]") &&
      /attention required|verify|checking/i.test(t)
    )
      return true;
    return false;
  }

  function clickCheckbox() {
    const cb =
      document.querySelector("#challenge-stage input[type=checkbox]") ||
      document.querySelector("input[type=checkbox][aria-label], input[type=checkbox]");
    if (cb) {
      try {
        cb.click();
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  async function bypassCloudflare() {
    if (!isCloudflare()) {
      return { ok: false, reason: "未检测到 Cloudflare 验证页（标题/挑战框均不匹配）" };
    }
    clickCheckbox();
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!isCloudflare()) {
        return { ok: true, reason: "验证通过，页面已加载，可继续点选" };
      }
    }
    return {
      ok: false,
      reason:
        "超时仍未通过。可能是 Turnstile 人机验证（位于跨域 iframe 内，扩展无法代为点击），请在页面上手动完成一次验证后再点选。",
    };
  }

  function handleBypass() {
    bypassCloudflare().then((res) => {
      chrome.runtime.sendMessage({ type: "LSG_CF_RESULT", ok: res.ok, reason: res.reason });
    });
  }

  // ---------------- 可视化 AI 辅助（离线检测 + 浮层） ----------------
  const FIELD_COLORS = {
    title: "#3b82f6",
    author: "#22c55e",
    coverUrl: "#a855f7",
    bookUrl: "#f97316",
    intro: "#6b7280",
    kind: "#14b8a6",
  };
  const FIELD_LABELS = {
    title: "书名",
    author: "作者",
    coverUrl: "封面",
    bookUrl: "链接",
    intro: "简介",
    kind: "分类",
  };

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function resolveInPage(item, sel) {
    if (!sel) return null;
    if (sel === "@item") return item;
    try {
      return item.querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  function addAIBox(overlay, el, bg, border, label) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const box = document.createElement("div");
    box.className = "lsg-ai-box";
    box.style.top = r.top + "px";
    box.style.left = r.left + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    box.style.background = bg;
    box.style.borderColor = border;
    const tag = document.createElement("span");
    tag.className = "lsg-ai-tag";
    tag.textContent = label;
    tag.style.background = border;
    box.appendChild(tag);
    overlay.appendChild(box);
  }

  function onAIKey(e) {
    if (e.key === "Escape") removeAIOverlay();
  }

  function removeAIOverlay() {
    if (aiOverlay) {
      aiOverlay.remove();
      aiOverlay = null;
    }
    document.removeEventListener("keydown", onAIKey, true);
  }

  function drawAIOverlay(result) {
    removeAIOverlay();
    const overlay = document.createElement("div");
    overlay.id = "lsg-ai-overlay";
    const banner = document.createElement("div");
    banner.id = "lsg-ai-banner";
    banner.textContent =
      "AI 已识别 " +
      (result.candidateCount || 0) +
      " 本书（置信度 " +
      Math.round((result.confidence || 0) * 100) +
      "%）· 按 Esc 关闭浮层";
    overlay.appendChild(banner);
    let items = [];
    try {
      items = Array.prototype.slice.call(document.querySelectorAll(result.itemSelector));
    } catch (e) {
      items = [];
    }
    items.slice(0, 30).forEach((item) => {
      addAIBox(overlay, item, "rgba(59,130,246,0.18)", "#3b82f6", "书籍项");
      Object.keys(FIELD_COLORS).forEach((k) => {
        const f = result.fields && result.fields[k];
        if (!f || !f.sel) return;
        const el = resolveInPage(item, f.sel);
        if (el) addAIBox(overlay, el, hexA(FIELD_COLORS[k], 0.16), FIELD_COLORS[k], FIELD_LABELS[k] || k);
      });
    });
    document.documentElement.appendChild(overlay);
    aiOverlay = overlay;
    document.addEventListener("keydown", onAIKey, true);
  }

  function handleAIAnalyze() {
    if (!window.LSG_AI) {
      chrome.runtime.sendMessage({ type: "LSG_AI_RESULT", error: "AI 引擎未加载，请刷新页面" });
      return;
    }
    const result = window.LSG_AI.analyzePage(document);
    drawAIOverlay(result);
    chrome.runtime.sendMessage({ type: "LSG_AI_RESULT", result: result });
  }

  // 供大模型使用：返回页面地址/标题/裁剪后的 HTML 样本
  function handleGetPage() {
    let html = document.body ? document.body.innerHTML : "";
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .slice(0, 20000);
    chrome.runtime.sendMessage({
      type: "LSG_PAGE_INFO",
      url: location.href,
      title: document.title || "",
      htmlSample: html,
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "LSG_START") startPick(msg);
    else if (msg.type === "LSG_STOP") stopPick();
    else if (msg.type === "LSG_CAPTURE_SEARCH") startSearchCapture(msg);
    else if (msg.type === "LSG_EXTRACT") handleExtract(msg);
    else if (msg.type === "LSG_BYPASS_CF") handleBypass();
    else if (msg.type === "LSG_GET_COOKIE") handleGetCookie();
    else if (msg.type === "LSG_AI_ANALYZE") handleAIAnalyze();
    else if (msg.type === "LSG_GET_PAGE") handleGetPage();
    else if (msg.type === "LSG_AUTOFILL") handleAutofill();
  });

  // 自动填充：从当前页推断书名与基础 URL
  function handleAutofill() {
    if (!window.LSG_AI) {
      chrome.runtime.sendMessage({ type: "LSG_AUTOFILL_RESULT", error: "AI 引擎未加载，请刷新页面" });
      return;
    }
    let res = { sampleTitle: "", candidateCount: 0 };
    try {
      res = window.LSG_AI.analyzePage(document);
    } catch (e) {}
    const name = res.sampleTitle || document.title || "";
    let url = "";
    try {
      url = location.origin;
    } catch (e) {}
    chrome.runtime.sendMessage({
      type: "LSG_AUTOFILL_RESULT",
      name: name,
      url: url,
      candidateCount: res.candidateCount || 0,
    });
  }
})();
