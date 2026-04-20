// Theme handling. The user setting is one of: "system" | "light" | "dark".
// "system" resolves against prefers-color-scheme at apply time, and re-applies
// when the OS flips (e.g. scheduled dark mode) as long as the setting is still
// "system".
//
// The actual styling lives in CSS. We just set data-theme="light" | "dark" on
// <html> and flip the theme-color meta so mobile status bars match.

const THEME_COLOR = {
  dark:  "#1a1a1d",
  light: "#f7f8fa",
};

export function resolveEffective(pref) {
  if (pref === "light" || pref === "dark") return pref;
  if (typeof window !== "undefined"
      && window.matchMedia
      && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function applyTheme(pref) {
  const effective = resolveEffective(pref);
  document.documentElement.setAttribute("data-theme", effective);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[effective]);
}

/**
 * Watch for OS-level theme changes. The supplied `getPref` is called each
 * time the OS flips — if it returns "system", we re-apply so the app follows.
 * Any other value means the user explicitly picked a theme, so we do nothing.
 */
export function watchSystemTheme(getPref) {
  if (typeof window === "undefined" || !window.matchMedia) return;
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => {
    if (getPref() === "system") applyTheme("system");
  };
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else if (mq.addListener) mq.addListener(handler); // Safari fallback
}
