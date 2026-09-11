/** 应用更新相关文案（状态栏提示、升级流程）。 */
export default {
  notice: {
    title: "新版 v{{version}} 已就绪",
    updateNow: "立即重启更新",
    later: "稍后",
    installing: "下载安装中…",
    noNotes: "本次更新暂无日志",
  },
  toast: {
    updated: "已更新到 v{{version}}",
  },
  error: {
    proxyHint: "无法连接 GitHub，请检查系统代理后重试",
    checkFailed: "检查更新失败",
  },
} as const;
