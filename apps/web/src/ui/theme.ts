// Sets data-theme on <html> from the OS colour scheme before the first paint and follows later
// changes (HANDOFF §2: the app follows the OS; light is the primary design and the fallback).
// Inline and dependency-free because it must run before any stylesheet paints the page.
export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{var m=window.matchMedia("(prefers-color-scheme: dark)");var s=function(){d.setAttribute("data-theme",m.matches?"dark":"light")};s();m.addEventListener("change",s)}catch(e){d.setAttribute("data-theme","light")}})();`;

// Page background in the current redesign layer, for browser chrome and the manifest.
export const THEME_COLORS = {
  light: "#f6f7f2",
  dark: "#111b17",
} as const;
