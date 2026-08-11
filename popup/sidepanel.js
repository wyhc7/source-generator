// 侧边栏逻辑：多模块导航、点选通信、书源拼装、发现收集、批量URL、模板、调试预览
(function () {
  "use strict";

  // ---------------- 配置 ----------------
  const TABS = [
    {
      id: "explore",
      name: "发现页",
      fields: [
        { key: "bookList", label: "书籍列表", list: true },
        { key: "bookUrl", label: "书籍链接" },
        { key: "title", label: "书名" },
        { key: "author", label: "作者" },
        { key: "coverUrl", label: "封面" },
        { key: "intro", label: "简介" },
        { key: "kind", label: "分类/标签" },
        { key: "lastChapter", label: "最新章节" },
      ],
      extra: [{ key: "exploreUrl", label: "发现页URL（每行 分类名::url）", textarea: true }],
    },
    {
      id: "search",
      name: "搜索页",
      fields: [
        { key: "bookList", label: "书籍列表", list: true },
        { key: "bookUrl", label: "书籍链接" },
        { key: "title", label: "书名" },
        { key: "author", label: "作者" },
        { key: "coverUrl", label: "封面" },
        { key: "intro", label: "简介" },
        { key: "lastChapter", label: "最新章节" },
      ],
      search: true,
    },
    {
      id: "bookInfo",
      name: "详情页",
      fields: [
        { key: "title", label: "书名" },
        { key: "author", label: "作者" },
        { key: "coverUrl", label: "封面" },
        { key: "intro", label: "简介" },
        { key: "tocUrl", label: "目录链接" },
      ],
    },
    {
      id: "toc",
      name: "目录页",
      fields: [
        { key: "chapterList", label: "章节列表", list: true },
        { key: "chapterUrl", label: "章节链接" },
        { key: "chapterTitle", label: "章节标题" },
      ],
    },
    {
      id: "content",
      name: "正文页",
      fields: [{ key: "content", label: "正文内容" }],
    },
  ];

  const MODULES = [
    { id: "rule", name: "规则" },
    { id: "ai", name: "AI 辅助" },
    { id: "collect", name: "发现页" },
    { id: "batch", name: "批量URL" },
    { id: "template", name: "模板" },
    { id: "debug", name: "调试" },
  ];

  const RULE_KEYS = {
    bookList: "bookList",
    bookUrl: "bookUrl",
    title: "title",
    author: "author",
    coverUrl: "coverUrl",
    intro: "intro",
    kind: "kind",
    lastChapter: "lastChapter",
    tocUrl: "tocUrl",
    chapterList: "chapterList",
    chapterUrl: "chapterUrl",
    chapterTitle: "chapterTitle",
    content: "content",
  };

  const STORE_KEY = "lsg_templates";
  const BUILTINS = { 空白模板: {} };
  const STATE_KEY = "lsg_state";

  // ---------------- 状态持久化（所有字段关掉不丢） ----------------
  let saveTimer = null;
  function saveState() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local
        .set({
          [STATE_KEY]: {
            data: data,
            searchMeta: searchMeta,
            collectCats: collectCats,
            activeModule: activeModule,
            activeTab: activeTab,
          },
        })
        .catch(() => {});
    }, 400);
  }
  async function loadState() {
    try {
      const r = await chrome.storage.local.get(STATE_KEY);
      const s = r[STATE_KEY];
      if (!s) return false;
      Object.keys(data).forEach((k) => delete data[k]);
      if (s.data) Object.keys(s.data).forEach((k) => (data[k] = s.data[k]));
      if (s.searchMeta) Object.assign(searchMeta, s.searchMeta);
      if (Array.isArray(s.collectCats)) collectCats = s.collectCats;
      if (s.activeModule) activeModule = s.activeModule;
      if (s.activeTab) activeTab = s.activeTab;
      return true;
    } catch (e) {
      return false;
    }
  }
  function restoreMetaUI() {
    const set = (id, k) => {
      const el = $(id);
      if (el && data[k]) el.value = data[k];
    };
    set("#meta-name", "meta.name");
    set("#meta-url", "meta.url");
    set("#meta-header", "meta.header");
    set("#meta-webjs", "meta.webjs");
  }

  // ---------------- 状态 ----------------
  const data = {}; // `${tabId}.${key}` -> 选择器
  const searchMeta = {}; // { method, charset, body }
  let activeModule = "rule";
  let activeTab = "explore";
  let pendingField = null;
  let pendingSearch = false;
  let pendingCollect = false;
  let tabId = null;
  let collectCats = []; // [{text, href}]
  let batchMode = "tpl";
  let debugResults = null;
  let aiResult = null; // 最近一次离线 AI 识别结果
  let pendingLLM = null; // { target, desc } 等待页面信息返回后调用大模型
  let discoverCards = []; // 发现页卡片 [{name,url,sel,sep,layout}]
  let discoverStyle = "1"; // 样式一/二

  const $ = (s) => document.querySelector(s);

  // ---------------- 工具 ----------------
  function status(msg, isErr) {
    const el = $("#status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "status" + (isErr ? " err" : "");
  }
  function escapeAttr(s) {
    return String(s == null ? "" : s).replace(/"/g, "&quot;");
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function tryParseJSON(s) {
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }
  async function getTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const id = tabs[0] && tabs[0].id;
      if (id != null) {
        tabId = id;
        return id;
      }
    } catch (e) {}
    return tabId;
  }

  // 向内容脚本发消息；若内容脚本尚未注入（如页面在扩展加载/更新前已打开、未刷新），
  // 用 scripting API 自动注入后再重试一次，避免让用户手动刷新。受限页面（chrome://、网上应用店等）
  // 注入也会失败，此时抛出原始连接错误，由调用方提示。
  // 注入进行中缓存：同一 tab 同一轮并发自愈只注入一次，
  // 避免重复执行 content script 顶层代码导致消息监听器被注册多次、消息被处理多次。
  const _lsgInjecting = new Map();

  async function sendToTab(tabId, msg) {
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      // 仅在「内容脚本未注入 / 接收端不存在」时才自愈式注入；其它错误（如处理器异常）
      // 不应重注，否则会重复注册 content script 监听器导致重复响应。
      const noReceiver =
        e && /receiving end does not exist|message port closed|could not establish connection/i.test(e.message || "");
      if (!noReceiver) throw e;
      // 并发自愈时共享同一个注入 Promise，确保对同一 tab 只注入一次
      try {
        if (!_lsgInjecting.has(tabId)) {
          _lsgInjecting.set(
            tabId,
            chrome.scripting
              .executeScript({
                target: { tabId: tabId },
                files: ["lib/selector-generator.js", "lib/ai-detect.js", "content/picker.js"],
              })
              .finally(() => _lsgInjecting.delete(tabId))
          );
        }
        await _lsgInjecting.get(tabId);
      } catch (e2) {
        throw e;
      }
      return await chrome.tabs.sendMessage(tabId, msg);
    }
  }

  // ---------------- 模块导航 ----------------
  function renderMods() {
    const nav = $("#mods");
    nav.innerHTML = "";
    MODULES.forEach((m) => {
      const b = document.createElement("button");
      b.textContent = m.name;
      b.className = m.id === activeModule ? "active" : "";
      b.onclick = () => {
        activeModule = m.id;
        saveState();
        renderMods();
        renderModule();
      };
      nav.appendChild(b);
    });
  }

  function renderModule() {
    if (activeModule === "rule") {
      $("#tabs").style.display = "flex";
      renderTabs();
      renderFields();
    } else {
      $("#tabs").style.display = "none";
      renderTool();
    }
  }

  function renderTool() {
    if (activeModule === "collect") renderCollect();
    else if (activeModule === "ai") renderAI();
    else if (activeModule === "batch") renderBatch();
    else if (activeModule === "template") renderTemplate();
    else if (activeModule === "debug") renderDebug();
  }

  // ---------------- 规则子页 ----------------
  function renderTabs() {
    const nav = $("#tabs");
    nav.innerHTML = "";
    TABS.forEach((t) => {
      const b = document.createElement("button");
      b.textContent = t.name;
      b.className = t.id === activeTab ? "active" : "";
      b.onclick = () => {
        activeTab = t.id;
        saveState();
        renderTabs();
        renderFields();
      };
      nav.appendChild(b);
    });
  }

  function renderFields() {
    const tab = TABS.find((t) => t.id === activeTab);
    const wrap = $("#fields");
    wrap.innerHTML = "";

    if (activeModule === "rule") {
      const auto = document.createElement("div");
      auto.className = "frow";
      auto.innerHTML =
        '<button id="auto-fill" class="mini wide">自动填充（书名 + 基础URL）</button>';
      wrap.appendChild(auto);
      $("#auto-fill").onclick = startAutofill;
    }

    if (tab.search) {
      const row = document.createElement("div");
      row.className = "search-row";
      row.innerHTML =
        '<input id="kw" placeholder="测试关键词，如：斗破" />' +
        '<button id="cap">捕获搜索URL</button>';
      wrap.appendChild(row);
      $("#cap").onclick = onCaptureSearch;
    }

    tab.fields.forEach((f) => {
      const row = document.createElement("div");
      row.className = "frow";
      const fid = tab.id + "." + f.key;
      const val = data[fid] || "";
      row.innerHTML =
        '<span class="lbl">' +
        f.label +
        (f.list ? '<span class="badge">列表</span>' : "") +
        "</span>" +
        '<input id="in-' +
        fid +
        '" type="text" placeholder="点右侧按钮选择" value="' +
        escapeAttr(val) +
        '" />' +
        '<button class="pic" id="pic-' +
        fid +
        '">点选</button>';
      wrap.appendChild(row);
      $("#pic-" + fid).onclick = () => startPick(fid, f.list ? "list" : "single");
      const inp = $("#in-" + fid);
      inp.addEventListener("input", () => {
        data[fid] = inp.value.trim();
        updateJSON();
      });
    });

    if (tab.extra) {
      tab.extra.forEach((f) => {
        const row = document.createElement("div");
        row.className = "frow col";
        const fid = tab.id + "." + f.key;
        const val = data[fid] || "";
        row.innerHTML =
          '<span class="lbl">' +
          f.label +
          "</span>" +
          '<textarea id="in-' +
          fid +
          '" placeholder="可手动填写，每行一条">' +
          escapeHtml(val) +
          "</textarea>";
        wrap.appendChild(row);
        const ta = $("#in-" + fid);
        ta.addEventListener("input", () => {
          data[fid] = ta.value;
          updateJSON();
        });
      });
    }
  }

  function setPicking(on) {
    document.querySelectorAll(".pic").forEach((b) => (b.disabled = on));
    const cp = $("#collect-pick");
    if (cp) cp.disabled = on;
  }

  async function startPick(fid, mode) {
    const id = await getTab();
    if (id == null) return status("找不到当前标签页", true);
    pendingField = fid;
    const label = fid.split(".").pop();
    status("请在页面上点选「" + label + "」元素（Esc 取消）");
    setPicking(true);
    try {
      await sendToTab(id, { type: "LSG_START", field: fid, mode });
    } catch (e) {
      status("无法连接页面，请刷新页面后重试（chrome:// 类页面不支持）", true);
      pendingField = null;
      setPicking(false);
    }
  }

  async function startAutofill() {
    const id = await getTab();
    if (id == null) return status("找不到当前标签页", true);
    status("自动填充中：分析当前页面…");
    try {
      await sendToTab(id, { type: "LSG_AUTOFILL" });
    } catch (e) {
      status("无法连接页面，请刷新后重试", true);
    }
  }

  async function onCaptureSearch() {
    const id = await getTab();
    if (id == null) return status("找不到当前标签页", true);
    const kw = $("#kw").value.trim();
    if (!kw) return status("请先输入测试关键词", true);
    pendingSearch = true;
    status("搜索捕获中：在页面搜索框输入「" + kw + "」并提交…");
    try {
      await sendToTab(id, { type: "LSG_CAPTURE_SEARCH", keyword: kw });
    } catch (e) {
      pendingSearch = false;
      status("无法连接页面，请刷新后重试", true);
    }
  }

  // ---------------- 发现页可视化卡片编辑器 ----------------
  const LAYOUT_TPL_KEY = "lsg_layout_tpl";
  let discoverDragId = null;

  function defaultLayout() {
    return { flexGrow: 1, flexShrink: 1, alignSelf: "auto", flexBasisPercent: 50, wrapBefore: false };
  }
  function loadDiscover() {
    if (!discoverCards.length && data["explore.cards"]) {
      try {
        discoverCards = JSON.parse(data["explore.cards"]);
      } catch (e) {
        discoverCards = [];
      }
    }
    if (!discoverCards.length && collectCats.length) {
      discoverCards = collectCats.map((c) => ({
        name: c.text,
        url: c.href,
        sel: false,
        sep: false,
        layout: defaultLayout(),
      }));
    }
    if (data["explore.style"]) discoverStyle = data["explore.style"];
  }
  function syncDiscover() {
    const lines = discoverCards
      .filter((c) => !c.sep)
      .map((c) => (c.name ? c.name + "::" : "") + LSG_TRANSFORM.paginize(c.url || ""));
    data["explore.exploreUrl"] = lines.join("\n");
    data["explore.cards"] = JSON.stringify(discoverCards);
    if (discoverStyle) data["explore.style"] = discoverStyle;
    updateJSON();
  }

  function renderCollect() {
    loadDiscover();
    const wrap = $("#fields");
    wrap.innerHTML =
      '<div class="disc-bar">' +
      '<button id="disc-collect">从页面收集分类</button>' +
      '<button id="disc-add" class="mini">+ 卡片</button>' +
      '<button id="disc-sep" class="mini">分隔</button>' +
      '<button id="disc-all" class="mini">全选</button>' +
      '<button id="disc-none" class="mini">反选</button>' +
      '<button id="disc-batch" class="mini">批量layout</button>' +
      '<button id="disc-tpl" class="mini">布局模板</button>' +
      '<span class="disc-style">' +
      '<label><input type="radio" name="dstyle" value="1"' +
      (discoverStyle === "2" ? "" : " checked") +
      "/>一</label>" +
      '<label><input type="radio" name="dstyle" value="2"' +
      (discoverStyle === "2" ? " checked" : "") +
      "/>二</label>" +
      "</span>" +
      "</div>" +
      '<div id="disc-cards"></div>' +
      '<button id="disc-gen" class="primary">生成发现规则</button>' +
      "<hr/>" +
      '<p class="hint">点选书籍字段（与「发现页」规则共用）：</p>' +
      '<div id="collect-fields"></div>';

    renderDiscoverCards();
    renderCollectFields();
    $("#disc-collect").onclick = startCollect;
    $("#disc-add").onclick = () => {
      discoverCards.push({ name: "", url: "", sel: false, sep: false, layout: defaultLayout() });
      renderDiscoverCards();
    };
    $("#disc-sep").onclick = () => {
      discoverCards.push({ name: "分隔", url: "", sel: false, sep: true, layout: defaultLayout() });
      renderDiscoverCards();
    };
    $("#disc-all").onclick = () => {
      discoverCards.forEach((c) => (c.sel = true));
      renderDiscoverCards();
    };
    $("#disc-none").onclick = () => {
      discoverCards.forEach((c) => (c.sel = false));
      renderDiscoverCards();
    };
    $("#disc-batch").onclick = showBatchLayout;
    $("#disc-tpl").onclick = showLayoutTemplates;
    $("#disc-gen").onclick = genDiscover;
    document.querySelectorAll('input[name="dstyle"]').forEach((r) => {
      r.onclick = () => {
        discoverStyle = r.value;
        syncDiscover();
      };
    });
  }

  function renderDiscoverCards() {
    const box = $("#disc-cards");
    if (!box) return;
    box.innerHTML = "";
    discoverCards.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "dcard" + (c.sep ? " sep" : "") + (c.sel ? " sel" : "");
      row.draggable = !c.sep;
      row.dataset.idx = i;
      if (!c.sep) {
        row.innerHTML =
          '<input class="d-sel" type="checkbox"' +
          (c.sel ? " checked" : "") +
          "/>" +
          '<span class="d-handle" title="拖拽排序">⠿</span>' +
          '<input class="d-name" placeholder="分类名" value="' +
          escapeAttr(c.name) +
          '"/>' +
          '<input class="d-url" placeholder="URL（可用 {page}）" value="' +
          escapeAttr(c.url) +
          '"/>' +
          '<button class="d-gear" title="布局">⚙</button>' +
          '<button class="d-del">×</button>' +
          '<div class="d-layout" style="display:none"></div>';
      } else {
        row.innerHTML = '<div class="d-sep-label">— 分隔符 —</div><button class="d-del">×</button>';
      }
      box.appendChild(row);
      if (c.sep) {
        row.querySelector(".d-del").onclick = () => {
          discoverCards.splice(i, 1);
          renderDiscoverCards();
          syncDiscover();
        };
        return;
      }
      row.querySelector(".d-sel").addEventListener("change", (e) => (c.sel = e.target.checked));
      row.querySelector(".d-name").addEventListener("input", (e) => {
        c.name = e.target.value;
        syncDiscover();
      });
      row.querySelector(".d-url").addEventListener("input", (e) => {
        c.url = e.target.value;
        syncDiscover();
      });
      row.querySelector(".d-del").onclick = () => {
        discoverCards.splice(i, 1);
        renderDiscoverCards();
        syncDiscover();
      };
      row.querySelector(".d-gear").onclick = () => {
        const lp = row.querySelector(".d-layout");
        if (lp.style.display === "none") {
          renderLayoutPanel(lp, c);
          lp.style.display = "block";
        } else {
          lp.style.display = "none";
        }
      };
      row.addEventListener("dragstart", (e) => {
        discoverDragId = i;
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        if (discoverDragId == null || discoverDragId === i) return;
        const from = discoverDragId;
        const moved = discoverCards.splice(from, 1)[0];
        let to = i;
        if (from < to) to -= 1; // 源在目标之前，移除后目标索引前移一位
        discoverCards.splice(to, 0, moved);
        discoverDragId = null;
        renderDiscoverCards();
        syncDiscover();
      });
    });
  }

  function renderLayoutPanel(lp, card) {
    const L = card.layout || (card.layout = defaultLayout());
    const opt = (v) => '<option' + (L.alignSelf === v ? " selected" : "") + ">" + v + "</option>";
    lp.innerHTML =
      '<span>flexGrow<input class="l-grow" type="number" value="' +
      L.flexGrow +
      '"/></span>' +
      '<span>flexShrink<input class="l-shrink" type="number" value="' +
      L.flexShrink +
      '"/></span>' +
      "<span>alignSelf<select class=\"l-align\">" +
      opt("auto") +
      opt("stretch") +
      opt("center") +
      opt("flex-start") +
      opt("flex-end") +
      "</select></span>" +
      '<span>basis%<input class="l-basis" type="number" value="' +
      L.flexBasisPercent +
      '"/></span>' +
      '<label><input class="l-wrap" type="checkbox"' +
      (L.wrapBefore ? " checked" : "") +
      "/>wrapBefore</label>";
    lp.querySelector(".l-grow").addEventListener("input", (e) => {
      L.flexGrow = +e.target.value || 0;
      syncDiscover();
    });
    lp.querySelector(".l-shrink").addEventListener("input", (e) => {
      L.flexShrink = +e.target.value || 1;
      syncDiscover();
    });
    lp.querySelector(".l-align").addEventListener("change", (e) => {
      L.alignSelf = e.target.value;
      syncDiscover();
    });
    lp.querySelector(".l-basis").addEventListener("input", (e) => {
      L.flexBasisPercent = +e.target.value || 0;
      syncDiscover();
    });
    lp.querySelector(".l-wrap").addEventListener("change", (e) => {
      L.wrapBefore = e.target.checked;
      syncDiscover();
    });
  }

  function showBatchLayout() {
    const sel = discoverCards.filter((c) => c.sel);
    const target = sel.length ? sel : discoverCards;
    if (!target.length) return status("没有可改的卡片", true);
    const vals = prompt("批量设置 layout（flexGrow flexShrink flexBasisPercent，空格分隔）", "1 1 50");
    if (!vals) return;
    const p = vals.split(/\s+/);
    target.forEach((c) => {
      c.layout = c.layout || defaultLayout();
      if (p[0] != null) c.layout.flexGrow = +p[0] || 0;
      if (p[1] != null) c.layout.flexShrink = +p[1] || 1;
      if (p[2] != null) c.layout.flexBasisPercent = +p[2] || 0;
    });
    status("已批量改 layout：" + target.length + " 张卡片");
    syncDiscover();
    renderDiscoverCards();
  }

  async function showLayoutTemplates() {
    const saved = await loadLayoutTpl();
    const names = Object.keys(saved);
    const act = prompt(
      "布局模板：输入新名称可保存「选中卡片」的 layout；输入已有名称则应用。\n已有：" + (names.join(", ") || "（无）"),
      names[0] || ""
    );
    if (!act) return;
    if (saved[act]) {
      const tpl = saved[act];
      const sel = discoverCards.filter((c) => c.sel);
      (sel.length ? sel : discoverCards).forEach((c) => (c.layout = Object.assign(defaultLayout(), tpl)));
      status("已应用布局模板：" + act);
    } else {
      const sel = discoverCards.filter((c) => c.sel);
      const base = sel.length ? sel[0] : discoverCards[0];
      saved[act] = (base && base.layout) || defaultLayout();
      await chrome.storage.local.set({ [LAYOUT_TPL_KEY]: saved });
      status("已保存布局模板：" + act);
    }
    syncDiscover();
    renderDiscoverCards();
  }
  async function loadLayoutTpl() {
    try {
      const r = await chrome.storage.local.get(LAYOUT_TPL_KEY);
      return r[LAYOUT_TPL_KEY] || {};
    } catch (e) {
      return {};
    }
  }

  function renderCollectFields() {
    const box = $("#collect-fields");
    if (!box) return;
    const fields = [
      { key: "bookList", label: "书籍列表", list: true },
      { key: "bookUrl", label: "书籍链接" },
      { key: "title", label: "书名" },
      { key: "author", label: "作者" },
      { key: "coverUrl", label: "封面" },
      { key: "intro", label: "简介" },
      { key: "kind", label: "分类/标签" },
      { key: "lastChapter", label: "最新章节" },
    ];
    box.innerHTML = "";
    fields.forEach((f) => {
      const row = document.createElement("div");
      row.className = "frow";
      const fid = "explore." + f.key;
      const val = data[fid] || "";
      row.innerHTML =
        '<span class="lbl">' +
        f.label +
        (f.list ? '<span class="badge">列表</span>' : "") +
        "</span>" +
        '<input id="in-' +
        fid +
        '" type="text" placeholder="点右侧按钮" value="' +
        escapeAttr(val) +
        '"/>' +
        '<button class="pic" id="pic-' +
        fid +
        '">点选</button>';
      box.appendChild(row);
      $("#pic-" + fid).onclick = () => startPick(fid, f.list ? "list" : "single");
      const inp = $("#in-" + fid);
      inp.addEventListener("input", () => {
        data[fid] = inp.value.trim();
        updateJSON();
      });
    });
  }

  async function startCollect() {
    const id = await getTab();
    if (id == null) return status("找不到当前标签页", true);
    pendingCollect = true;
    status("发现收集：点击页面分类链接（Enter 完成，Esc 取消）");
    setPicking(true);
    try {
      await sendToTab(id, { type: "LSG_START", mode: "collect" });
    } catch (e) {
      status("无法连接页面，请刷新后重试", true);
      setPicking(false);
      pendingCollect = false;
    }
  }

  function genDiscover() {
    loadDiscover();
    const usable = discoverCards.filter((c) => !c.sep && c.url);
    if (!usable.length) return status("请先收集或填写至少一行分类 URL", true);
    syncDiscover();
    status("已生成发现规则，共 " + usable.length + " 个分类");
  }

  // ---------------- 批量改 URL ----------------
  function renderBatch() {
    const wrap = $("#fields");
    wrap.innerHTML =
      '<div class="seg">' +
      '<button id="b-mode-tpl"' +
      (batchMode === "tpl" ? ' class="active"' : "") +
      ">模板模式</button>" +
      '<button id="b-mode-re"' +
      (batchMode === "re" ? ' class="active"' : "") +
      ">正则模式</button>" +
      "</div>" +
      '<div id="batch-body"></div>';
    $("#b-mode-tpl").onclick = () => {
      batchMode = "tpl";
      renderBatch();
    };
    $("#b-mode-re").onclick = () => {
      batchMode = "re";
      renderBatch();
    };
    if (batchMode === "tpl") renderBatchTpl();
    else renderBatchRe();
  }

  function renderBatchTpl() {
    const body = $("#batch-body");
    body.innerHTML =
      '<label class="blk">URL 模板（占位 {page} {type} {key}）' +
      '<textarea id="bt-tpl">https://example.com/class/{type}?page={page}</textarea></label>' +
      '<label class="blk">分类值（每行一个，可写 名称::值；留空则只把占位替换为 $$）' +
      '<textarea id="bt-types" placeholder="玄幻::xuanhuan&#10;都市::dushi"></textarea></label>' +
      '<button id="bt-run" class="primary">转换 → $$ / {{key}}</button>' +
      '<label class="blk">结果<textarea id="bt-out" readonly></textarea></label>' +
      '<div class="fill-btns"><button id="bt-fill-ex">填入发现URL</button>' +
      '<button id="bt-fill-se">填入搜索URL</button></div>';
    $("#bt-run").onclick = () => {
      const out = LSG_TRANSFORM.batchTemplate($("#bt-tpl").value, $("#bt-types").value);
      $("#bt-out").value = out;
    };
    $("#bt-fill-ex").onclick = () => {
      data["explore.exploreUrl"] = $("#bt-out").value;
      status("已填入发现URL");
      updateJSON();
    };
    $("#bt-fill-se").onclick = () => {
      data["search.searchUrl"] = $("#bt-out").value;
      status("已填入搜索URL");
      updateJSON();
    };
  }

  function renderBatchRe() {
    const body = $("#batch-body");
    body.innerHTML =
      '<label class="blk">示例 URL（每行一个）' +
      '<textarea id="br-urls" placeholder="https://x.com/xuanhuan/1&#10;https://x.com/dushi/2"></textarea></label>' +
      '<label class="blk">正则（含捕获组）' +
      '<input id="br-re" placeholder="https://x.com/(\\w+)/(\\d+)" /></label>' +
      '<button id="br-run" class="primary">提取占位 → $$</button>' +
      '<label class="blk">结果（动态部分以 $$ 占位）' +
      '<textarea id="br-out" readonly></textarea></label>' +
      '<div class="fill-btns"><button id="br-fill-ex">填入发现URL</button>' +
      '<button id="br-fill-se">填入搜索URL</button></div>';
    $("#br-run").onclick = () => {
      const urls = $("#br-urls").value.split("\n").map((s) => s.trim()).filter(Boolean);
      const reStr = $("#br-re").value.trim();
      if (!urls.length || !reStr) return status("请填写 URL 与正则", true);
      let tpl = "";
      let matched = 0;
      try {
        const re = new RegExp(reStr);
        const m = urls[0].match(re);
        if (!m) return status("正则未匹配首个 URL", true);
        const caps = m.slice(1).filter((x) => x != null && x !== "").map(String);
        tpl = urls[0];
        caps
          .slice()
          .sort((a, b) => b.length - a.length)
          .forEach((c) => {
            tpl = tpl.split(c).join("$$");
          });
        urls.forEach((u) => {
          if (u.match(re)) matched++;
        });
      } catch (e) {
        return status("正则错误：" + e.message, true);
      }
      $("#br-out").value = tpl + "\n\n匹配 " + matched + "/" + urls.length + " 条";
    };
    $("#br-fill-ex").onclick = () => {
      data["explore.exploreUrl"] = $("#br-out").value.split("\n")[0];
      status("已填入发现URL");
      updateJSON();
    };
    $("#br-fill-se").onclick = () => {
      data["search.searchUrl"] = $("#br-out").value.split("\n")[0];
      status("已填入搜索URL");
      updateJSON();
    };
  }

  // ---------------- 样式模板管理 ----------------
  function renderTemplate() {
    const wrap = $("#fields");
    wrap.innerHTML =
      '<label class="blk">模板名称<input id="tp-name" placeholder="如：笔趣阁通用" /></label>' +
      '<button id="tp-save" class="primary">保存当前规则为模板</button>' +
      "<hr/>" +
      '<p class="hint">已保存模板（点击加载 / 删除）：</p>' +
      '<div id="tp-list"></div>';
    $("#tp-save").onclick = () => saveTemplate($("#tp-name").value.trim());
    loadTemplates().then(renderTpList);
  }

  async function renderTpList() {
    const box = $("#tp-list");
    if (!box) return;
    const saved = await loadTemplates();
    box.innerHTML = "";
    // 内置与用户模板可能重名，去重且内置优先（同名用户模板不再重复显示一行）
    const seen = new Set();
    const names = [];
    Object.keys(BUILTINS).forEach((n) => {
      if (!seen.has(n)) {
        seen.add(n);
        names.push(n);
      }
    });
    Object.keys(saved).forEach((n) => {
      if (!seen.has(n)) {
        seen.add(n);
        names.push(n);
      }
    });
    names.forEach((name) => {
      const row = document.createElement("div");
      row.className = "tprow";
      const span = document.createElement("span");
      span.className = "tp-name";
      span.textContent = name;
      row.appendChild(span);
      const load = document.createElement("button");
      load.textContent = "加载";
      load.onclick = () => loadTemplate(name);
      row.appendChild(load);
      if (!BUILTINS[name]) {
        const del = document.createElement("button");
        del.textContent = "删除";
        del.onclick = () => delTemplate(name);
        row.appendChild(del);
      }
      box.appendChild(row);
    });
  }

  function snapshotData() {
    const snap = {};
    ["meta.name", "meta.url", "meta.header", "meta.webjs"].forEach((k) => {
      if (data[k]) snap[k] = data[k];
    });
    ["explore", "search", "bookInfo", "toc", "content"].forEach((t) => {
      const rule = pickRule(t);
      if (Object.keys(rule).length) snap["rule." + t] = rule;
    });
    if (data["explore.exploreUrl"]) snap["explore.exploreUrl"] = data["explore.exploreUrl"];
    if (data["search.searchUrl"]) snap["search.searchUrl"] = data["search.searchUrl"];
    return snap;
  }

  function restoreData(snap) {
    Object.keys(data).forEach((k) => delete data[k]);
    Object.keys(snap).forEach((k) => (data[k] = snap[k]));
    discoverCards = []; // 清空后由 loadDiscover 依据新 exploreUrl 重新生成卡片
    // 模板/快照不含搜索捕获方法信息，丢弃上一次搜索捕获残留，避免把旧的 POST 配置
    // 错误拼接到新模板的搜索URL上（buildSource 依据 searchMeta 决定 POST 后缀）
    searchMeta.method = undefined;
    searchMeta.body = "";
    searchMeta.charset = "";
    if (data["meta.name"]) {
      $("#meta-name").value = data["meta.name"];
    }
    if (data["meta.url"]) {
      $("#meta-url").value = data["meta.url"];
    }
    if (data["meta.header"]) {
      $("#meta-header").value = data["meta.header"];
    }
    if (data["meta.webjs"]) {
      $("#meta-webjs").value = data["meta.webjs"];
    }
    const ex = data["explore.exploreUrl"] || "";
    collectCats = ex
      .split("\n")
      .map((l) => {
        const i = l.indexOf("::");
        return i >= 0
          ? { text: l.slice(0, i).trim(), href: l.slice(i + 2).trim() }
          : { text: "", href: l.trim() };
      })
      .filter((c) => c.href || c.text);
  }

  async function saveTemplate(name) {
    if (!name) return status("请填写模板名称", true);
    const all = await loadTemplates();
    all[name] = snapshotData();
    await chrome.storage.local.set({ [STORE_KEY]: all });
    status("已保存模板：" + name);
    renderTemplate();
  }

  async function loadTemplate(name) {
    const all = await loadTemplates();
    const snap = BUILTINS[name] || all[name];
    if (!snap) return;
    restoreData(snap);
    status("已加载模板：" + name);
    renderModule();
    updateJSON();
  }

  async function delTemplate(name) {
    const all = await loadTemplates();
    delete all[name];
    await chrome.storage.local.set({ [STORE_KEY]: all });
    status("已删除模板：" + name);
    renderTemplate();
  }

  async function loadTemplates() {
    try {
      const r = await chrome.storage.local.get(STORE_KEY);
      return r[STORE_KEY] || {};
    } catch (e) {
      return {};
    }
  }

  // ---------------- 调试 / webView 预览 ----------------
  function renderDebug() {
    const wrap = $("#fields");
    wrap.innerHTML =
      '<p class="hint">在当前页面按规则抽取样本，模拟「阅读」APP 解析结果（webView 预览）。</p>' +
      '<div class="debug-bar">' +
      '<select id="db-rule">' +
      '<option value="explore">发现页规则</option>' +
      '<option value="search">搜索页规则</option>' +
      '<option value="toc">目录页规则</option>' +
      "</select>" +
      '<button id="db-run" class="primary">运行预览</button>' +
      "</div>" +
      '<div id="db-check" class="check"></div>' +
      '<div id="db-preview" class="preview"></div>' +
      "<hr/>" +
      '<p class="hint">连接阅读 APP Web 服务调试（我的 → Web服务 → 填 IP/端口）：</p>' +
      '<div class="debug-bar">' +
      '<input id="db-ip" placeholder="IP，如 192.168.1.10" value="' +
      escapeAttr(data["meta.debugIp"] || "") +
      '"/>' +
      '<input id="db-port" placeholder="端口，如 1124" value="' +
      escapeAttr(data["meta.debugPort"] || "") +
      '" style="width:70px"/>' +
      '<button id="db-ping">测试连接</button>' +
      "</div>" +
      '<p class="hint">日志调试（把规则用 java.log 包裹，复制后在 APP 规则编辑里临时替换验证）：</p>' +
      '<button id="db-log">生成日志调试代码</button>' +
      '<textarea id="db-log-out" readonly placeholder="点击生成"></textarea>' +
      "<hr/>" +
      '<p class="hint">Cloudflare 盾：</p>' +
      '<label class="blk"><input type="checkbox" id="db-cf-on"' +
      (data["meta.cf"] ? " checked" : "") +
      "/> 开启过 Cloudflare 盾（导出时注入 loginCheckJs）</label>" +
      '<div class="debug-bar">' +
      '<button id="db-cf">绕过 Cloudflare 验证</button> ' +
      '<button id="db-cookie">抓取 cf_clearance → header</button>' +
      "</div>";
    $("#db-run").onclick = runPreview;
    $("#db-cf").onclick = bypassCF;
    $("#db-cookie").onclick = grabCookie;
    $("#db-ip").addEventListener("input", (e) => {
      data["meta.debugIp"] = e.target.value.trim();
      updateJSON();
    });
    $("#db-port").addEventListener("input", (e) => {
      data["meta.debugPort"] = e.target.value.trim();
      updateJSON();
    });
    $("#db-ping").onclick = testAppConnection;
    $("#db-log").onclick = genLogDebug;
    $("#db-cf-on").addEventListener("change", (e) => {
      data["meta.cf"] = e.target.checked;
      updateJSON();
      status(e.target.checked ? "已开启：导出书源将注入 loginCheckJs" : "已关闭 Cloudflare 注入");
    });
    renderCheck();
    if (debugResults) renderPreview(debugResults);
  }

  async function testAppConnection() {
    const ip = data["meta.debugIp"];
    const port = data["meta.debugPort"];
    if (!ip || !port) return status("请先填写 IP 与端口", true);
    status("正在连接阅读 APP Web 服务…");
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const resp = await fetch("http://" + ip + ":" + port + "/", { mode: "no-cors", signal: ctrl.signal });
      clearTimeout(t);
      status("已发送连接请求（HTTP " + (resp.status || "?") + "），请在 APP 中确认" + (resp.ok ? "成功" : ""));
    } catch (e) {
      status("连接失败：" + e.message + "（确认 APP Web 服务已开启且同网）", true);
    }
  }

  function genLogDebug() {
    const ruleId = $("#db-rule") ? $("#db-rule").value : "explore";
    const rule = pickRule(ruleId);
    const keys = Object.keys(rule);
    if (!keys.length) return status("该规则无字段可生成日志", true);
    const code = keys
      .map((k) => "<js>java.log('" + k + ": '+result)</js>" + rule[k])
      .join("\n");
    const ta = $("#db-log-out");
    if (ta) ta.value = code;
    status("已生成「" + ruleId + "」的日志调试代码，可复制替换到 APP 规则对应字段");
  }

  function renderCheck() {
    const box = $("#db-check");
    if (!box) return;
    const ruleId = $("#db-rule") ? $("#db-rule").value : "explore";
    const rule = pickRule(ruleId);
    const keys = Object.keys(rule);
    box.innerHTML =
      '<div class="hint">已填字段（' +
      ruleId +
      "）：" +
      (keys.length ? keys.join(", ") : "（无）") +
      "</div>";
  }

  async function runPreview() {
    const id = await getTab();
    if (id == null) return status("找不到当前标签页", true);
    const ruleId = $("#db-rule").value;
    const rule = pickRule(ruleId);
    if (!rule.bookList && !rule.chapterList) return status("该规则缺少列表选择器，请先点选", true);
    status("正在页面抽取样本…");
    try {
      await sendToTab(id, { type: "LSG_EXTRACT", rule: rule, ruleId: ruleId });
    } catch (e) {
      status("无法连接页面，请刷新后重试", true);
    }
  }

  function renderPreview(results) {
    const box = $("#db-preview");
    if (!box) return;
    if (!results || !results.length) {
      box.innerHTML = '<div class="hint">未抽取到内容（检查列表/字段选择器是否正确）</div>';
      return;
    }
    box.innerHTML = results
      .map((r) => {
        const img = r.coverUrl
          ? '<img src="' + escapeAttr(r.coverUrl) + '" onerror="this.style.display=\'none\'"/>'
          : "";
        return (
          '<div class="pv"><div class="pv-cover">' +
          img +
          '</div><div class="pv-meta"><div class="pv-title">' +
          escapeHtml(r.title || "(无标题)") +
          '</div><div class="pv-author">' +
          escapeHtml(r.author || "") +
          "</div>" +
          (r.link ? '<a class="pv-link" href="' + escapeAttr(r.link) + '" target="_blank">链接</a>' : "") +
          "</div></div>"
        );
      })
      .join("");
  }

  async function bypassCF() {
    const id = await getTab();
    if (id == null) return status("找不到当前标签页", true);
    status("正在尝试绕过 Cloudflare…");
    try {
      await sendToTab(id, { type: "LSG_BYPASS_CF" });
    } catch (e) {
      status("无法连接页面", true);
    }
  }

  async function grabCookie() {
    const id = await getTab();
    if (id == null) return status("找不到当前标签页", true);
    status("正在读取 cookie…");
    try {
      await sendToTab(id, { type: "LSG_GET_COOKIE" });
    } catch (e) {
      status("无法连接页面", true);
    }
  }

  // ---------------- 可视化 AI 辅助 ----------------
  const LLM_KEY = "lsg_llm";

  async function loadLLM() {
    try {
      const r = await chrome.storage.local.get(LLM_KEY);
      return r[LLM_KEY] || {};
    } catch (e) {
      return {};
    }
  }
  async function saveLLM(obj) {
    await chrome.storage.local.set({ [LLM_KEY]: obj });
  }

  async function renderAI() {
    const wrap = $("#fields");
    const llm = await loadLLM();
    wrap.innerHTML =
      '<p class="hint">离线可视化识别：在当前书籍列表页一键自动识别书名/作者/封面/链接，并在页面上高亮标注。</p>' +
      '<button id="ai-analyze" class="primary">AI 自动识别当前页面</button>' +
      '<div id="ai-result" class="ai-result"></div>' +
      "<hr/>" +
      '<p class="hint">大模型辅助（可选，需自备兼容 OpenAI 的 API Key）：</p>' +
      '<label class="blk">API 地址（含 /v1）<input id="llm-base" type="text" placeholder="https://api.openai.com/v1" value="' +
      escapeAttr(llm.baseURL || "") +
      '" /></label>' +
      '<label class="blk">API Key<input id="llm-key" type="password" placeholder="sk-..." value="' +
      escapeAttr(llm.apiKey || "") +
      '" /></label>' +
      '<label class="blk">模型名<input id="llm-model" type="text" placeholder="gpt-4o-mini" value="' +
      escapeAttr(llm.model || "") +
      '" /></label>' +
      '<button id="llm-save">保存设置</button>' +
      "<hr/>" +
      '<p class="hint">用 AI 生成规则（发送页面结构给模型）：</p>' +
      '<select id="ai-llm-target">' +
      '<option value="explore">发现页规则</option>' +
      '<option value="search">搜索页规则</option>' +
      '<option value="toc">目录页规则</option>' +
      "</select>" +
      '<label class="blk">补充说明（可选）<textarea id="ai-llm-desc" placeholder="如：这是某某小说站，列表在 .book-list 下"></textarea></label>' +
      '<button id="ai-llm-gen" class="primary">AI 生成规则</button>';
    $("#ai-analyze").onclick = startAIAnalyze;
    $("#llm-save").onclick = async () => {
      await saveLLM({
        baseURL: $("#llm-base").value.trim(),
        apiKey: $("#llm-key").value.trim(),
        model: $("#llm-model").value.trim(),
      });
      status("已保存 LLM 设置");
    };
    $("#ai-llm-gen").onclick = genWithLLM;
    if (aiResult) renderAIResult();
  }

  function renderAIResult() {
    const box = $("#ai-result");
    if (!box) return;
    if (!aiResult) {
      box.innerHTML = "";
      return;
    }
    if (aiResult.error) {
      box.innerHTML = '<div class="hint err">' + escapeHtml(aiResult.error) + "</div>";
      return;
    }
    const pct = Math.round((aiResult.confidence || 0) * 100);
    const rows = Object.keys(aiResult.fields || {})
      .map((k) => {
        const f = aiResult.fields[k];
        return (
          '<div class="ai-row"><span class="ai-k">' +
          k +
          '</span><code class="ai-sel">' +
          escapeHtml(f.sel) +
          "</code></div>"
        );
      })
      .join("");
    box.innerHTML =
      '<div class="ai-card">' +
      '<div class="ai-head">识别到 ' +
      (aiResult.candidateCount || 0) +
      " 本书 · 置信度 " +
      pct +
      '%</div>' +
      '<div class="ai-bar"><div class="ai-bar-fill" style="width:' +
      pct +
      '%"></div></div>' +
      (rows || '<div class="hint">未识别出字段</div>') +
      '<div class="ai-adopt">' +
      '<select id="ai-target">' +
      '<option value="explore">填入「发现页」</option>' +
      '<option value="search">填入「搜索页」</option>' +
      "</select>" +
      '<button id="ai-adopt" class="primary">采纳为规则</button>' +
      "</div></div>";
    $("#ai-adopt").onclick = () => adoptAI($("#ai-target").value);
  }

  function adoptAI(target) {
    if (!aiResult || !aiResult.fields) return;
    const map = {
      bookList: aiResult.itemSelector,
      bookUrl: aiResult.fields.bookUrl && aiResult.fields.bookUrl.sel,
      title: aiResult.fields.title && aiResult.fields.title.sel,
      author: aiResult.fields.author && aiResult.fields.author.sel,
      coverUrl: aiResult.fields.coverUrl && aiResult.fields.coverUrl.sel,
      intro: aiResult.fields.intro && aiResult.fields.intro.sel,
      kind: aiResult.fields.kind && aiResult.fields.kind.sel,
    };
    Object.keys(map).forEach((k) => {
      if (map[k]) data[target + "." + k] = map[k];
    });
    status("已采纳 AI 识别结果到「" + (target === "explore" ? "发现页" : "搜索页") + "」");
    updateJSON();
    activeModule = "rule";
    activeTab = target;
    renderMods();
    renderModule();
  }

  async function startAIAnalyze() {
    const id = await getTab();
    if (id == null) return status("找不到当前标签页", true);
    status("AI 正在分析页面…（页面上将出现彩色高亮）");
    try {
      await sendToTab(id, { type: "LSG_AI_ANALYZE" });
    } catch (e) {
      status("无法连接页面，请刷新后重试", true);
    }
  }

  async function genWithLLM() {
    const id = await getTab();
    if (id == null) return status("找不到当前标签页", true);
    const llm = await loadLLM();
    if (!llm.apiKey) return status("请先填写并保存 LLM 的 API Key", true);
    const target = $("#ai-llm-target") ? $("#ai-llm-target").value : "explore";
    const desc = $("#ai-llm-desc") ? $("#ai-llm-desc").value.trim() : "";
    pendingLLM = { target, desc, llm };
    status("正在获取页面信息并提交给模型…");
    try {
      await sendToTab(id, { type: "LSG_GET_PAGE" });
    } catch (e) {
      status("无法连接页面，请刷新后重试", true);
      pendingLLM = null;
    }
  }

  async function doLLMRequest(pageInfo, target, desc, llm) {
    const base = llm.baseURL || "https://api.openai.com/v1";
    const model = llm.model || "gpt-4o-mini";
    let prompt = window.LSG_LLM.buildPrompt(pageInfo, target);
    if (desc) prompt += "\n\n补充说明：" + desc;
    let content = "";
    try {
      const resp = await fetch(base.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + llm.apiKey,
        },
        body: JSON.stringify({
          model: model,
          temperature: 0.2,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        return status("模型请求失败(" + resp.status + ")：" + t.slice(0, 200), true);
      }
      const j = await resp.json();
      content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    } catch (e) {
      return status("调用模型出错：" + e.message + "（检查 API 地址/Key/网络）", true);
    }
    const parsed = window.LSG_LLM.parseModelResponse(content || "");
    if (!parsed.ok) return status("模型未返回有效规则：" + (parsed.error || ""), true);
    Object.keys(parsed.rules || {}).forEach((tab) => {
      const fields = parsed.rules[tab];
      Object.keys(fields).forEach((fk) => {
        if (fields[fk]) data[tab + "." + fk] = fields[fk];
      });
    });
    if (parsed.exploreUrl) data["explore.exploreUrl"] = parsed.exploreUrl;
    if (parsed.searchUrl) data["search.searchUrl"] = parsed.searchUrl;
    if (pageInfo && pageInfo.url) {
      try {
        data["meta.url"] = new URL(pageInfo.url).origin;
        const mu = $("#meta-url");
        if (mu) mu.value = data["meta.url"];
      } catch (e) {}
    }
    status("AI 已生成规则，已填入对应页面");
    updateJSON();
    activeModule = "rule";
    activeTab = target;
    renderMods();
    renderModule();
  }

  // ---------------- 来自 content script 的消息 ----------------
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === "LSG_PICKED" && msg.field === pendingField) {
      data[msg.field] = msg.selector;
      const inp = $("#in-" + msg.field);
      if (inp) {
        inp.value = msg.selector;
        if (msg.text) inp.title = "示例文本：" + msg.text;
        if (msg.href) inp.title = (inp.title ? inp.title + " | " : "") + "链接：" + msg.href;
      }
      let txt = "已填入：" + msg.field + " → " + msg.selector;
      if (msg.warn && msg.warn.length) txt += "　⚠️ " + msg.warn.join("；");
      status(txt, false);
      if (msg.warn && msg.warn.length) {
        const st = $("#status");
        if (st) st.className = "status warn";
      }
      pendingField = null;
      setPicking(false);
      updateJSON();
    } else if (msg.type === "LSG_CANCEL") {
      status("已取消点选");
      pendingField = null;
      setPicking(false);
    } else if (msg.type === "LSG_SEARCH_URL" && pendingSearch) {
      data["search.searchUrl"] = msg.url;
      searchMeta.method = msg.method;
      searchMeta.charset = msg.charset;
      searchMeta.body = msg.body;
      const inp = $("#in-search.searchUrl");
      if (inp) inp.value = msg.url;
      status("已捕获搜索URL：" + msg.url + " (" + (msg.method || "GET") + ")");
      pendingSearch = false;
      updateJSON();
    } else if (msg.type === "LSG_COLLECTED" && pendingCollect) {
      (msg.items || []).forEach((it) =>
        discoverCards.push({ name: it.text, url: it.href, sel: false, sep: false, layout: defaultLayout() })
      );
      pendingCollect = false;
      setPicking(false);
      status("已收集 " + (msg.items ? msg.items.length : 0) + " 个分类");
      if (activeModule === "collect") {
        loadDiscover();
        renderDiscoverCards();
      }
      syncDiscover();
    } else if (msg.type === "LSG_EXTRACT_RESULT") {
      debugResults = msg.results;
      if (activeModule === "debug") {
        renderCheck();
        renderPreview(msg.results);
      }
      status("预览抽取到 " + (msg.results ? msg.results.length : 0) + " 条");
    } else if (msg.type === "LSG_CF_RESULT") {
      status(msg.reason, !msg.ok);
    } else if (msg.type === "LSG_COOKIE") {
      const m = (msg.cookie || "").match(/cf_clearance=([^;]+)/);
      if (m) {
        const cur = data["meta.header"] ? tryParseJSON(data["meta.header"]) || {} : {};
        cur.cookie = "cf_clearance=" + m[1];
        data["meta.header"] = JSON.stringify(cur, null, 2);
        const mh = $("#meta-header");
        if (mh) mh.value = data["meta.header"];
        status("已写入 cf_clearance 到 header.cookie");
      } else {
        status("未找到 cf_clearance（可能验证未完成或受同源限制）", true);
      }
      updateJSON();
    } else if (msg.type === "LSG_AI_RESULT") {
      aiResult = msg.result || null;
      if (msg.error) aiResult = { error: msg.error };
      if (activeModule === "ai") renderAIResult();
      if (aiResult && !aiResult.error) {
        status(
          "AI 识别到 " +
            (aiResult.candidateCount || 0) +
            " 本书，置信度 " +
            Math.round((aiResult.confidence || 0) * 100) +
            "%"
        );
      } else if (aiResult && aiResult.error) {
        status(aiResult.error, true);
      }
    } else if (msg.type === "LSG_AUTOFILL_RESULT") {
      if (msg.error) return status(msg.error, true);
      if (msg.name) {
        data["meta.name"] = msg.name;
        const mn = $("#meta-name");
        if (mn) mn.value = msg.name;
      }
      if (msg.url) {
        data["meta.url"] = msg.url;
        const mu = $("#meta-url");
        if (mu) mu.value = msg.url;
      }
      status("已自动填充：书名「" + (msg.name || "") + "」· URL「" + (msg.url || "") + "」（识别到 " + (msg.candidateCount || 0) + " 本书）");
      updateJSON();
    } else if (msg.type === "LSG_PAGE_INFO") {
      if (pendingLLM) {
        const { target, desc, llm } = pendingLLM;
        pendingLLM = null;
        doLLMRequest(
          { url: msg.url, title: msg.title, htmlSample: msg.htmlSample },
          target,
          desc,
          llm
        );
      }
    }
  });

  // ---------------- 书源拼装 ----------------
  function pickRule(tabId) {
    const rule = {};
    const tab = TABS.find((t) => t.id === tabId);
    if (!tab) return rule;
    tab.fields.forEach((f) => {
      const v = data[tabId + "." + f.key];
      if (v) rule[RULE_KEYS[f.key]] = v;
    });
    if (tab.extra) {
      tab.extra.forEach((f) => {
        const v = data[tabId + "." + f.key];
        if (v) rule[f.key] = v;
      });
    }
    return rule;
  }

  function buildSource() {
    const name = data["meta.name"] || "未命名书源";
    const url = data["meta.url"] || "";
    const src = {
      bookSourceName: name,
      bookSourceUrl: url,
      bookSourceType: 0,
      enabled: true,
      enabledExplore: !!(data["explore.bookList"] || data["explore.exploreUrl"]),
      ruleExplore: LSG_TRANSFORM.normalizeRule(pickRule("explore")),
      enabledSearch: !!(data["search.bookList"] || data["search.searchUrl"]),
      ruleSearch: LSG_TRANSFORM.normalizeRule(pickRule("search")),
      ruleBookInfo: pickRule("bookInfo"),
      ruleToc: LSG_TRANSFORM.normalizeRule(pickRule("toc")),
      ruleContent: pickRule("content"),
    };
    if (data["explore.exploreUrl"]) src.exploreUrl = data["explore.exploreUrl"];
    if (data["search.searchUrl"]) {
      if (searchMeta.method === "POST" && searchMeta.body) {
        const safeBody = String(searchMeta.body)
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');
        src.ruleSearch.searchUrl =
          data["search.searchUrl"] +
          ',{"charset":"' +
          (searchMeta.charset || "utf-8") +
          '","method":"POST","body":"' +
          safeBody +
          '"}';
      } else {
        src.ruleSearch.searchUrl = data["search.searchUrl"];
      }
    }
    ["ruleExplore", "ruleSearch", "ruleBookInfo", "ruleToc", "ruleContent"].forEach((k) => {
      if (Object.keys(src[k]).length === 0) delete src[k];
    });
    if (data["meta.header"]) {
      if (tryParseJSON(data["meta.header"])) src.header = data["meta.header"];
      else status("header 不是合法 JSON，已忽略", true);
    }
    if (data["meta.webjs"]) src.webJs = data["meta.webjs"];
    if (data["meta.cf"]) {
      src.loginCheckJs =
        "if(result.indexOf('_cf_')>=0||result.indexOf('challenge')>=0||result.indexOf('Just a moment')>=0){java.clearCookie();java.startBrowserAwait();}";
    }
    return src;
  }

  function updateJSON() {
    const src = buildSource();
    const j = $("#json");
    if (j) j.value = JSON.stringify(src, null, 2);
    saveState();
  }

  // ---------------- 导出 / 元信息输入 ----------------
  async function checkUpdate() {
    const repo = "wyhc7/source-generator";
    const cur = chrome.runtime.getManifest().version;
    status("正在检查更新…");
    for (const b of ["main", "master"]) {
      try {
        const resp = await fetch(
          "https://raw.githubusercontent.com/" + repo + "/" + b + "/manifest.json"
        );
        if (!resp.ok) continue;
        const j = await resp.json();
        const remote = j.version;
        if (!remote) continue;
        if (cmpVer(remote, cur) > 0) {
          status("发现新版本 v" + remote + "（当前 v" + cur + "），请前往 GitHub 更新", false);
          return;
        }
        status("已是最新版本 v" + cur + "（远程 v" + remote + "）");
        return;
      } catch (e) {}
    }
    status("检查更新失败（仓库可能尚未发布，或网络受限）", true);
  }
  function cmpVer(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }
  $("#btn-update").onclick = checkUpdate;

  $("#meta-name").addEventListener("input", (e) => {
    data["meta.name"] = e.target.value;
    updateJSON();
  });
  $("#meta-url").addEventListener("input", (e) => {
    data["meta.url"] = e.target.value.trim();
    updateJSON();
  });
  $("#meta-header").addEventListener("input", (e) => {
    data["meta.header"] = e.target.value.trim();
    updateJSON();
  });
  $("#meta-webjs").addEventListener("input", (e) => {
    data["meta.webjs"] = e.target.value.trim();
    updateJSON();
  });

  $("#btn-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("#json").value);
      status("已复制到剪贴板");
    } catch (e) {
      status("复制失败，请手动选择文本复制", true);
    }
  };
  $("#btn-download").onclick = () => {
    const blob = new Blob([$("#json").value], { type: "application/json" });
    const a = document.createElement("a");
    const nm = (data["meta.name"] || "booksource").replace(/[^\w一-龥-]/g, "_");
    a.href = URL.createObjectURL(blob);
    a.download = nm + ".json";
    a.click();
    status("已下载 " + nm + ".json，可直接导入阅读 APP");
  };

  // ---------------- 重置当前书源 ----------------
  // 仅清空当前书源编辑状态；保留模板库 / AI 配置 / 布局模板，避免误删用户资产。
  async function resetSource() {
    Object.keys(data).forEach((k) => delete data[k]);
    Object.keys(searchMeta).forEach((k) => delete searchMeta[k]);
    collectCats = [];
    discoverCards = [];
    discoverStyle = "1";
    aiResult = null;
    debugResults = null;
    pendingField = null;
    pendingSearch = false;
    pendingCollect = false;
    pendingLLM = null;
    activeModule = "rule";
    activeTab = "explore";
    batchMode = "tpl";
    ["#meta-name", "#meta-url", "#meta-header", "#meta-webjs"].forEach((s) => {
      const el = $(s);
      if (el) el.value = "";
    });
    try {
      await chrome.storage.local.remove(STATE_KEY);
    } catch (e) {}
    renderMods();
    restoreMetaUI();
    renderModule();
    updateJSON();
    status("已重置当前书源（模板库 / AI 配置 / 布局模板已保留）");
  }
  // 二次确认：首次点击「重置」变为「确认重置？」（红），3 秒内再点才执行，
  // 避免误触清空正在编辑的书源。
  let resetArmed = false;
  let resetTimer = null;
  $("#btn-reset").onclick = () => {
    const btn = $("#btn-reset");
    if (!resetArmed) {
      resetArmed = true;
      btn.textContent = "确认重置？";
      btn.classList.add("armed");
      status("再次点击「确认重置？」将清空当前书源（模板库/AI 配置保留）");
      resetTimer = setTimeout(() => {
        resetArmed = false;
        btn.textContent = "重置";
        btn.classList.remove("armed");
      }, 3000);
      return;
    }
    if (resetTimer) clearTimeout(resetTimer);
    resetArmed = false;
    btn.textContent = "重置";
    btn.classList.remove("armed");
    resetSource();
  };

  // ---------------- 初始化 ----------------
  loadState().then(() => {
    restoreMetaUI();
    renderMods();
    renderModule();
    updateJSON();
  });
})();
