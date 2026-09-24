import { api } from "../api";
import type { AppState } from "../types";

export async function switchProfileFromTray(id: string, state: AppState, refresh: () => Promise<void>) {
  await api.applyProfile(id);
  await refresh();
  if (!state.settings.auto_restart) return "switchSuccess" as const;
  await api.restartCodex();
  await refresh();
  return state.codex.running ? "switchRestarted" as const : "switchStarted" as const;
}
