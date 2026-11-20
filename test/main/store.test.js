'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, MAX_BYTES } = require('../../src/main/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gr-store-'));
const fakeEnc = (available = true) => ({
  isAvailable: () => available,
  encrypt: (s) => Buffer.from(s, 'utf8').reverse(),
  decrypt: (b) => Buffer.from(b).reverse().toString('utf8'),
});

test('arquivo ausente -> null', () => {
  const s = createStore({ filePath: path.join(tmp(), 'd.bin') });
  assert.equal(s.load(), null);
});

test('salva e carrega em texto puro com cabeçalho GR1P', () => {
  const file = path.join(tmp(), 'd.bin');
  const s = createStore({ filePath: file });
  s.save({ a: 1, nome: 'ção' });
  assert.ok(fs.readFileSync(file).subarray(0, 5).equals(Buffer.from('GR1P\n')));
  assert.deepEqual(s.load(), { a: 1, nome: 'ção' });
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1);
});

test('permissão 0600', { skip: process.platform === 'win32' }, () => {
  const file = path.join(tmp(), 'd.bin');
  createStore({ filePath: file }).save({ a: 1 });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('com encryptor: cabeçalho GR1E e conteúdo não legível', () => {
  const file = path.join(tmp(), 'd.bin');
  const s = createStore({ filePath: file, encryptor: fakeEnc() });
  s.save({ segredo: 'xyz' });
  const raw = fs.readFileSync(file);
  assert.ok(raw.subarray(0, 4).equals(Buffer.from('GR1E')));
  assert.ok(!raw.toString('utf8').includes('segredo'));
  assert.deepEqual(s.load(), { segredo: 'xyz' });
});

test('encryptor indisponível grava texto puro; leitura de GR1P funciona com encryptor', () => {
  const file = path.join(tmp(), 'd.bin');
  createStore({ filePath: file, encryptor: fakeEnc(false) }).save({ a: 2 });
  assert.ok(fs.readFileSync(file).subarray(0, 5).equals(Buffer.from('GR1P\n')));
  assert.deepEqual(createStore({ filePath: file, encryptor: fakeEnc() }).load(), { a: 2 });
});

test('arquivo cifrado sem encryptor vira corrompido', () => {
  const file = path.join(tmp(), 'd.bin');
  createStore({ filePath: file, encryptor: fakeEnc() }).save({ a: 1 });
  assert.equal(createStore({ filePath: file }).load(), null);
  assert.ok(fs.readdirSync(path.dirname(file)).some((n) => n.includes('.corrupt-')));
});

test('corrupção: JSON inválido, cabeçalho desconhecido e decrypt falho', () => {
  const cases = [
    Buffer.from('GR1P\n{nao json'),
    Buffer.from('lixo qualquer'),
    Buffer.from('GR1P\n[1,2]'),
    Buffer.concat([Buffer.from('GR1E'), Buffer.from('bytes ruins')]),
  ];
  for (const content of cases) {
    const dir = tmp();
    const file = path.join(dir, 'd.bin');
    fs.writeFileSync(file, content);
    const enc = { isAvailable: () => true, encrypt: (s) => Buffer.from(s), decrypt: () => { throw new Error('falhou'); } };
    const s = createStore({ filePath: file, encryptor: enc });
    assert.equal(s.load(), null);
    assert.ok(!fs.existsSync(file));
    const names = fs.readdirSync(dir);
    assert.equal(names.length, 1);
    assert.match(names[0], /^d\.bin\.corrupt-\d+$/);
    assert.equal(s.load(), null);
  }
});

test('limite de 5 MB na leitura e na escrita', () => {
  const dir = tmp();
  const file = path.join(dir, 'd.bin');
  fs.writeFileSync(file, Buffer.alloc(MAX_BYTES + 1, 65));
  const s = createStore({ filePath: file });
  assert.equal(s.load(), null);
  assert.ok(fs.readdirSync(dir).some((n) => n.includes('.corrupt-')));
  assert.throws(() => s.save({ x: 'a'.repeat(MAX_BYTES) }));
  assert.ok(!fs.existsSync(file));
});

test('clear apaga e é idempotente; save recusa não-objetos', () => {
  const file = path.join(tmp(), 'd.bin');
  const s = createStore({ filePath: file });
  s.save({ a: 1 });
  s.clear();
  assert.equal(s.load(), null);
  s.clear();
  assert.throws(() => s.save('x'), TypeError);
  assert.throws(() => s.save([1]), TypeError);
});

test('save sobrescreve com segurança e cria diretório', () => {
  const file = path.join(tmp(), 'sub', 'dir', 'd.bin');
  const s = createStore({ filePath: file });
  s.save({ v: 1 });
  s.save({ v: 2 });
  assert.deepEqual(s.load(), { v: 2 });
});
