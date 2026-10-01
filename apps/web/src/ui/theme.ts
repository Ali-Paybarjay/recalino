// Sets data-theme on <html> from the OS colour scheme before the first paint and follows later
// changes (HANDOFF §2: the app follows the OS; light is the primary design and the fallback).
// Inline and dependency-free because it must run before any stylesheet paints the page.
export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{var m=window.matchMedia("(prefers-color-scheme: dark)");var s=function(){d.setAttribute("data-theme",m.matches?"dark":"light")};s();m.addEventListener("change",s)}catch(e){d.setAttribute("data-theme","light")}})();`;

// Page background (--color-bg in tokens.css) for the browser bar and the web app manifest.
// theme.test.ts checks that these match tokens.css.
export const THEME_COLORS = {
  light: "#eef9f3",
  dark: "#0f1a16",
} as const;
