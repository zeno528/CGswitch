/** App update strings (status-bar notice, upgrade flow). */
export default {
  notice: {
    title: "Version {{version}} available",
    description: "Download and install the new version. The app restarts automatically when done.",
    changelog: "Release notes",
    updateNow: "Update now",
    installing: "Downloading…",
    close: "Dismiss update notice",
    openOnGithub: "View the latest release on GitHub",
  },
  toast: {
    updated: "Updated to v{{version}}",
  },
  error: {
    proxyHint: "Cannot reach GitHub. Check your system proxy and try again.",
    checkFailed: "Update check failed",
  },
} as const;
