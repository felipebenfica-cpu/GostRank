'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../scripts/build-preview');

test('preview/index.html está em dia com src/renderer/index.html', () => {
  const current = fs.readFileSync(path.join(__dirname, '..', '..', 'preview', 'index.html'), 'utf8');
  assert.equal(current, build(), 'rode: node scripts/build-preview.js');
});

test('a tela não usa estilo inline, handlers inline nem innerHTML', () => {
  const root = path.join(__dirname, '..', '..', 'src', 'renderer');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs
    .readFileSync(path.join(root, 'app.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /<style[\s>]/i);
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
});
