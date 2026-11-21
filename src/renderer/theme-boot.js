/* LUMENEX - aplica o tema salvo antes de a tela aparecer (evita o "flash" de tema errado ao abrir).
   Carregado no <head>, antes das folhas de estilo. app/shell gravam 'lumenex-theme' sempre que o tema muda. */
(function () {
  'use strict';
  var root = document.documentElement;
  try {
    var t = window.localStorage.getItem('lumenex-theme');
    if (t === 'dark' || t === 'midnight' || t === 'light') root.setAttribute('data-theme', t);
    var s = Number(window.localStorage.getItem('lumenex-font-scale'));
    if (s >= 80 && s <= 130) root.style.setProperty('--font-scale', String(s));
  } catch (e) { /* armazenamento indisponível: fica o tema escuro padrão */ }
})();
