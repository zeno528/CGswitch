/** Shared UI strings: navigation, window controls. */
export default {
  nav: {
    providers: "Providers",
    // 侧边栏给标签只留约 72px；"MCP Servers" 会溢出，导航用短名，完整名见页面标题 mcp:list.title
    mcp: "MCP",
    plugins: "Plugins",
    skills: "Skill",
    settings: "Settings",
  },
  sidebar: {
    expand: "Expand sidebar",
    collapse: "Collapse sidebar",
  },
  window: {
    minimize: "Minimize",
    maximize: "Maximize",
    close: "Close",
  },
  select: {
    placeholder: "Select...",
    optionsLabel: "Options",
  },
  loading: "Loading...",
  feedback: {
    cancel: "Cancel",
    confirm: "Confirm",
    dismissToast: "Dismiss notification",
    genericError: "Operation failed",
  },
  error: {
    title: "Failed to load the interface",
    description: "This page ran into an error. Reload to continue using the app.",
    reload: "Reload",
    details: "View error details",
  },
  editor: {
    placeholder: "Edit the configuration here...",
    jsonSyntaxError: "JSON syntax error. Check the comma, brackets, or value here.",
    horizontalScrollbar: "Editor horizontal scrollbar",
  },
  preset: {
    custom: "Custom",
    qwen: "Qwen",
    hunyuan: "Tencent Hunyuan",
    doubao: "Volcengine Doubao",
    mimo: "Xiaomi MiMo",
  },
  providerName: {
    hunyuan: "Tencent Hunyuan",
    volcengine: "Volcengine Ark",
  },
} as const;
