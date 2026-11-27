/* LUMENEX Dynamic Themes - registro da tela. Temas exclusivamente cosméticos.
   `scene`: tem cenário animado (e então mostra o ajuste de efeitos).
   Previstos para o futuro, ainda sem implementação: Diretide, The International, Crownfall,
   Radiant, Dire e Eclipse. Cada um entra como mais uma linha aqui e em core/themes.js. */
(function (root) {
  'use strict';
  var list = [
    { id: 'frostivus', label: 'Frostivus', scene: true },
    { id: 'dark', label: 'Preto original', scene: false },
    { id: 'midnight', label: 'Meia-Noite (AMOLED)', scene: false },
    { id: 'light', label: 'Claro', scene: false },
  ];
  var api = {
    list: list,
    fallback: 'frostivus',
    has: function (id) { return list.some(function (t) { return t.id === id; }); },
    get: function (id) { return list.filter(function (t) { return t.id === id; })[0] || null; },
  };
  root.lxThemes = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
