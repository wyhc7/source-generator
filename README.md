# Legado 书源生成器

一个 Chrome / Edge（Manifest V3）浏览器扩展：**在网页上可视化点选元素，自动生成「阅读」(Legado) APP 的书源规则 JSON**。

> 这是 [z1131392774/legado-source-generator](https://github.com/z1131392774/legado-source-generator) 的功能复刻版（含 MVP + 完整高级功能），由 WorkBuddy 浏览器自动化流程生成。

---

## 功能（v1.2 完整版，含可视化 AI 辅助）

- **可视化点选**：悬停预览选择器，点击确认，Esc 取消；列表字段依次点两个同列表元素生成可复用列表项选择器。
- **稳定选择器引擎**：优先 `id` → 唯一 `class` 组合 → 以最近「稳定祖先」为锚点拼接 `tag/class + :nth-of-type` 路径；列表交集算法（`li.book-item` 这类）。
- **五种规则页**：发现页 / 搜索页 / 详情页 / 目录页 / 正文页，拼装标准「阅读」书源字段（`detailUrl` / `chapterName` 等自动映射）。
- **🤖 可视化 AI 辅助（新增）**：见下方专门章节。
- **搜索 URL 捕获**：输入测试关键词 → 页面提交 → 自动把关键词替换为 `{{key}}`（GET / POST 均支持）。
- **发现收集编辑器**：在发现页「从页面收集分类」——点击分类链接自动收集 `分类名::URL`；再点选书籍字段生成 `ruleExplore`；一键拼出多行 `exploreUrl`（自动把分页数字转为 `$$` 占位）。
- **批量改 URL**：
  - 模板模式：URL 模板里用 `{page}` `{type}` `{key}` 占位，代入分类值（每行 `名称::值`）批量生成 `名称::url` 多行，占位自动转 `$$` / `{{key}}`。
  - 正则模式：从示例 URL + 正则（含捕获组）自动提取动态部分并替换为 `$$`。
  - 结果可一键「填入发现URL / 填入搜索URL」。
- **样式模板管理**：把当前整套规则（含元信息、各规则页、exploreUrl、searchUrl）保存为命名模板到 `chrome.storage.local`；内置「空白模板」；支持加载 / 删除，快速套用到同结构站点。
- **调试 / webView 预览**：在当前页面按规则抽取书籍样本，渲染书名 / 作者 / 封面缩略图 / 链接列表，**实时模拟「阅读」APP 解析结果**；同时显示已填字段完整度。
- **Cloudflare 盾绕过**：一键检测并自动点击验证框、轮询直至页面加载；可抓取 `cf_clearance` 写入书源 `header.cookie`。
- **高级选项**：书源级 `header`（请求头 JSON）与 `webJs`（内容解密 JS）字段。
- **实时 JSON 预览 + 一键复制 / 下载 `.json`**，可直接导入阅读 APP。

### v1.2 新增功能

- **发现页可视化卡片编辑器（重做）**：从 v1.1 的「发现收集」升级为真正的卡片编辑器——卡片可**拖拽排序**、每张卡片单独设置 **Flexbox 布局**（flexGrow / flexShrink / alignSelf / flexBasisPercent / wrapBefore，点齿轮展开面板）；支持 **+ 卡片 / 分隔符 / 全选 / 反选 / 批量 layout（prompt 输入） / 布局模板**（命名保存到 `chrome.storage.local`，可复用）；样式一 / 二切换；一键生成发现规则。
- **交互健壮性**：
  - **键盘导航**：点选时光标可用方向键 `↑↓←→` 在 DOM 父 / 子 / 兄弟节点间移动（Esc 取消，Enter 确认当前光标），不再只靠鼠标。
  - **错误检测**：生成选择器时检测空选择器、无匹配、Shadow DOM / iframe 内元素、以及动态 class（如 `_a1b2c3`）等不稳定选择器，并在侧栏以 ⚠️ 橙色高亮提示。
  - **自动填充**：规则页「自动填充」按钮——分析当前页面自动填好 **书名（meta.name）** 与 **基础站址（meta.url）**，省去手填。
  - **状态持久化**：所有字段（含 meta、各规则页、收集分类、当前模块 / 子页）关掉侧栏或重启浏览器后通过 `chrome.storage.local` 自动恢复（防抖保存，不丢数据）。
- **调试与 Cloudflare 增强**：
  - 新增 **连接阅读 APP Web 服务调试**——填 IP / 端口点「测试连接」（`fetch` no-cors ping）。
  - 新增 **日志调试**——把规则用 `java.log('字段: '+result)` 包裹，生成可复制到 APP 规则编辑里临时替换验证的代码。
  - Cloudflare 绕过的 **「开启过盾」开关**：勾选后导出书源会注入 `loginCheckJs`（检测到 `_cf_` / `challenge` / `Just a moment` 后清 cookie 并重开浏览器等待）。
- **检查更新**：侧栏头部「检查更新」按钮——拉取 GitHub `wyhc7/source-generator` 的 `manifest.json` 比对版本号，提示是否有新版本。

---

## 🤖 可视化 AI 辅助

侧边栏新增「AI 辅助」模块，提供两条互补的能力：

### 1. 离线自动识别（无需任何密钥，可立即使用）
- 打开一个书籍列表页，切到「AI 辅助」点 **AI 自动识别当前页面**。
- 扩展在页面上用 **彩色浮层** 标注识别结果：书名(蓝) / 作者(绿) / 封面(紫) / 链接(橙) / 简介(灰) / 分类(青)，并显示「识别到 N 本书 · 置信度 X%」。
- 识别逻辑（`lib/ai-detect.js`）：扫描全页找「书籍卡片」列表项 → 在每项内按「含图 / 链接 / 文本长度 / class 暗示（title/author/tag 等）/ 作者关键词」等信号打分，挑出最可能的书名、作者、封面、链接、简介、分类选择器。
- 在侧栏查看各字段选择器 + 置信度条，选「填入发现页 / 搜索页」一键采纳；采纳后自动跳到对应规则页查看已填字段。
- 浮层按 **Esc** 关闭。

### 2. 大模型辅助生成（可选，需自备兼容 OpenAI 的 API Key）
- 在「AI 辅助」底部填写 **API 地址（含 /v1）/ API Key / 模型名**，点「保存设置」（存于 `chrome.storage.local`）。
- 在下拉选「发现页 / 搜索页 / 目录页」，可写补充说明，点 **AI 生成规则**：扩展会把当前页面的地址、标题、裁剪后的 HTML 发给模型，提示词要求模型只返回 JSON 规则（`lib/ai-llm.js` 构造并解析）。
- 模型返回的 `ruleExplore` / `ruleSearch` / `ruleToc` / `ruleBookInfo` / `ruleContent` 与 `exploreUrl` / `searchUrl` 会被自动填入对应规则页；基础站址也会顺手填好。
- 适用于结构复杂、离线识别不准的站点：让模型读 HTML 直接给选择器。

> 离线识别与模型调用都不在沙箱内自动验证（需本机加载后手动确认）；模型调用依赖你提供的 Key 与网络，扩展只做请求与 JSON 解析，不中转、不留存内容。

---

## 目录结构

```
source-generator/   # 仓库根目录（即扩展目录）
├── manifest.json                 # MV3 配置（side_panel + content_scripts）
├── background.js                 # Service Worker：点击图标打开侧边栏
├── lib/
│   ├── selector-generator.js      # 选择器生成 + 抽取引擎（content script 隔离世界内运行）
│   ├── transform.js               # 纯转换逻辑（分页占位、批量URL、字段名映射），可在 Node 单测
│   ├── ai-detect.js               # 离线 AI 检测：扫描页面自动识别书籍列表与字段（content script 用，可在 Node 单测）
│   └── ai-llm.js                  # 大模型辅助：构造提示词 + 解析模型返回的 JSON 规则（side panel 用，可在 Node 单测）
├── content/
│   ├── picker.js                  # 点选层 + 键盘导航 + 错误检测 + 搜索捕获 + 发现收集 + 抽取 + Cloudflare 绕过 + AI 浮层 + 自动填充 + 取页面信息
│   └── picker.css                 # 点选遮罩/提示框/AI 浮层样式
├── popup/
│   ├── sidepanel.html             # 侧边栏界面（多模块导航）
│   ├── sidepanel.js               # 模块渲染、点选通信、书源拼装、发现页卡片编辑器、状态持久化、调试/Cloudflare、检查更新、AI 模块
│   └── sidepanel.css
├── test.html                      # 选择器/抽取算法的示例测试页（仅用于验证，可删）
├── test-extract.js                # extractRule 的 Node 单测（mock DOM）
├── test-ai.js                     # ai-detect / ai-llm 的 Node 单测（mock DOM）
└── README.md
```

---

## 安装

1. 打开 Chrome / Edge，访问 `chrome://extensions/`（Edge 为 `edge://extensions/`）。
2. 打开右上角 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择仓库根目录（即 manifest.json 所在目录）。
4. 建议固定扩展图标方便使用。
5. 点击图标即可打开侧边栏。

---

## 使用流程

1. 在侧边栏填写 **书源名称** 与 **基础站址（书源URL）**。
2. 顶部模块切换：**规则 / AI 辅助 / 发现页 / 批量URL / 模板 / 调试**。
3. **AI 辅助**：在书籍列表页点「AI 自动识别当前页面」，页面出现彩色浮层；在侧栏看置信度与字段选择器，选「填入发现页 / 搜索页」采纳（复杂站点也可在此填 API Key 用大模型生成）。
4. **规则**：切到对应子页（发现/搜索/详情/目录/正文），点字段右侧「点选」在网站上点元素；搜索页可用「捕获搜索URL」。
5. **发现页**：卡片编辑器——点「从页面收集分类」在发现页点分类链接（Enter 完成），或直接「+ 卡片」手填；拖拽排序、齿轮设布局、批量 layout、布局模板；点「生成发现规则」。
6. **批量URL**：粘贴 URL 模板或示例 URL + 正则，转换后「填入发现URL / 搜索URL」。
7. **模板**：保存当前规则为模板，后续同类站点一键加载。
8. **调试**：选规则（发现/搜索/目录）点「运行预览」看抽取效果；遇 Cloudflare 点「绕过 Cloudflare 验证」，验证后点「抓取 cf_clearance → header」。
9. 底部 **实时预览** 即为书源 JSON；点 **复制** 或 **下载 .json** 导入阅读 APP。

### 导出格式（阅读 APP 书源，节选）

```json
{
  "bookSourceName": "笔趣阁Demo",
  "bookSourceUrl": "https://example.com",
  "bookSourceType": 0,
  "enabled": true,
  "enabledExplore": true,
  "ruleExplore": {
    "bookList": "ul.book-list > li.book-item",
    "detailUrl": "a.book-link",
    "title": "a.book-link"
  },
  "enabledSearch": true,
  "ruleSearch": {
    "searchUrl": "https://example.com/search?key={{key}}",
    "bookList": "li.book-item",
    "detailUrl": "a.book-link",
    "title": "a.book-link"
  },
  "ruleBookInfo": { "title": ".title", "author": ".author", "intro": ".intro", "tocUrl": "a.toc" },
  "ruleToc": { "chapterList": "li.chapter", "chapterUrl": "a", "chapterName": "a" },
  "ruleContent": { "content": ".content" }
}
```

> 说明：列表字段生成「列表项」选择器；子字段生成相对选择器，阅读 APP 在每个列表项内解析。书源内部字段名（如 `bookUrl`/`chapterTitle`）在导出时自动映射为标准名（`detailUrl`/`chapterName`）。导入后如某字段为空，可在阅读 APP 里微调。

---

## 验证状态

- ✅ 所有 JS 通过 `node --check`；manifest 为合法 MV3 JSON。
- ✅ 选择器引擎在真实浏览器引擎中通过单元测试（唯一 `id`、列表交集、相对选择器、锚点路径，前次会话已验证）。
- ✅ `lib/transform.js`（分页占位、批量URL模板/正则、字段名映射）Node 单测 9/9 通过（`batchTemplate` 现已对生成 URL 再跑一次 `paginize`，可把路径里的字面量页码如 `p/1` 一并分页化为 `p/$$`）。
- ✅ `selector-generator.js` 的 `extractRule`（调试预览核心）用 mock DOM + 真实文件 Node 单测 6/6 通过。
- ✅ `lib/ai-detect.js`（离线识别：列表项查找 + 字段打分 + 置信度）用 mock DOM + 真实文件 Node 单测 **23/23** 通过，覆盖 `<li>` 列表与整卡 `<a>` 网格两种结构、空页、以及 `lib/ai-llm.js` 的提示词构造与模型返回 JSON 解析（含 ```json 围栏、无效返回）。
- ✅ v1.2 全部 7 个 JS（含 `content/picker.js` 键盘导航 / 错误检测 / 自动填充，`popup/sidepanel.js` 发现页编辑器 / 状态持久化 / 调试 / 检查更新）通过 `node --check` 无语法错误；`manifest.json` 为合法 MV3；`test-ai.js` 23/23、`test-extract.js` 6/6 无回归（`ai-detect.js` 仅新增 `sampleTitle` 字段，不影响既有断言）。
- ⚠️ 扩展在 **无头(headless)** 环境无法自动加载（`--load-extension` 在无头 Edge 中被忽略），且 content script 运行在隔离世界、`js()` 注入在主世界无法观测其全局变量。因此 **v1.2 的 UI 交互（发现页卡片编辑 / 拖拽排序 / 键盘导航 / 自动填充 / 状态持久化 / 调试 Web 服务连接 / Cloudflare 注入 / 检查更新）请在你本机的普通 Chrome/Edge 中按上面步骤手动验证一次**。

---

## 已知限制 / 与原项目差异

- 单元素选择器在非唯一 class 时回退到「锚点 + nth-of-type」路径，可读性尚可但相对原项目更依赖 DOM 结构稳定性。
- 仅 Chrome / Edge (MV3)；未提供 Firefox (MV2) 版本（原项目有 `src-firefox`）。
- Cloudflare 绕过对「Turnstile 人机验证」(位于跨域 iframe 内) 无法代为点击，需手动完成一次验证后再点选；本扩展会检测并自动点击普通验证框、轮询直至加载。
- 未实现原项目的「webView 内嵌渲染引擎」完整形态，调试模块以「按规则抽取样本并预览」等价替代。
- **离线 AI 识别是启发式**（基于 DOM 结构与文本信号打分），对绝大多数常规书籍列表有效，但特殊结构（如虚拟滚动、Canvas 渲染、字段无语义 class）可能识别不全；识别后请检查置信度并在规则页手动微调。整张卡片即 `<a>` 的情况，书名/链接会用 `@item` 占位表示「取列表项自身」。
- **大模型辅助**依赖你自备的 API Key 与网络；扩展只负责发请求与解析 JSON，不校验模型输出一定能用，生成后仍需在规则页核对。
