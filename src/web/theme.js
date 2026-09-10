(() => {
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  try {
    const saved = localStorage.getItem("codex_ui_theme");
    if (["light", "dark", "system"].includes(saved)) preference = saved;
  } catch {}

  function applyTheme() {
    document.documentElement.dataset.theme = preference === "system"
      ? (systemTheme.matches ? "dark" : "light") : preference;
    const chinese = document.documentElement.lang === "zh-TW";
    const labels = chinese ? ["☀ 淺色", "☾ 深色", "◐ 系統"] : ["☀ Light", "☾ Dark", "◐ System"];
    document.querySelectorAll("#theme-switch button").forEach((button, index) => {
      button.textContent = labels[index];
      button.setAttribute("aria-pressed", String(button.dataset.theme === preference));
    });
    document.getElementById("theme-switch")?.setAttribute("aria-label", chinese ? "色彩模式" : "Theme");
  }

  applyTheme();
  systemTheme.addEventListener("change", applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("#theme-switch button").forEach((button) => {
      button.addEventListener("click", () => {
        preference = button.dataset.theme;
        try { localStorage.setItem("codex_ui_theme", preference); } catch {}
        applyTheme();
      });
    });
    applyTheme();
  });
})();
