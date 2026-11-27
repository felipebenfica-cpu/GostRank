/* LUMENEX - aplica o tema salvo antes de a tela aparecer (evita o "flash" de tema errado ao abrir).
   Carregado no <head> depois de themes.js e antes das folhas de estilo. app/shell gravam
   'lumenex-theme' sempre que o tema muda. */
(function () {
  'use strict';
  var root = document.documentElement;
  var themes = window.lxThemes;
  try {
    var t = window.localStorage.getItem('lumenex-theme');
    root.setAttribute('data-theme', themes.has(t) ? t : themes.fallback);
    var s = Number(window.localStorage.getItem('lumenex-font-scale'));
    if (s >= 80 && s <= 130) root.style.setProperty('--font-scale', String(s));
  } catch (e) { /* armazenamento indisponível: fica o tema que já veio no HTML */ }
})();
