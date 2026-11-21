'use strict';

const EMAIL_MAX = 254;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 72;
const NAME_MIN = 2;
const NAME_MAX = 24;

const MMR_VISIBILITY = Object.freeze(['friends', 'group', 'nobody']);

// Senhas mais comuns (mesmo as curtas ficam na lista; o tamanho mínimo é checado antes).
const COMMON_PASSWORDS = Object.freeze([
  '123456', '123456789', '12345678', 'password', 'qwerty123', '1234567890',
  '1q2w3e4r5t', 'password1', 'password123', 'iloveyou', 'qwertyuiop', 'abc123456',
  '1234567891', 'senha12345', 'senha123456', 'mudar12345', '0123456789',
  '123123123', 'qazwsxedc', 'letmein123',
]);

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const CONTROL_RE = /[\p{Cc}\p{Zl}\p{Zp}]/u;

function validateEmail(s) {
  if (typeof s !== 'string') return { ok: false, error: 'Informe o e-mail.' };
  const value = s.trim().toLowerCase();
  if (value.length === 0) return { ok: false, error: 'Informe o e-mail.' };
  if (value.length > EMAIL_MAX) return { ok: false, error: 'E-mail longo demais.' };
  if (CONTROL_RE.test(value) || !EMAIL_RE.test(value)
    || value.includes('..') || value.split('@')[1].startsWith('.') || value.endsWith('.')) {
    return { ok: false, error: 'E-mail inválido.' };
  }
  return { ok: true, value };
}

function validatePassword(s) {
  if (typeof s !== 'string') return { ok: false, error: 'Informe a senha.' };
  if ([...s].length < PASSWORD_MIN) {
    return { ok: false, error: `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.` };
  }
  if (new TextEncoder().encode(s).length > PASSWORD_MAX) {
    return { ok: false, error: `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.` };
  }
  const chars = [...s];
  if (chars.every((c) => c === chars[0])) {
    return { ok: false, error: 'Escolha uma senha menos previsível.' };
  }
  if (COMMON_PASSWORDS.includes(s.toLowerCase())) {
    return { ok: false, error: 'Essa senha é muito comum. Escolha outra.' };
  }
  return { ok: true };
}

function validateDisplayName(s) {
  if (typeof s !== 'string') return { ok: false, error: 'Informe o apelido.' };
  const value = s.trim();
  const len = [...value].length;
  if (len < NAME_MIN || len > NAME_MAX) {
    return { ok: false, error: `O apelido deve ter de ${NAME_MIN} a ${NAME_MAX} caracteres.` };
  }
  if (CONTROL_RE.test(value) || /[<>]/.test(value)) {
    return { ok: false, error: 'O apelido tem caracteres não permitidos.' };
  }
  return { ok: true, value };
}

function validateVisibility(v) {
  if (typeof v === 'string' && MMR_VISIBILITY.includes(v)) return { ok: true, value: v };
  return { ok: false, error: 'Opção de privacidade inválida.' };
}

module.exports = {
  validateEmail, validatePassword, validateDisplayName, validateVisibility,
  MMR_VISIBILITY, PASSWORD_MIN, PASSWORD_MAX, EMAIL_MAX,
};
