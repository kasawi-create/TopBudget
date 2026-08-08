// Replacement for the Claude-artifact-only `window.storage` API.
// Backed by @capacitor/preferences, which persists natively on Android
// (and falls back to localStorage automatically when running in a browser,
// e.g. during `npm run dev`), so the same code works everywhere.
import { Preferences } from "@capacitor/preferences";

export const storage = {
  async get(key) {
    const res = await Preferences.get({ key });
    if (res.value === null || res.value === undefined) return null;
    return { key, value: res.value };
  },
  async set(key, value) {
    await Preferences.set({ key, value: String(value) });
    return { key, value };
  },
  async delete(key) {
    await Preferences.remove({ key });
    return { key, deleted: true };
  },
};
