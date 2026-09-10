/** 通用层文案：导航、窗口控制等全应用共用的部分。 */
export default {
  nav: {
    providers: "供应商配置",
    mcp: "MCP 管理",
    plugins: "插件",
    skills: "Skill",
    settings: "设置",
  },
  sidebar: {
    expand: "展开侧边栏",
    collapse: "收缩侧边栏",
  },
  window: {
    minimize: "最小化",
    maximize: "最大化",
    close: "关闭",
  },
  select: {
    placeholder: "请选择",
    optionsLabel: "选项",
  },
  loading: "正在加载…",
  feedback: {
    cancel: "取消",
    confirm: "确定",
    dismissToast: "关闭通知",
    genericError: "操作失败",
  },
  error: {
    title: "界面加载失败",
    description: "当前页面遇到异常，可以重新加载后继续使用。",
    reload: "重新加载",
    details: "查看错误详情",
  },
  editor: {
    placeholder: "在此编辑配置…",
    jsonSyntaxError: "JSON 语法错误，请检查此处的逗号、括号或值",
    horizontalScrollbar: "编辑器水平滚动条",
  },
  preset: {
    custom: "自定义",
    qwen: "通义千问",
    hunyuan: "腾讯混元",
    doubao: "火山方舟豆包",
    mimo: "小米 MiMo",
  },
  providerName: {
    hunyuan: "腾讯混元",
    volcengine: "火山方舟",
  },
} as const;
