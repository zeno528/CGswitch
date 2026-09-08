import { describe, expect, it, vi } from "vitest";
import { relaunch } from "@tauri-apps/plugin-process";
import { toAppUpdate } from "./appUpdate";

const { setUpdateMarker, takeUpdateMarker } = vi.hoisted(() => ({
  setUpdateMarker: vi.fn(async (_version: string) => undefined),
  takeUpdateMarker: vi.fn(async () => null as string | null),
}));

vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("../../api", () => ({
  api: { setUpdateMarker, takeUpdateMarker },
  isTauri: true,
}));

describe("toAppUpdate", () => {
  it("安装成功：下载后先把版本标记原子落盘，再启动安装器", async () => {
    const download = vi.fn(async () => {});
    const install = vi.fn(async () => {});
    vi.mocked(relaunch).mockClear();
    setUpdateMarker.mockClear();
    takeUpdateMarker.mockClear();
    const update = toAppUpdate({ version: "0.10.5", download, install });

    expect(update.version).toBe("0.10.5");
    await update.install();
    expect(download).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    // 顺序必须是 download → 标记落盘 → install：Windows 安装器启动即杀进程，
    // localStorage 异步提交来不及写盘会让升级后通知丢失
    const [downloadAt, markAt, installAt] = [download, setUpdateMarker, install].map(
      (mock) => mock.mock.invocationCallOrder[0],
    );
    expect(downloadAt).toBeLessThan(markAt);
    expect(markAt).toBeLessThan(installAt);
    expect(setUpdateMarker).toHaveBeenCalledWith("0.10.5");
    expect(takeUpdateMarker).not.toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("安装失败：清除标记并向上抛错", async () => {
    setUpdateMarker.mockClear();
    takeUpdateMarker.mockClear();
    const failure = vi.fn(async () => { throw new Error("安装器启动失败"); });
    const update = toAppUpdate({ version: "0.10.5", download: vi.fn(async () => {}), install: failure });

    await expect(update.install()).rejects.toThrow("安装器启动失败");
    expect(setUpdateMarker).toHaveBeenCalledWith("0.10.5");
    expect(takeUpdateMarker).toHaveBeenCalledOnce();
  });
});
