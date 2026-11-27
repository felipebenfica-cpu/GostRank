'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../src/web/auth-return.js'), 'utf8');

function page(pathname, search, hash, answer = {}) {
  const elements = new Map();
  for (const id of ['title', 'status', 'verify', 'password-form', 'password', 'password-again', 'save']) {
    elements.set(id, { hidden: id === 'verify' || id === 'password-form', value: '',
      addEventListener(event, fn) { this[event] = fn; }, reset() { elements.get('password').value = ''; elements.get('password-again').value = ''; } });
  }
  const calls = [];
  const replaced = [];
  const context = {
    location: { pathname, search, hash }, history: { replaceState: (...args) => replaced.push(args) },
    document: { getElementById: (id) => elements.get(id) }, URLSearchParams,
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: answer.ok !== false, json: async () => answer.body || {} }; },
  };
  vm.runInNewContext(script, context);
  return { elements, calls, replaced, el: (id) => elements.get(id) };
}

test('link com token_hash espera clique humano e limpa a URL antes de validar', async () => {
  const p = page('/reset-password', '', '#token_hash=secreto&type=recovery', { body: { access_token: 'access' } });
  assert.equal(p.replaced[0][2], '/reset-password');
  assert.equal(p.calls.length, 0);
  assert.equal(p.el('verify').hidden, false);
  await p.el('verify').click();
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].url.endsWith('/verify'), true);
  assert.equal(p.calls[0].options.body.includes('secreto'), true);
  assert.equal(p.el('password-form').hidden, false);
});

test('erro otp_expired não valida token nem mostra formulário', () => {
  const p = page('/reset-password', '', '#error=access_denied&error_code=otp_expired');
  assert.equal(p.calls.length, 0);
  assert.match(p.el('status').textContent, /expirado/);
  assert.equal(p.el('password-form').hidden, true);
  assert.equal(p.replaced[0][2], '/reset-password');
});

test('sessão de recuperação exige tipo correto e valida o token com o servidor', async () => {
  const wrong = page('/reset-password', '', '#access_token=a&refresh_token=r&type=signup');
  assert.equal(wrong.calls.length, 0);
  assert.equal(wrong.el('password-form').hidden, true);
  const valid = page('/reset-password', '', '#access_token=a&refresh_token=r&type=recovery');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(valid.calls[0].url.endsWith('/user'), true);
  assert.equal(valid.el('password-form').hidden, false);
  assert.equal(valid.replaced[0][2], '/reset-password');
});
