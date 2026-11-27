'use strict';

// LUMENEX Dynamic Themes: os temas são só cosméticos. Esta é a lista usada pelas preferências;
// a mesma lista está em renderer/themes.js (a tela não importa módulos do processo principal).
// Para um tema novo: acrescente aqui e lá, crie o CSS [data-theme="id"] e, se tiver cenário,
// a pasta de arte e o motor de efeitos. O teste test/shell/themes.test.js confere as duas listas.

const THEME_IDS = Object.freeze(['frostivus', 'dark', 'midnight', 'light']);
const DEFAULT_THEME = 'frostivus';
// Temas que o banco aceita guardar na conta (restrição da migração 0007). Os demais ficam no aparelho.
const ACCOUNT_THEMES = Object.freeze(['dark', 'midnight', 'light']);

module.exports = { THEME_IDS, DEFAULT_THEME, ACCOUNT_THEMES };
