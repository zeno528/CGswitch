import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api, isTauri } from "../../api";

export interface AppUpdate {
  version: string;
  install: () => Promise<void>;
}

/** 旧版本把更新标记存 localStorage 的键：启动时兜底消费一次，覆盖升级过渡期 */
export const UPDATED_VERSION_KEY = "cgswitch.updated-version";

export function toAppUpdate(update: Pick<Update, "version" | "download" | "install">): AppUpdate {
  return {
    version: update.version,
    install: async () => {
      await update.download();
      // Windows 的 install 成功启动安装器后会立即退出当前进程，标记必须先原子落盘——
      // localStorage 由 WebView 异步提交，进程被杀时可能来不及写盘导致升级通知丢失
      await api.setUpdateMarker(update.version);
      try {
        await update.install();
      } catch (error) {
        await api.takeUpdateMarker().catch(() => undefined);
        throw error;
      }
      // macOS / Linux 安装后不会自动重启，手动 relaunch；Windows 不会走到这里。
      await relaunch();
    },
  };
}

export async function checkForAppUpdate(): Promise<AppUpdate | null> {
  if (!isTauri) return null;
  const update = await check({ timeout: 30_000 });
  return update ? toAppUpdate(update) : null;
}
