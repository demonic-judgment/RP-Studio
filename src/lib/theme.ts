import type { ThemeMode } from "./types";

export interface AccentPreset {
  id: string;
  name: string;
  hex: string;
}

/** Material 3 风格强调色预设，与 index.css 中 [data-accent] 对应 */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "violet", name: "紫罗兰", hex: "#6750A4" },
  { id: "indigo", name: "靛蓝", hex: "#4355B9" },
  { id: "blue", name: "湖蓝", hex: "#0B57D0" },
  { id: "teal", name: "青碧", hex: "#00696D" },
  { id: "green", name: "苔绿", hex: "#3F6B32" },
  { id: "amber", name: "琥珀", hex: "#8A6100" },
  { id: "orange", name: "陶橙", hex: "#A1481C" },
  { id: "rose", name: "绯玫", hex: "#9B3F5F" },
  { id: "slate", name: "石板", hex: "#4A5A63" },
];

const THEME_KEY = "rp.theme";
const ACCENT_KEY = "rp.accent";

export function resolveDark(theme: ThemeMode): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: ThemeMode, accentId: string) {
  const dark = resolveDark(theme);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.accent = accentId;
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(ACCENT_KEY, accentId);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0d0d0f" : "#f8f7f4");
}

export function watchSystemTheme(theme: ThemeMode, accentId: string, onChange: () => void) {
  if (theme !== "system") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    applyTheme("system", accentId);
    onChange();
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
