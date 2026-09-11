/** App update strings (status-bar notice, upgrade flow). */
export default {
  notice: {
    title: "Version {{version}} available",
    updateNow: "Update now",
    later: "Skip",
    installing: "Downloading…",
    noNotes: "No release notes for this version",
  },
  toast: {
    updated: "Updated to v{{version}}",
  },
  error: {
    proxyHint: "Cannot reach GitHub. Check your system proxy and try again.",
    checkFailed: "Update check failed",
  },
} as const;
