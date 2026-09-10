/** 应用更新相关文案（状态栏提示、升级流程）。 */
export default {
  notice: {
    title: "发现新版本 v{{version}}",
    description: "下载并安装新版本，完成后自动重启",
    changelog: "更新日志",
    updateNow: "立即升级",
    installing: "下载安装中…",
    close: "关闭更新提示",
    openOnGithub: "在 GitHub 查看最新发行版",
  },
  toast: {
    updated: "已更新到 v{{version}}",
  },
  error: {
    proxyHint: "无法连接 GitHub，请检查系统代理后重试",
    checkFailed: "检查更新失败",
  },
} as const;
