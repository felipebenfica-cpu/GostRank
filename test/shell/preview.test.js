'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../scripts/build-preview');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PREVIEW = path.join(ROOT, 'preview');

function stripComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SCRIPTS = [
  path.join(RENDERER, 'app.js'),
  path.join(RENDERER, 'ui.js'),
  path.join(RENDERER, 'shell.js'),
  path.join(RENDERER, 'voice.js'),
  path.join(RENDERER, 'chat.js'),
  path.join(RENDERER, 'settings.js'),
  path.join(RENDERER, 'emoji-data.js'),
  path.join(PREVIEW, 'mock-bridge.js'),
  path.join(PREVIEW, 'fake-livekit.js'),
];

test('preview/index.html está em dia com src/renderer/index.html', () => {
  const current = fs.readFileSync(path.join(PREVIEW, 'index.html'), 'utf8');
  assert.equal(current, build(), 'rode: node scripts/build-preview.js');
});

test('a tela não usa estilo inline, handlers inline nem innerHTML', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /<style[\s>]/i);
  for (const file of SCRIPTS) {
    const js = stripComments(fs.readFileSync(file, 'utf8'));
    assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, path.basename(file));
    assert.doesNotMatch(js, /setAttribute\(\s*['"](style|on[a-z]+)['"]/i, path.basename(file));
  }
});

test('a tela carrega o LiveKit local, a voz e o app nessa ordem', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const vendor = html.indexOf('<script src="vendor/livekit-client.umd.js"></script>');
  const voice = html.indexOf('<script src="voice.js"></script>');
  const app = html.indexOf('<script src="app.js"></script>');
  assert.ok(vendor > 0 && vendor < voice && voice < app);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i, 'nada de CDN');
});

test('a prévia troca o LiveKit pelo falso local e não usa rede nem fontes externas', () => {
  const html = build();
  assert.match(html, /<script src="fake-livekit\.js"><\/script>/);
  assert.match(html, /<script src="\.\.\/src\/renderer\/voice\.js"><\/script>/);
  assert.doesNotMatch(html, /vendor\/livekit/);
  assert.match(html, /connect-src 'none'/);
  for (const file of [path.join(PREVIEW, 'mock-bridge.js'), path.join(PREVIEW, 'fake-livekit.js')]) {
    const js = stripComments(fs.readFileSync(file, 'utf8'));
    assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|new WebSocket|EventSource|sendBeacon|importScripts/, path.basename(file));
  }
  for (const name of ['styles.css', 'voice.css']) {
    const file = path.join(RENDERER, name);
    if (!fs.existsSync(file)) continue; // voice.css chega com a sala de voz nova
    const css = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i, name);
  }
});

test('a tela carrega voice.css depois de styles.css e a prévia aponta para src/renderer', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const styles = html.indexOf('<link rel="stylesheet" href="styles.css">');
  const voice = html.indexOf('<link rel="stylesheet" href="voice.css">');
  assert.ok(styles > 0 && styles < voice);
  const preview = build();
  assert.match(preview, /href="\.\.\/src\/renderer\/styles\.css"/);
  assert.match(preview, /href="\.\.\/src\/renderer\/voice\.css"/);
});

test('a janela tem os contêineres da voz, do chat e a navegação acessível', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  for (const id of ['voice-stage', 'voice-connection', 'voice-user-controls', 'chat-root', 'rail-servers', 'channel-tree', 'dm-list', 'friends-tabs', 'members', 'popout-layer', 'toast-region', 'dlg-server', 'dlg-invite', 'dlg-quick']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  assert.match(html, /<nav class="rail" aria-label=/);
  assert.match(html, /<nav class="sidebar-scroll" aria-label="Canais"/);
  assert.match(html, /<main id="conteudo"/);
  assert.match(html, /role="tablist"/);
  const shell = stripComments(fs.readFileSync(path.join(RENDERER, 'shell.js'), 'utf8'));
  assert.match(shell, /typeof gv\.init === 'function'/, 'protege a chamada da voz');
  assert.match(shell, /typeof gc\.init === 'function'/, 'protege a chamada do chat');
  assert.match(shell, /typeof gs\.init === 'function'/, 'protege a chamada das configurações');
  assert.match(shell, /aria-current/);
});

test('a tela carrega os módulos antes da casca e do app', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const order = ['ui.js', 'emoji-data.js', 'chat.js', 'settings.js', 'voice.js', 'shell.js', 'app.js'].map((n) => html.indexOf('<script src="' + n + '"></script>'));
  order.forEach((i, k) => assert.ok(i > 0, 'script ' + k));
  for (let k = 1; k < order.length; k++) assert.ok(order[k - 1] < order[k], 'ordem dos scripts');
  for (const css of ['chat.css', 'settings.css']) assert.match(html, new RegExp('href="' + css.replace('.', '\\.') + '"'));
});

test('a prévia simula a ponte completa da Etapa 6', () => {
  const js = fs.readFileSync(path.join(PREVIEW, 'mock-bridge.js'), 'utf8');
  for (const name of ['select', 'searchUsers', 'sendFriendRequest', 'acceptFriend', 'declineFriend', 'removeFriend', 'blockUser', 'unblockUser', 'openDm',
    'setStatus', 'setCustomStatus', 'createServer', 'previewInvite', 'joinServer', 'leaveServer', 'deleteServer', 'updateServer', 'createInvite', 'listInvites',
    'revokeInvite', 'setMemberRole', 'transferOwnership', 'kickMember', 'banMember', 'unbanMember', 'listBans', 'setNickname', 'createCategory', 'updateCategory',
    'deleteCategory', 'createChannel', 'updateChannel', 'deleteChannel', 'sendMessage', 'editMessage', 'deleteMessage', 'toggleReaction', 'pinMessage', 'listPinned',
    'loadOlder', 'markRead', 'searchMessages', 'setTyping', 'openExternal', 'updatePrefs', 'muteTarget', 'voiceToken', 'setVoiceState', 'uploadAvatar', 'removeAvatar',
    'uploadServerIcon', 'markTargetRead', 'retryMessage', 'onNotificationClick']) {
    assert.match(js, new RegExp('\\b' + name + ': function'), name);
  }
});

test('miniaturas de tela só entram se forem data:image/', () => {
  const js = stripComments(fs.readFileSync(path.join(RENDERER, 'voice.js'), 'utf8'));
  assert.match(js, /indexOf\('data:image\/'\) === 0/);
  const assigns = js.match(/\.src\s*=/g) || [];
  assert.equal(assigns.length, 1, 'só um lugar define src (a miniatura validada)');
});

test('a prévia simula todo método que o preload expõe', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.js'), 'utf8');
  const mock = fs.readFileSync(path.join(PREVIEW, 'mock-bridge.js'), 'utf8');
  const names = [...preload.matchAll(/^\s{2}([a-zA-Z]+):\s*\(/gm)].map((m) => m[1]);
  assert.ok(names.length > 40, 'preload com a ponte da Etapa 6');
  const missing = names.filter((n) => !new RegExp('\\b' + n + ': function').test(mock));
  assert.deepEqual(missing, [], 'métodos do preload sem simulação na prévia');
});

test('o trilho rola na vertical sem cortar as dicas (dica flutuante fora do trilho)', () => {
  const css = fs.readFileSync(path.join(RENDERER, 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /\.rail-btn\[data-tip\]::after/);
  assert.match(css, /\.rail-tip\s*\{[^}]*position:\s*fixed/);
  const rail = /\.rail\s*\{([^}]*)\}/.exec(css)[1];
  assert.match(rail, /overflow-x:\s*hidden/);
  assert.match(fs.readFileSync(path.join(RENDERER, 'shell.js'), 'utf8'), /function initRailTips\(/);
});

test('o build do Netlify leva todo arquivo que a página carrega', () => {
  const { RENDERER_CSS, RENDERER_JS } = require('../../scripts/build-preview');
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([a-z-]+\.(?:js|css))"/g)].map((m) => m[1]);
  for (const r of refs) assert.ok([...RENDERER_CSS, ...RENDERER_JS, 'app.js'].includes(r), r + ' fora da lista do build');
  const netlify = fs.readFileSync(path.join(ROOT, 'scripts', 'build-netlify.js'), 'utf8');
  assert.match(netlify, /require\('\.\/build-preview'\)/);
  assert.doesNotMatch(netlify, /unsafe-inline/);
});
