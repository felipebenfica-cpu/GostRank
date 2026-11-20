'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 5 * 1024 * 1024;
const ENC_HEADER = Buffer.from('GR1E', 'latin1');
const PLAIN_HEADER = Buffer.from('GR1P\n', 'latin1');

function createStore({ filePath, encryptor = null } = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('filePath obrigatório');

  function quarantine() {
    try {
      fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch {
      // se não der para renomear, segue como se não houvesse dados
    }
  }

  function load() {
    let buf;
    try {
      const st = fs.statSync(filePath);
      if (!st.isFile()) return null;
      if (st.size > MAX_BYTES) {
        quarantine();
        return null;
      }
      buf = fs.readFileSync(filePath);
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      return null;
    }
    try {
      let text;
      if (buf.subarray(0, ENC_HEADER.length).equals(ENC_HEADER)) {
        if (!encryptor || !encryptor.isAvailable()) throw new Error('sem cifra');
        text = encryptor.decrypt(buf.subarray(ENC_HEADER.length));
      } else if (buf.subarray(0, PLAIN_HEADER.length).equals(PLAIN_HEADER)) {
        text = buf.subarray(PLAIN_HEADER.length).toString('utf8');
      } else {
        throw new Error('cabeçalho desconhecido');
      }
      const obj = JSON.parse(text);
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('formato');
      return obj;
    } catch {
      quarantine();
      return null;
    }
  }

  function save(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new TypeError('Só objetos podem ser salvos');
    }
    const json = JSON.stringify(obj);
    let data;
    if (encryptor && encryptor.isAvailable()) {
      data = Buffer.concat([ENC_HEADER, Buffer.from(encryptor.encrypt(json))]);
    } else {
      data = Buffer.concat([PLAIN_HEADER, Buffer.from(json, 'utf8')]);
    }
    if (data.length > MAX_BYTES) throw new Error('Dados grandes demais para salvar');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, data, { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, filePath);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignora */ }
      throw err;
    }
  }

  function clear() {
    fs.rmSync(filePath, { force: true });
  }

  return { load, save, clear };
}

module.exports = { createStore, MAX_BYTES };
