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
  path.join(RENDERER, 'dnd.js'),
  path.join(RENDERER, 'theme-boot.js'),
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
  const { RENDERER_CSS, RENDERER_JS, RENDERER_HEAD_JS, RENDERER_ASSETS } = require('../../scripts/build-preview');
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([a-z/0-9-]+\.(?:js|css|svg|png))"/g)].map((m) => m[1]).filter((r) => !r.startsWith('vendor/'));
  const listed = [...RENDERER_CSS, ...RENDERER_HEAD_JS, ...RENDERER_JS, 'app.js', ...RENDERER_ASSETS];
  for (const r of refs) assert.ok(listed.includes(r), r + ' fora da lista do build');
  for (const a of RENDERER_ASSETS) assert.ok(fs.existsSync(path.join(RENDERER, a)), a + ' não existe');
  const netlify = fs.readFileSync(path.join(ROOT, 'scripts', 'build-netlify.js'), 'utf8');
  assert.match(netlify, /require\('\.\/build-preview'\)/);
  assert.doesNotMatch(netlify, /unsafe-inline/);
});

/* ---------------- Etapa 7 — LUMENEX ---------------- */

test('marca LUMENEX: título, ícone, símbolo e nada da marca antiga no que a pessoa vê', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  assert.match(html, /<title>LUMENEX<\/title>/);
  assert.match(html, /<link rel="icon" href="brand\/favicon-32\.png"/);
  assert.match(html, /class="rail-ghost lx-mark"/);
  const visible = (txt) => txt.replace(/window\.ghostRank|ghostRank\b|Ghost(?:UI|Shell|Chat|Settings|Voice|Look|Dnd)\b|ghostSvg|ghost-[a-z]+|rail-ghost|empty-ghost|head-ghost|user-ghost|GHOST_PATH/g, '');
  for (const f of ['index.html', 'shell.js', 'app.js', 'ui.js']) {
    const t = visible(stripComments(fs.readFileSync(path.join(RENDERER, f), 'utf8')));
    assert.doesNotMatch(t, /ghost ?rank|gostrank|gosthrank/i, f);
    assert.doesNotMatch(t, /\bghost\b/i, f + ' (Ghost)');
  }
  for (const f of ['lumenex-emblem.webp', 'lumenex-icon-128.webp', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'README.md']) assert.ok(fs.existsSync(path.join(RENDERER, 'brand', f)), f);
  assert.match(fs.readFileSync(path.join(RENDERER, 'brand', 'README.md'), 'utf8'), /oficial/i, 'arte oficial registrada');
  const man = JSON.parse(fs.readFileSync(path.join(RENDERER, 'manifest.webmanifest'), 'utf8'));
  assert.equal(man.name, 'LUMENEX');
  assert.equal(man.short_name, 'LUMENEX');
  assert.equal(man.background_color, '#000000');
  for (const ic of man.icons) assert.ok(fs.existsSync(path.join(RENDERER, ic.src)), ic.src);
});

test('tema Meia-Noite (AMOLED) com as cores pedidas e sem flash ao abrir', () => {
  const css = fs.readFileSync(path.join(RENDERER, 'styles.css'), 'utf8');
  const mid = /\[data-theme="midnight"\]\s*\{([^}]*)\}/.exec(css)[1];
  assert.match(mid, /--bg:\s*#000000/);
  assert.match(mid, /--surface:\s*#0a0a0a/i);
  assert.match(mid, /--surface-2:\s*#121212/);
  assert.match(mid, /--main-bg:\s*#000000/);
  assert.match(css, /\[data-theme="light"\]\s*\{/);
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const boot = html.indexOf('<script src="theme-boot.js"></script>');
  assert.ok(boot > 0 && boot < html.indexOf('<link rel="stylesheet"') && boot < html.indexOf('</head>'), 'theme-boot no <head> antes do CSS');
  const bootJs = fs.readFileSync(path.join(RENDERER, 'theme-boot.js'), 'utf8');
  assert.match(bootJs, /localStorage\.getItem\('lumenex-theme'\)/);
  assert.match(bootJs, /'dark' \|\| t === 'midnight' \|\| t === 'light'|t === 'dark' \|\| t === 'midnight' \|\| t === 'light'/);
  const shell = fs.readFileSync(path.join(RENDERER, 'shell.js'), 'utf8');
  assert.match(shell, /localStorage\.setItem\('lumenex-theme', theme\)/);
  assert.match(css, /html \{[^}]*background: var\(--rail-bg\)/, 'html pinta o fundo do tema antes do body');
});

test('arrastar e soltar: só ADM, sem setas/botões de mover, com toque prolongado e Esc', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const dnd = html.indexOf('<script src="dnd.js"></script>');
  assert.ok(dnd > 0 && dnd < html.indexOf('<script src="settings.js"></script>') && dnd < html.indexOf('<script src="shell.js"></script>'));
  const shell = stripComments(fs.readFileSync(path.join(RENDERER, 'shell.js'), 'utf8'));
  // todo data-dnd nasce dentro de um teste de ADM
  const sets = shell.match(/[^\n]*\.dataset\.dnd = [^\n]*/g) || [];
  assert.ok(sets.length >= 3, 'canal, categoria e participante');
  for (const line of sets) assert.match(line, /isAdmin\(\)|canMoveMember\(/, line.trim());
  assert.match(shell, /function canMoveMember\(userId\) \{\s*if \(!isAdmin\(\)\) return false;/);
  assert.match(shell, /enabled: function \(\) \{ return isAdmin\(\)/);
  assert.match(shell, /act\('reorderChannels'/);
  assert.match(shell, /act\('moveVoiceMember'/);
  assert.doesNotMatch(shell, /Mover para cima|Mover para baixo|arrowUp|arrowDown|chevronUp/, 'sem setas de subir/descer');
  const js = stripComments(fs.readFileSync(path.join(RENDERER, 'dnd.js'), 'utf8'));
  assert.match(js, /longPressMs \|\| 450/);
  assert.match(js, /ev\.key === 'Escape'/);
  assert.match(js, /addEventListener\('touchmove', onTouchMove, \{ capture: true, passive: false \}\)/);
  assert.match(js, /pointerType !== 'mouse'/);
  const css = fs.readFileSync(path.join(RENDERER, 'styles.css'), 'utf8');
  assert.match(css, /\.ch-li\.dnd-before::before/);
  assert.doesNotMatch(css, /\[data-dnd\][^{]*\{[^}]*cursor:\s*grab\b/, 'sem cursor de arrastar fora do arrasto');
});

test('GhostDnd.moveInList reordena antes/depois/começo/fim', () => {
  const vm = require('node:vm');
  const ctx = { window: {}, document: {}, navigator: {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(RENDERER, 'dnd.js'), 'utf8'), ctx);
  const m = ctx.window.GhostDnd.moveInList;
  assert.deepEqual([...m(['a', 'b', 'c', 'd'], 'd', 'b', 'before')], ['a', 'd', 'b', 'c']);
  assert.deepEqual([...m(['a', 'b', 'c', 'd'], 'a', 'c', 'after')], ['b', 'c', 'a', 'd']);
  assert.deepEqual([...m(['a', 'b', 'c'], 'c', null, 'start')], ['c', 'a', 'b']);
  assert.deepEqual([...m(['a', 'b', 'c'], 'a', null, 'end')], ['b', 'c', 'a']);
  assert.deepEqual([...m(['a', 'b'], 'x', null, 'end')], ['a', 'b', 'x'], 'vindo de outra categoria');
});

test('a prévia simula a ponte da Etapa 7 (fotos de 40 MB, aparência, arrastar)', () => {
  const js = fs.readFileSync(path.join(PREVIEW, 'mock-bridge.js'), 'utf8');
  for (const name of ['uploadAvatar', 'uploadBanner', 'removeAvatar', 'removeBanner', 'updateProfileLook', 'resetProfileLook', 'reorderChannels', 'moveVoiceMember']) {
    assert.match(js, new RegExp('\\b' + name + ': function'), name);
  }
  assert.match(js, /var MAX_MEDIA = 41943040;/, '40 MB exatos');
  assert.match(js, /size > MAX_MEDIA/, 'mais de 40 MB recusa');
  assert.match(js, /v\.uploads = /);
  assert.match(js, /v\.voiceMove = /);
  for (const sc of ['look', 'midnight', 'admin_drag']) assert.match(js, new RegExp('\\b' + sc + ': 1'), sc);
});

test('avatares das listas usam a miniatura; o original só no cartão grande', () => {
  const ui = stripComments(fs.readFileSync(path.join(RENDERER, 'ui.js'), 'utf8'));
  assert.match(ui, /function avatarSrc\(user, size\)/);
  assert.match(ui, /if \(size === 'lg'\) return safeImageUrl\(user\.avatarUrl\)/);
  assert.match(ui, /safeImageUrl\(user\.avatarThumbUrl\) \|\| \(user\.animatedAvatar \? null : safeImageUrl\(user\.avatarUrl\)\)/);
  assert.match(ui, /window\.GhostLook && typeof window\.GhostLook\.avatar === 'function'/);
});
