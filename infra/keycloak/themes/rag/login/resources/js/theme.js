/* Light/dark for the Keycloak login pages. Loaded in <head>, so the saved choice is applied before first
   paint. Without a saved choice the stylesheet follows the OS (prefers-color-scheme). The Keycloak origin
   differs from the web app, so the two keep separate preferences. */
(function () {
  var KEY = 'rag-theme';
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
  // PatternFly keys its own dark variables off `pf-v5-theme-dark`; keep it in step with our data-theme.
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    root.classList.toggle('pf-v5-theme-dark', theme === 'dark');
  }
  if (saved === 'light' || saved === 'dark') apply(saved);

  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

  function isDark() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rag-theme-toggle';
    function paint() {
      var dark = isDark();
      btn.innerHTML = dark ? SUN : MOON;
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.title = dark ? 'Light mode' : 'Dark mode';
    }
    btn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
      paint();
    });
    paint();
    document.body.appendChild(btn);
  });
})();
