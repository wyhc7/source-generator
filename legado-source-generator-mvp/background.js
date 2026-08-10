// 点击工具栏图标时自动打开侧边栏
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("设置侧边栏行为失败:", err));
