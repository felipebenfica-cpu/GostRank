'use strict';

function checkInt(value, min, max, label) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const s = value.trim();
    if (!/^\d+$/.test(s)) {
      return { ok: false, error: `${label} deve ser um número inteiro, sem decimais ou símbolos.` };
    }
    n = Number(s);
  } else {
    return { ok: false, error: `${label} deve ser um número.` };
  }
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: `${label} deve ser um número inteiro.` };
  }
  if (n < min || n > max) {
    return { ok: false, error: `${label} deve estar entre ${min} e ${max}.` };
  }
  return { ok: true, value: n };
}

const validateMmr = (value) => checkInt(value, 0, 20000, 'O MMR');
const validateGain = (value) => checkInt(value, 1, 100, 'O ganho por partida');
const validateGoal = (value) => checkInt(value, 0, 20000, 'A meta de MMR');

module.exports = { validateMmr, validateGain, validateGoal };
