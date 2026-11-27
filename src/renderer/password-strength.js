/* LUMENEX - indicador de segurança da senha. É só orientação na tela: quem decide se a senha vale
   é core/credentials.js e o servidor. Funciona no navegador (window) e nos testes (require). */
(function (root) {
  'use strict';
  var COMMON = /(senha|password|qwerty|123456|abc123|mudar|iloveyou|lumenex|dota)/i;
  var LABELS = ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Forte'];

  function strength(pw, email) {
    var s = String(pw || '');
    var n = Array.from(s).length;
    if (!n) return { score: 0, label: '', tip: 'Use no mínimo 10 caracteres.' };
    var kinds = [/[a-zà-ÿ]/, /[A-ZÀ-Þ]/, /\d/, /[^A-Za-zÀ-ÿ0-9]/].filter(function (r) { return r.test(s); }).length;
    var unique = new Set(Array.from(s)).size;
    var score = 0;
    if (n >= 10) score = 1;
    if (n >= 10 && (kinds >= 2 || n >= 16)) score = 2;
    if (n >= 12 && (kinds >= 3 || n >= 18)) score = 3;
    if (n >= 14 && (kinds >= 3 || n >= 22) && unique >= 9) score = 4;
    var user = String(email || '').split('@')[0].toLowerCase();
    var weakPattern = COMMON.test(s) || (user.length >= 4 && s.toLowerCase().indexOf(user) >= 0) || unique < 5;
    if (weakPattern) score = Math.min(score, 1);
    var tip = n < 10 ? 'Faltam ' + (10 - n) + ' caracteres para o mínimo.'
      : weakPattern ? 'Evite palavras comuns, repetições e o seu e-mail.'
        : score < 3 ? 'Uma frase longa com números ou símbolos fica mais forte.' : 'Boa escolha. Não reutilize em outros sites.';
    return { score: score, label: LABELS[score], tip: tip };
  }

  root.lxPasswordStrength = strength;
  if (typeof module === 'object' && module.exports) module.exports = strength;
})(typeof window === 'object' ? window : globalThis);
