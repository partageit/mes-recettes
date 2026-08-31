// Thème clair / sombre.
//
// Chargé en <head> SANS defer : le thème doit être posé sur <html> avant le
// premier rendu, sinon la page clignote en clair avant de basculer.
//
// Sans choix enregistré on suit le système (aucun attribut, le @media de
// style.css décide). Un clic fige un choix explicite, qui l'emporte alors sur
// la préférence système.

(function () {
  const STORE = 'mes-recettes:theme';

  function stored() {
    try {
      const v = localStorage.getItem(STORE);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null; // navigation privée, stockage bloqué : on reste en auto
    }
  }

  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function apply(choice) {
    if (choice) document.documentElement.setAttribute('data-theme', choice);
    else document.documentElement.removeAttribute('data-theme');
  }

  function effective() {
    return stored() || (systemDark() ? 'dark' : 'light');
  }

  apply(stored());

  function paintButton(btn) {
    const dark = effective() === 'dark';
    btn.textContent = dark ? '☀' : '☾';
    btn.title = dark ? 'Passer en clair' : 'Passer en sombre';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(dark));
  }

  function init() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    paintButton(btn);
    btn.addEventListener('click', () => {
      const next = effective() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORE, next); } catch (e) { /* choix non retenu, la page bascule quand même */ }
      apply(next);
      paintButton(btn);
    });
    // Tant qu'aucun choix n'est enregistré, un changement côté système doit
    // aussi retourner l'icône.
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!stored()) paintButton(btn);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
