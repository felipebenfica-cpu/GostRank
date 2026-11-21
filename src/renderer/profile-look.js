/* LUMENEX — Personalização do perfil (Etapa 7, frente LOOK).
   Avatares com recorte e miniatura, banners, 8 molduras e 8 efeitos de cartão, e o editor
   "Configurações → Personalização do Perfil".
   API: GhostLook.avatar(user, opts) · banner(user, opts) · profileCard(user, opts)
        mountCardEffect(cardEl, user) → { replay(), destroy() }
        renderEditor(container, { bridge, getView, onDirtyChange }) → { update(view), isDirty(), nudge(), destroy() }
        FRAMES · EFFECTS · validateImageFile(file) · MAX_IMAGE_BYTES
   Regras: sem innerHTML, sem style="" (estilos dinâmicos só por CSSOM), nada fora do perfil/cartão,
   prefers-reduced-motion respeitado, animações pausadas fora da tela. */
(function () {
  'use strict';

  var FRAMES = [
    { id: 'gold', label: 'Energia dourada' },
    { id: 'fire', label: 'Fogo e brasas' },
    { id: 'lightning', label: 'Relâmpagos' },
    { id: 'arcane', label: 'Magia arcana' },
    { id: 'shadow', label: 'Sombras' },
    { id: 'ice', label: 'Gelo' },
    { id: 'red', label: 'Energia vermelha' },
    { id: 'particles', label: 'Partículas luminosas' },
  ];
  var EFFECTS = [
    { id: 'burst', label: 'Explosão de luz' },
    { id: 'flames', label: 'Chamas ascendentes' },
    { id: 'sparks', label: 'Raios elétricos' },
    { id: 'magic', label: 'Partículas mágicas' },
    { id: 'mist', label: 'Névoa sombria' },
    { id: 'crystal', label: 'Fragmentos de cristal' },
    { id: 'waves', label: 'Ondas de energia' },
    { id: 'pulse', label: 'Pulso luminoso' },
  ];
  var FRAME_IDS = FRAMES.map(function (f) { return f.id; });
  var EFFECT_IDS = EFFECTS.map(function (f) { return f.id; });
  var MAX_IMAGE_BYTES = 41943040;   // 40 MB exatos são aceitos
  var MAX_THUMB_BYTES = 524288;     // 512 KB
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  function h(tag, cls, attrs, kids) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v === null || v === undefined) return;
      if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function s(tag, attrs, kids) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
    (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function clamp(v, a, b) { v = Number(v); if (!isFinite(v)) v = a; return Math.max(a, Math.min(b, v)); }
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function initial(u) {
    var n = String((u && (u.displayName || u.username || u.name)) || '?').trim();
    var ch = Array.from ? Array.from(n)[0] : n.charAt(0);
    return (ch || '?').toUpperCase();
  }
  function colorOf(u) { return Number.isInteger(u && u.avatarColor) ? clamp(u.avatarColor, 0, 7) : 0; }
  function validFrame(id) { return FRAME_IDS.indexOf(id) >= 0 ? id : null; }
  function validEffect(id) { return EFFECT_IDS.indexOf(id) >= 0 ? id : null; }
  function normCrop(c) {
    if (!c || typeof c !== 'object') return { x: 50, y: 50, zoom: 1 };
    return { x: clamp(c.x, 0, 100), y: clamp(c.y, 0, 100), zoom: clamp(c.zoom, 1, 3) };
  }
  function isDefaultCrop(c) { var n = normCrop(c); return n.x === 50 && n.y === 50 && n.zoom === 1; }
  function sameJson(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } }
  function fmtMB(bytes) {
    var mb = bytes / 1048576;
    return (mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10).toString().replace('.', ',') + ' MB';
  }

  /** Recorte por ponto focal + zoom, sem recodificar a imagem (preserva GIF/WebP animado). */
  function applyCrop(img, crop) {
    var c = normCrop(crop);
    img.style.objectPosition = c.x + '% ' + c.y + '%';
    img.style.transformOrigin = c.x + '% ' + c.y + '%';
    img.style.transform = c.zoom > 1 ? 'scale(' + c.zoom + ')' : '';
  }

  // ---------------------------------------------------------------------------
  // Avatar com moldura
  // ---------------------------------------------------------------------------
  /* Camadas de cada moldura. Tudo é desenhado pelo CSS (profile-look.css) a partir destas peças;
     as animações usam só transform/opacity (compositor). */
  function frameLayers(id, frame) {
    function add(cls, n) { for (var i = 0; i < (n || 1); i++) frame.appendChild(h('span', cls + (n > 1 ? ' gl-i' + i : ''))); }
    switch (id) {
      case 'gold':
        add('gl-l gl-glow'); add('gl-l gl-ring'); add('gl-l gl-sweep');
        for (var g = 0; g < 3; g++) frame.appendChild(h('span', 'gl-l gl-orbit gl-i' + g, null, [h('span', 'gl-spark')]));
        break;
      case 'fire':
        add('gl-l gl-glow'); add('gl-l gl-ring'); add('gl-l gl-flame', 7); add('gl-l gl-ember', 6);
        break;
      case 'lightning': {
        add('gl-l gl-glow'); add('gl-l gl-ring');
        var bolts = s('svg', { class: 'gl-l gl-svg gl-bolts', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
        [
          'M18 30 L26 36 L22 38 L31 47', 'M80 22 L73 31 L78 32 L70 41',
          'M86 70 L77 66 L79 72 L69 68', 'M24 82 L31 74 L26 73 L35 66',
        ].forEach(function (d, i) {
          bolts.appendChild(s('path', { d: d, class: 'gl-bolt gl-i' + i }));
        });
        frame.appendChild(bolts);
        add('gl-l gl-arc');
        break;
      }
      case 'arcane': {
        add('gl-l gl-glow');
        var runes = s('svg', { class: 'gl-l gl-svg gl-runes', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
        runes.appendChild(s('circle', { cx: 50, cy: 50, r: 47, class: 'gl-rune-ring' }));
        runes.appendChild(s('circle', { cx: 50, cy: 50, r: 43.5, class: 'gl-rune-dash' }));
        for (var r = 0; r < 12; r++) {
          var a = (r / 12) * Math.PI * 2;
          var x = 50 + Math.cos(a) * 45.2;
          var y = 50 + Math.sin(a) * 45.2;
          var deg = (a * 180 / Math.PI) + 90;
          var glyph = r % 3 === 0 ? 'M-2 -2 L2 2 M2 -2 L-2 2' : (r % 3 === 1 ? 'M0 -2.4 L0 2.4 M-1.8 -0.6 L1.8 -0.6' : 'M-2 2 L0 -2.2 L2 2');
          runes.appendChild(s('path', { d: glyph, transform: 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ') rotate(' + deg.toFixed(1) + ')', class: 'gl-glyph' }));
        }
        frame.appendChild(runes);
        var inner = s('svg', { class: 'gl-l gl-svg gl-runes-in', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
        inner.appendChild(s('circle', { cx: 50, cy: 50, r: 40.5, class: 'gl-rune-thin' }));
        for (var t = 0; t < 3; t++) {
          var ta = (t / 3) * Math.PI * 2 - Math.PI / 2;
          inner.appendChild(s('circle', { cx: (50 + Math.cos(ta) * 40.5).toFixed(2), cy: (50 + Math.sin(ta) * 40.5).toFixed(2), r: 1.8, class: 'gl-rune-node' }));
        }
        frame.appendChild(inner);
        break;
      }
      case 'shadow':
        add('gl-l gl-wisp', 5); add('gl-l gl-ring');
        break;
      case 'ice': {
        add('gl-l gl-glow'); add('gl-l gl-ring');
        var spikes = s('svg', { class: 'gl-l gl-svg gl-crystals', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
        for (var k = 0; k < 10; k++) {
          var ka = (k / 10) * Math.PI * 2 + 0.18;
          var len = k % 2 ? 7 : 11;
          var bx = 50 + Math.cos(ka) * 41;
          var by = 50 + Math.sin(ka) * 41;
          var deg2 = ka * 180 / Math.PI;
          spikes.appendChild(s('path', {
            d: 'M0 -2.2 L' + len + ' 0 L0 2.2 Z',
            transform: 'translate(' + bx.toFixed(2) + ' ' + by.toFixed(2) + ') rotate(' + deg2.toFixed(1) + ')',
            class: 'gl-crystal gl-i' + (k % 5),
          }));
        }
        frame.appendChild(spikes);
        add('gl-l gl-sheen');
        break;
      }
      case 'red':
        add('gl-l gl-pulse', 2); add('gl-l gl-glow'); add('gl-l gl-ring'); add('gl-l gl-ring2');
        break;
      case 'particles':
        add('gl-l gl-glow'); add('gl-l gl-ring');
        for (var p = 0; p < 8; p++) frame.appendChild(h('span', 'gl-l gl-orbit gl-i' + p, null, [h('span', 'gl-dot')]));
        break;
      default: break;
    }
  }

  function makeFrame(id, small) {
    var frame = h('span', 'gl-frame', { 'data-frame': id, 'aria-hidden': 'true' });
    if (small) frame.classList.add('is-small');
    else frameLayers(id, frame);
    return frame;
  }

  /**
   * opts: { size: px (16..160), animate: 'never'|'hover'|'always', frame: bool (padrão true),
   *         status?: 'online'|'idle'|'dnd'|'offline', label?: texto acessível, crop?: sobrescreve, src?: sobrescreve }
   * Listas: animate 'never'/'hover' usam a miniatura estática; o original animado só carrega quando precisa.
   */
  function avatar(user, opts) {
    var u = user || {};
    var o = opts || {};
    var size = clamp(o.size || 40, 16, 200);
    var small = size <= 32;
    var anim = o.animate === 'always' || o.animate === 'hover' ? o.animate : 'never';
    var el = h('span', 'gl-av' + (small ? ' is-small' : ''), { 'data-c': colorOf(u) });
    el.style.setProperty('--gl-size', size + 'px');
    if (o.label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', o.label); } else el.setAttribute('aria-hidden', 'true');
    var clip = h('span', 'gl-av-clip');
    el.appendChild(clip);

    var original = o.src || u.avatarUrl || null;
    var thumb = o.src ? null : (u.avatarThumbUrl || null);
    var animated = Boolean(u.animatedAvatar) && !o.src;
    var crop = o.crop || u.avatarCrop;
    var initialSpan = h('span', 'gl-av-initial', { text: initial(u) });

    function srcFor(wantAnim) {
      if (wantAnim && original) return original;
      if (thumb) return thumb;
      return original;      // sem miniatura (dado antigo): usa o que houver
    }
    var img = null;
    var first = srcFor(anim === 'always');
    if (first) {
      img = h('img', 'gl-av-img', { alt: '', draggable: 'false', decoding: 'async', loading: anim === 'always' ? 'eager' : 'lazy' });
      img.addEventListener('error', function () {
        if (img.getAttribute('src') !== thumb && thumb) { img.src = thumb; return; }
        if (img.parentNode) img.parentNode.replaceChild(initialSpan, img);
      });
      img.src = first;
      applyCrop(img, crop);
      clip.appendChild(img);
    } else {
      clip.appendChild(initialSpan);
    }

    if (img && anim === 'hover' && animated && original && original !== first) {
      el.classList.add('is-animatable');
      var swapIn = function () { if (img.getAttribute('src') !== original) img.src = original; };
      var swapOut = function () { if (thumb && img.getAttribute('src') !== thumb) img.src = thumb; };
      // O alvo do hover pode ser uma linha inteira (data-gl-hover), como no Discord.
      var bind = function () {
        var host = el.closest('[data-gl-hover]') || el;
        host.addEventListener('pointerenter', swapIn);
        host.addEventListener('pointerleave', swapOut);
        host.addEventListener('focusin', swapIn);
        host.addEventListener('focusout', swapOut);
      };
      if (window.requestAnimationFrame) window.requestAnimationFrame(bind); else bind();
    }

    var fid = o.frame === false ? null : validFrame(u.frame);
    if (fid) {
      el.classList.add('has-frame');
      el.setAttribute('data-frame', fid);
      el.appendChild(makeFrame(fid, small));
    }
    if (o.status) {
      var st = o.status === 'invisible' ? 'offline' : o.status;
      el.appendChild(h('span', 'gl-status', { 'data-s': st }));
    }
    return el;
  }

  /** opts: { animate: 'always'|'never' (padrão always: o banner só aparece no cartão), pos?: sobrescreve, src?: sobrescreve } */
  function banner(user, opts) {
    var u = user || {};
    var o = opts || {};
    var el = h('div', 'gl-banner', { 'data-c': colorOf(u), 'aria-hidden': 'true' });
    var url = o.src || (o.animate === 'never' ? (u.bannerThumbUrl || (u.animatedBanner ? null : u.bannerUrl)) : (u.bannerUrl || u.bannerThumbUrl)) || null;
    if (url) {
      var img = h('img', 'gl-banner-img', { alt: '', draggable: 'false', decoding: 'async' });
      img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
      img.src = url;
      img.style.objectPosition = '50% ' + clamp(o.pos !== undefined ? o.pos : (u.bannerPos !== undefined && u.bannerPos !== null ? u.bannerPos : 50), 0, 100) + '%';
      el.appendChild(img);
      el.classList.add('has-image');
    }
    return el;
  }

  var STATUS_LABEL = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', offline: 'Offline' };

  /** Cartão de perfil de referência (prévia do editor; a casca pode reaproveitar). */
  function profileCard(user, opts) {
    var u = user || {};
    var o = opts || {};
    var card = h('div', 'gl-card' + (o.compact ? ' is-compact' : ''));
    card.appendChild(banner(u, { animate: 'always', pos: o.bannerPos, src: o.bannerSrc }));
    var head = h('div', 'gl-card-head');
    var avWrap = h('span', 'gl-card-av', { 'data-gl-anchor': '' });
    var status = u.status || 'online';
    avWrap.appendChild(avatar(u, { size: o.compact ? 76 : 88, animate: 'always', frame: true, status: status, src: o.avatarSrc, crop: o.crop }));
    head.appendChild(avWrap);
    card.appendChild(head);
    var body = h('div', 'gl-card-body');
    body.appendChild(h('div', 'gl-card-name', { text: u.displayName || u.username || 'Jogador' }));
    if (u.username) body.appendChild(h('div', 'gl-card-user', { text: '@' + u.username }));
    body.appendChild(h('span', 'gl-sr', { text: 'Status: ' + (STATUS_LABEL[status] || 'Online') }));
    if (u.customStatus) body.appendChild(h('div', 'gl-card-custom', { text: u.customStatus }));
    if (u.about) {
      body.appendChild(h('div', 'gl-card-sep'));
      body.appendChild(h('div', 'gl-card-label', { text: 'Sobre mim' }));
      body.appendChild(h('p', 'gl-card-about', { text: u.about }));
    }
    card.appendChild(body);
    return card;
  }

  // ---------------------------------------------------------------------------
  // Efeitos do cartão (canvas leve, um por vez)
  // ---------------------------------------------------------------------------
  var spriteCache = {};
  function glowSprite(color, r) {
    var key = color + '|' + r;
    if (spriteCache[key]) return spriteCache[key];
    var c = document.createElement('canvas');
    c.width = c.height = r * 2;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, color);
    grd.addColorStop(0.35, color.replace(/,\s*[\d.]+\)$/, ',0.45)'));
    grd.addColorStop(1, color.replace(/,\s*[\d.]+\)$/, ',0)'));
    g.fillStyle = grd;
    g.fillRect(0, 0, r * 2, r * 2);
    spriteCache[key] = c;
    return c;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[(Math.random() * list.length) | 0]; }

  var INTRO = 2.6;      // s em intensidade total ao abrir
  var AMBIENT = 9;      // s de efeito leve depois disso; então para sozinho
  var MAX_P = 170;

  /* Cada efeito: spawn(st, n) cria partículas; draw(ctx, st, dt, t) atualiza e desenha.
     st: { W, H, ax, ay, ar, P:[] } — (ax, ay) é o centro do avatar e ar o raio. */
  var FX = {
    burst: {
      start: function (st) {
        st.flash = 0;
        st.rays = [];
        for (var i = 0; i < 16; i++) st.rays.push({ a: (i / 16) * Math.PI * 2 + rnd(-0.08, 0.08), len: rnd(0.7, 1.15) });
        this.spawn(st, 70, true);
      },
      rate: function (t) { return t < 0.2 ? 0 : (t < INTRO ? 6 : 3); },
      spawn: function (st, n, big) {
        for (var i = 0; i < n; i++) {
          var a = rnd(0, Math.PI * 2);
          var sp = big ? rnd(110, 340) : rnd(14, 40);
          var r0 = big ? st.ar * 0.6 : st.ar * rnd(1.05, 1.5);
          st.P.push({ x: st.ax + Math.cos(a) * r0, y: st.ay + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: big ? rnd(0.7, 1.5) : rnd(0.6, 1.1), age: 0, r: big ? rnd(1.6, 3.4) : rnd(1, 2.2), tw: rnd(0, 6) });
        }
      },
      draw: function (c, st, dt, t) {
        if (t < 0.9) {
          var k = t / 0.9;
          var R = st.ar * (1 + k * 3.2);
          c.globalAlpha = (1 - k) * 0.9;
          c.drawImage(glowSprite('rgba(255,214,110,1)', 64), st.ax - R, st.ay - R, R * 2, R * 2);
          c.globalAlpha = (1 - k) * 0.85;
          c.strokeStyle = 'rgba(255,236,170,1)';
          c.lineWidth = 2.2 * (1 - k) + 0.4;
          c.beginPath(); c.arc(st.ax, st.ay, st.ar * (1.05 + k * 2.6), 0, Math.PI * 2); c.stroke();
          c.lineCap = 'round';
          for (var i = 0; i < st.rays.length; i++) {
            var ry = st.rays[i];
            var r1 = st.ar * (1.15 + k * 1.2);
            var r2 = r1 + st.ar * ry.len * (0.4 + k * 1.9);
            c.globalAlpha = (1 - k) * 0.7;
            c.strokeStyle = 'rgba(255,205,90,1)';
            c.lineWidth = 2.4 * (1 - k) + 0.3;
            c.beginPath();
            c.moveTo(st.ax + Math.cos(ry.a) * r1, st.ay + Math.sin(ry.a) * r1);
            c.lineTo(st.ax + Math.cos(ry.a) * r2, st.ay + Math.sin(ry.a) * r2);
            c.stroke();
          }
        }
        var spr = glowSprite('rgba(255,210,100,1)', 16);
        for (var j = st.P.length - 1; j >= 0; j--) {
          var p = st.P[j];
          p.age += dt;
          if (p.age >= p.life) { st.P.splice(j, 1); continue; }
          var drag = Math.pow(0.12, dt);
          p.vx *= drag; p.vy *= drag;
          p.x += p.vx * dt; p.y += p.vy * dt;
          var f = 1 - p.age / p.life;
          var tw = 0.65 + 0.35 * Math.sin(p.tw + p.age * 18);
          c.globalAlpha = f * tw;
          var rr = p.r * 4;
          c.drawImage(spr, p.x - rr, p.y - rr, rr * 2, rr * 2);
        }
      },
    },

    flames: {
      start: function (st) { this.spawn(st, 26); },
      rate: function (t) { return t < INTRO ? 64 : 16; },
      spawn: function (st, n) {
        for (var i = 0; i < n; i++) {
          // Mais chamas na metade de baixo e nos lados; algumas no topo, como labaredas subindo.
          var a = Math.random() < 0.72 ? rnd(-0.15, Math.PI + 0.15) : rnd(Math.PI, Math.PI * 2);
          var r0 = st.ar * rnd(0.92, 1.08);
          st.P.push({ x: st.ax + Math.cos(a) * r0, y: st.ay + Math.sin(a) * r0, vx: rnd(-10, 10), vy: rnd(-70, -36),
            life: rnd(0.55, 1.15), age: 0, r: rnd(4, 8.5), ph: rnd(0, 6) });
        }
      },
      draw: function (c, st, dt) {
        c.globalCompositeOperation = 'lighter';
        for (var j = st.P.length - 1; j >= 0; j--) {
          var p = st.P[j];
          p.age += dt;
          if (p.age >= p.life) { st.P.splice(j, 1); continue; }
          var k = p.age / p.life;
          p.x += (p.vx + Math.sin(p.ph + p.age * 9) * 16) * dt;
          p.y += p.vy * dt;
          p.vy -= 22 * dt;
          var col = k < 0.25 ? 'rgba(255,236,160,1)' : (k < 0.55 ? 'rgba(255,150,40,1)' : 'rgba(220,48,40,1)');
          var rr = p.r * (1 - k * 0.6) * 2.2;
          c.globalAlpha = (1 - k) * 0.75;
          c.drawImage(glowSprite(col, 24), p.x - rr, p.y - rr * 1.35, rr * 2, rr * 2.7);
        }
        c.globalCompositeOperation = 'source-over';
      },
    },

    sparks: {
      start: function (st) { st.bolts = []; st.next = 0; },
      rate: function (t) { return t < INTRO ? 13 : 3; },
      spawn: function (st, n) {
        for (var i = 0; i < n; i++) {
          if (st.bolts.length > 10) break;
          var a = rnd(0, Math.PI * 2);
          var len = st.ar * rnd(0.6, 1.5);
          var pts = [];
          var steps = 6 + ((Math.random() * 3) | 0);
          var r0 = st.ar * 1.04;
          for (var k = 0; k <= steps; k++) {
            var rr = r0 + (len * k) / steps;
            var jit = k === 0 ? 0 : rnd(-0.16, 0.16);
            pts.push([st.ax + Math.cos(a + jit) * rr, st.ay + Math.sin(a + jit) * rr]);
          }
          st.bolts.push({ pts: pts, age: 0, life: rnd(0.22, 0.4) });
          // Um galho saindo do meio do raio, como descarga real.
          var mid = pts[(pts.length / 2) | 0];
          var ba = a + rnd(-0.9, 0.9);
          var bpts = [mid];
          for (var bk = 1; bk <= 3; bk++) bpts.push([mid[0] + Math.cos(ba + rnd(-0.3, 0.3)) * st.ar * 0.22 * bk, mid[1] + Math.sin(ba + rnd(-0.3, 0.3)) * st.ar * 0.22 * bk]);
          st.bolts.push({ pts: bpts, age: 0, life: rnd(0.16, 0.3) });
          for (var q = 0; q < 4; q++) {
            var e = pts[pts.length - 1];
            var sa = rnd(0, Math.PI * 2);
            st.P.push({ x: e[0], y: e[1], vx: Math.cos(sa) * rnd(40, 120), vy: Math.sin(sa) * rnd(40, 120), age: 0, life: rnd(0.2, 0.45) });
          }
        }
      },
      draw: function (c, st, dt) {
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.globalCompositeOperation = 'lighter';
        for (var b = st.bolts.length - 1; b >= 0; b--) {
          var bo = st.bolts[b];
          bo.age += dt;
          if (bo.age >= bo.life) { st.bolts.splice(b, 1); continue; }
          var f = 1 - bo.age / bo.life;
          var flick = Math.random() < 0.2 ? 0.35 : 1;
          [[7, 'rgba(90,170,255,1)', 0.22], [3, 'rgba(150,215,255,1)', 0.55], [1.3, 'rgba(255,255,255,1)', 1]].forEach(function (pass) {
            c.globalAlpha = f * flick * pass[2];
            c.strokeStyle = pass[1];
            c.lineWidth = pass[0];
            c.beginPath();
            c.moveTo(bo.pts[0][0], bo.pts[0][1]);
            for (var i = 1; i < bo.pts.length; i++) c.lineTo(bo.pts[i][0], bo.pts[i][1]);
            c.stroke();
          });
        }
        var spr = glowSprite('rgba(160,215,255,1)', 12);
        for (var j = st.P.length - 1; j >= 0; j--) {
          var p = st.P[j];
          p.age += dt;
          if (p.age >= p.life) { st.P.splice(j, 1); continue; }
          p.x += p.vx * dt; p.y += p.vy * dt;
          c.globalAlpha = 1 - p.age / p.life;
          c.drawImage(spr, p.x - 5, p.y - 5, 10, 10);
        }
        // Halo elétrico fraco no avatar enquanto houver raios.
        if (st.bolts.length) {
          c.globalAlpha = 0.3;
          var R = st.ar * 1.8;
          c.drawImage(glowSprite('rgba(110,180,255,1)', 48), st.ax - R, st.ay - R, R * 2, R * 2);
        }
        c.globalCompositeOperation = 'source-over';
      },
    },

    magic: {
      start: function (st) { this.spawn(st, 22); },
      rate: function (t) { return t < INTRO ? 30 : 7; },
      spawn: function (st, n) {
        var cols = ['rgba(196,140,255,1)', 'rgba(255,140,220,1)', 'rgba(130,220,255,1)', 'rgba(255,214,120,1)'];
        for (var i = 0; i < n; i++) {
          var orbit = Math.random() < 0.35;
          var a = rnd(0, Math.PI * 2);
          st.P.push(orbit
            ? { orbit: true, a: a, r: st.ar * rnd(1.2, 1.9), w: rnd(0.9, 1.8) * (Math.random() < 0.5 ? -1 : 1), age: 0, life: rnd(1.2, 2.2), s: rnd(2, 3.6), col: pick(cols), tw: rnd(0, 6) }
            : { x: rnd(-10, st.W * 0.8), y: rnd(st.H * 0.05, st.H * 0.62), vx: rnd(18, 46), vy: rnd(-16, 8), age: 0, life: rnd(1.4, 2.6), s: rnd(1.6, 3.4), col: pick(cols), tw: rnd(0, 6) });
        }
      },
      draw: function (c, st, dt) {
        c.globalCompositeOperation = 'lighter';
        for (var j = st.P.length - 1; j >= 0; j--) {
          var p = st.P[j];
          p.age += dt;
          if (p.age >= p.life) { st.P.splice(j, 1); continue; }
          var x, y;
          if (p.orbit) { p.a += p.w * dt; x = st.ax + Math.cos(p.a) * p.r; y = st.ay + Math.sin(p.a) * p.r * 0.92; }
          else { p.x += p.vx * dt; p.y += (p.vy + Math.sin(p.tw + p.age * 3) * 10) * dt; x = p.x; y = p.y; }
          var k = p.age / p.life;
          var fade = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
          var tw = 0.55 + 0.45 * Math.sin(p.tw + p.age * 7);
          c.globalAlpha = fade * tw;
          var rr = p.s * 3.4;
          c.drawImage(glowSprite(p.col, 16), x - rr, y - rr, rr * 2, rr * 2);
          // Estrela de 4 pontas por cima do brilho.
          c.globalAlpha = fade * tw * 0.95;
          c.fillStyle = 'rgba(255,255,255,1)';
          var L = p.s * 2.3;
          var w = p.s * 0.42;
          c.beginPath();
          c.moveTo(x, y - L); c.lineTo(x + w, y - w); c.lineTo(x + L, y); c.lineTo(x + w, y + w);
          c.lineTo(x, y + L); c.lineTo(x - w, y + w); c.lineTo(x - L, y); c.lineTo(x - w, y - w);
          c.closePath(); c.fill();
        }
        c.globalCompositeOperation = 'source-over';
      },
    },

    mist: {
      // A névoa já nasce visível: as primeiras nuvens começam no meio da vida.
      start: function (st) { this.spawn(st, 14); st.P.forEach(function (p) { p.age = p.life * rnd(0.22, 0.32); }); },
      rate: function (t) { return t < INTRO ? 11 : 3.2; },
      spawn: function (st, n) {
        for (var i = 0; i < n; i++) {
          var a = rnd(0, Math.PI * 2);
          var r0 = st.ar * rnd(0.6, 1.2);
          st.P.push({ x: st.ax + Math.cos(a) * r0, y: st.ay + Math.sin(a) * r0, vx: Math.cos(a) * rnd(6, 22) + rnd(-4, 8), vy: Math.sin(a) * rnd(4, 14) - rnd(4, 12),
            age: 0, life: rnd(2.2, 3.6), r: st.ar * rnd(0.7, 1.4), grow: rnd(10, 26), dark: Math.random() < 0.6 });
        }
      },
      draw: function (c, st, dt) {
        for (var j = st.P.length - 1; j >= 0; j--) {
          var p = st.P[j];
          p.age += dt;
          if (p.age >= p.life) { st.P.splice(j, 1); continue; }
          p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.grow * dt;
          var k = p.age / p.life;
          var fade = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
          // Duas camadas: fumaça escura que encobre e um véu violeta que dá forma à névoa.
          c.globalAlpha = fade * (p.dark ? 0.62 : 0.45);
          c.drawImage(glowSprite(p.dark ? 'rgba(10,4,20,1)' : 'rgba(132,84,196,1)', 48), p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
          if (!p.dark) {
            c.globalAlpha = fade * 0.22;
            c.drawImage(glowSprite('rgba(196,160,255,1)', 32), p.x - p.r * 0.45, p.y - p.r * 0.45, p.r * 0.9, p.r * 0.9);
          }
        }
      },
    },

    crystal: {
      start: function (st) { this.spawn(st, 26, true); },
      rate: function (t) { return t < 0.3 ? 0 : (t < INTRO ? 5 : 1.6); },
      spawn: function (st, n, big) {
        for (var i = 0; i < n; i++) {
          var a = rnd(0, Math.PI * 2);
          var sp = big ? rnd(70, 220) : rnd(10, 30);
          var r0 = st.ar * (big ? 0.9 : rnd(1.1, 1.5));
          st.P.push({ x: st.ax + Math.cos(a) * r0, y: st.ay + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (big ? 20 : 0),
            rot: rnd(0, 6.28), vr: rnd(-6, 6), age: 0, life: big ? rnd(0.9, 1.6) : rnd(0.8, 1.3), w: big ? rnd(3, 6) : rnd(2, 3.5), l: big ? rnd(8, 15) : rnd(5, 8) });
        }
      },
      draw: function (c, st, dt, t) {
        if (t < 0.5) {
          var k0 = t / 0.5;
          var R = st.ar * (1.1 + k0 * 1.5);
          c.globalAlpha = (1 - k0) * 0.5;
          c.drawImage(glowSprite('rgba(170,235,255,1)', 48), st.ax - R, st.ay - R, R * 2, R * 2);
        }
        for (var j = st.P.length - 1; j >= 0; j--) {
          var p = st.P[j];
          p.age += dt;
          if (p.age >= p.life) { st.P.splice(j, 1); continue; }
          var drag = Math.pow(0.3, dt);
          p.vx *= drag; p.vy = p.vy * drag + 60 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          var k = p.age / p.life;
          c.save();
          c.translate(p.x, p.y);
          c.rotate(p.rot);
          c.globalAlpha = (1 - k) * 0.95;
          var g = c.createLinearGradient(-p.l, 0, p.l, 0);
          g.addColorStop(0, 'rgba(120,210,255,0.9)');
          g.addColorStop(0.5, 'rgba(240,252,255,1)');
          g.addColorStop(1, 'rgba(110,190,255,0.85)');
          c.fillStyle = g;
          c.beginPath();
          c.moveTo(-p.l, 0); c.lineTo(0, -p.w); c.lineTo(p.l, 0); c.lineTo(0, p.w * 0.7);
          c.closePath(); c.fill();
          c.globalAlpha = (1 - k) * 0.8;
          c.strokeStyle = 'rgba(255,255,255,0.9)';
          c.lineWidth = 0.7;
          c.beginPath(); c.moveTo(-p.l * 0.7, 0); c.lineTo(p.l * 0.7, 0); c.stroke();
          c.restore();
        }
      },
    },

    waves: {
      start: function (st) { st.rings = []; st.timer = 0; },
      rate: function () { return 0; },
      spawn: function () {},
      draw: function (c, st, dt, t, phase) {
        st.timer -= dt;
        var every = phase === 'intro' ? 0.42 : 1.5;
        if (phase !== 'ending' && st.timer <= 0) { st.rings.push({ age: 0, life: phase === 'intro' ? 1.5 : 2 }); st.timer = every; }
        c.globalCompositeOperation = 'lighter';
        for (var i = st.rings.length - 1; i >= 0; i--) {
          var r = st.rings[i];
          r.age += dt;
          if (r.age >= r.life) { st.rings.splice(i, 1); continue; }
          var k = r.age / r.life;
          var ease = 1 - Math.pow(1 - k, 2);
          var R = st.ar * (1.05 + ease * 3.4);
          c.globalAlpha = (1 - k) * 0.8;
          c.strokeStyle = 'rgba(255,196,84,1)';
          c.lineWidth = 3.2 * (1 - k) + 0.5;
          c.beginPath(); c.arc(st.ax, st.ay, R, 0, Math.PI * 2); c.stroke();
          c.globalAlpha = (1 - k) * 0.35;
          c.strokeStyle = 'rgba(255,90,70,1)';
          c.lineWidth = 7 * (1 - k) + 1;
          c.beginPath(); c.arc(st.ax, st.ay, R * 0.985, 0, Math.PI * 2); c.stroke();
        }
        c.globalCompositeOperation = 'source-over';
        st.alive = st.rings.length > 0;
      },
    },

    pulse: {
      start: function (st) { st.beat = 0; },
      rate: function () { return 0; },
      spawn: function () {},
      draw: function (c, st, dt, t, phase) {
        st.beat += dt;
        var period = phase === 'intro' ? 0.85 : 1.6;
        var strength = phase === 'intro' ? 1 : (phase === 'ending' ? Math.max(0, st.fadeOut) : 0.55);
        var k = (st.beat % period) / period;
        var env = Math.pow(Math.sin(Math.PI * k), 2.2);
        var R = st.ar * (1.25 + env * 1.35);
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = Math.min(1, env * 0.95 * strength);
        c.drawImage(glowSprite('rgba(255,200,80,1)', 64), st.ax - R, st.ay - R, R * 2, R * 2);
        c.globalAlpha = env * 0.7 * strength;
        c.strokeStyle = 'rgba(255,236,190,1)';
        c.lineWidth = 2.2;
        c.beginPath(); c.arc(st.ax, st.ay, st.ar * (1.08 + env * 0.25), 0, Math.PI * 2); c.stroke();
        // Onda curta que sai a cada batida.
        var kr = k < 0.5 ? k / 0.5 : 1;
        c.globalAlpha = (1 - kr) * 0.55 * strength;
        c.strokeStyle = 'rgba(255,214,120,1)';
        c.lineWidth = 2 * (1 - kr) + 0.4;
        c.beginPath(); c.arc(st.ax, st.ay, st.ar * (1.1 + kr * 1.1), 0, Math.PI * 2); c.stroke();
        c.globalCompositeOperation = 'source-over';
        st.alive = strength > 0.01;
      },
    },
  };

  var activeFx = null;

  function mountCardEffect(cardEl, user) {
    var noop = { replay: function () {}, destroy: function () {} };
    if (!cardEl || !user) return noop;
    var id = validEffect(user.effect);
    if (!id) return noop;
    if (activeFx) activeFx.destroy();

    cardEl.classList.add('gl-fx-host');
    if (window.getComputedStyle && getComputedStyle(cardEl).position === 'static') cardEl.classList.add('gl-fx-pos');

    if (reducedMotion()) {
      // Versão estática: um brilho parado com a cor do efeito, sem movimento.
      var still = h('span', 'gl-fx-still', { 'data-fx': id, 'aria-hidden': 'true' });
      cardEl.appendChild(still);
      var handleStill = {
        replay: function () {},
        destroy: function () { if (still.parentNode) still.parentNode.removeChild(still); cardEl.classList.remove('gl-fx-host', 'gl-fx-pos'); if (activeFx === handleStill) activeFx = null; },
      };
      positionStill();
      function positionStill() {
        var a = anchorOf(cardEl);
        if (!a) return;
        still.style.setProperty('--gl-ax', a.x + 'px');
        still.style.setProperty('--gl-ay', a.y + 'px');
        still.style.setProperty('--gl-ar', a.r + 'px');
      }
      if (window.requestAnimationFrame) window.requestAnimationFrame(positionStill);
      activeFx = handleStill;
      return handleStill;
    }

    var canvas = h('canvas', 'gl-fx', { 'aria-hidden': 'true', 'data-fx': id });
    cardEl.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var fx = FX[id];
    var st = { W: 0, H: 0, ax: 0, ay: 0, ar: 30, P: [] };
    var raf = 0;
    var last = 0;
    var t = 0;
    var visible = true;
    var running = false;
    var dead = false;
    var acc = 0;

    function resize() {
      var r = cardEl.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      st.W = Math.max(1, r.width); st.H = Math.max(1, r.height);
      canvas.width = Math.round(st.W * dpr); canvas.height = Math.round(st.H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var a = anchorOf(cardEl);
      if (a) { st.ax = a.x; st.ay = a.y; st.ar = a.r; }
      else { st.ax = st.W * 0.2; st.ay = st.H * 0.3; st.ar = 36; }
    }

    function frame(now) {
      raf = 0;
      if (dead || !running) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      t += dt;
      var phase = t < INTRO ? 'intro' : (t < INTRO + AMBIENT ? 'ambient' : 'ending');
      if (phase === 'ending') st.fadeOut = 1 - (t - INTRO - AMBIENT) / 1.2;
      var rate = phase === 'ending' ? 0 : fx.rate(t);
      acc += rate * dt;
      var n = Math.floor(acc);
      if (n > 0) { acc -= n; if (st.P.length < MAX_P) fx.spawn(st, Math.min(n, MAX_P - st.P.length)); }
      ctx.clearRect(0, 0, st.W, st.H);
      ctx.globalAlpha = 1;
      fx.draw(ctx, st, dt, t, phase);
      ctx.globalAlpha = 1;
      var alive = st.P.length > 0 || (st.bolts && st.bolts.length > 0) || st.alive;
      if (phase === 'ending' && !alive) { running = false; ctx.clearRect(0, 0, st.W, st.H); return; }
      if (phase === 'ending' && t > INTRO + AMBIENT + 4) { running = false; ctx.clearRect(0, 0, st.W, st.H); return; }
      schedule();
    }
    function schedule() {
      if (!raf && running && visible && !document.hidden) raf = window.requestAnimationFrame(frame);
    }
    function play() {
      resize();
      st.P = []; st.bolts = []; st.rings = []; st.alive = false; st.fadeOut = 1;
      t = 0; last = 0; acc = 0;
      if (fx.start) fx.start(st);
      running = true;
      schedule();
    }

    var io = null;
    if (window.IntersectionObserver) {
      io = new IntersectionObserver(function (entries) {
        visible = entries.some(function (e) { return e.isIntersecting; });
        if (visible) { last = 0; schedule(); }
      });
      io.observe(cardEl);
    }
    var ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { if (!dead) resize(); }); ro.observe(cardEl); }
    function onVis() { if (!document.hidden) { last = 0; schedule(); } }
    document.addEventListener('visibilitychange', onVis);

    var handle = {
      replay: function () { if (!dead) play(); },
      destroy: function () {
        if (dead) return;
        dead = true; running = false;
        if (raf) window.cancelAnimationFrame(raf);
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        cardEl.classList.remove('gl-fx-host', 'gl-fx-pos');
        if (activeFx === handle) activeFx = null;
      },
    };
    activeFx = handle;
    // Espera o layout do cartão (banner/avatar) antes de achar o centro do avatar.
    window.requestAnimationFrame(function () { if (!dead) play(); });
    return handle;
  }

  function anchorOf(cardEl) {
    var a = cardEl.querySelector('[data-gl-anchor] .gl-av') || cardEl.querySelector('[data-gl-anchor]') || cardEl.querySelector('.gl-av');
    if (!a) return null;
    var cr = cardEl.getBoundingClientRect();
    var r = a.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2, r: r.width / 2 };
  }

  // ---------------------------------------------------------------------------
  // Validação de imagem (bytes reais) e miniatura
  // ---------------------------------------------------------------------------
  function sniff(u8) {
    if (u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47 && u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a) return 'image/png';
    if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
    if (u8.length >= 6 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38 && (u8[4] === 0x37 || u8[4] === 0x39) && u8[5] === 0x61) return 'image/gif';
    if (u8.length >= 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'image/webp';
    return null;
  }

  /** GIF: percorre os blocos e conta quadros (>1 = animado). */
  function gifFrames(u8) {
    var n = u8.length;
    if (n < 13) return 0;
    var p = 13;
    var flags = u8[10];
    if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
    var frames = 0;
    function skipSub() { while (p < n) { var sz = u8[p]; p += 1; if (sz === 0) return; p += sz; } }
    while (p < n) {
      var b = u8[p];
      if (b === 0x3b) break;                    // trailer
      if (b === 0x21) { p += 2; skipSub(); continue; }   // extensão
      if (b === 0x2c) {                         // imagem
        frames += 1;
        if (frames > 1) return frames;
        if (p + 10 > n) break;
        var lf = u8[p + 9];
        p += 10;
        if (lf & 0x80) p += 3 * (1 << ((lf & 7) + 1));
        p += 1;                                 // LZW min code size
        skipSub();
        continue;
      }
      break;                                    // byte inesperado: para
    }
    return frames;
  }

  /** WebP animado: VP8X com o bit de animação ou chunk ANIM. */
  function webpAnimated(u8) {
    var n = u8.length;
    var p = 12;
    while (p + 8 <= n) {
      var tag = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
      var size = u8[p + 4] | (u8[p + 5] << 8) | (u8[p + 6] << 16) | (u8[p + 7] << 24);
      if (tag === 'VP8X' && p + 8 < n && (u8[p + 8] & 0x02)) return true;
      if (tag === 'ANIM' || tag === 'ANMF') return true;
      if (tag === 'VP8 ' || tag === 'VP8L') return false;
      if (size < 0) return false;
      p += 8 + size + (size & 1);
    }
    return false;
  }

  function readBuffer(file) {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = function () { reject(new Error('read')); };
      r.onload = function () { resolve(r.result); };
      r.readAsArrayBuffer(file);
    });
  }

  function decode(blob) {
    if (window.createImageBitmap) {
      return window.createImageBitmap(blob).catch(function () { return decodeViaImg(blob); });
    }
    return decodeViaImg(blob);
  }
  function decodeViaImg(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve({ img: img, width: img.naturalWidth, height: img.naturalHeight, url: url, close: function () { URL.revokeObjectURL(url); } }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  /**
   * Confere tamanho (≤ 40 MB), formato pelos bytes, animação e se dá para abrir.
   * Devolve Promise<{ ok, error?, name, mime, data:ArrayBuffer, animated, width, height, size, bitmap }>
   */
  function validateImageFile(file) {
    if (!file) return Promise.resolve({ ok: false, error: 'Nenhum arquivo escolhido.' });
    if (file.size > MAX_IMAGE_BYTES) return Promise.resolve({ ok: false, error: 'A imagem passa de 40 MB (' + fmtMB(file.size) + '). Escolha um arquivo de até 40 MB.' });
    if (!file.size) return Promise.resolve({ ok: false, error: 'O arquivo está vazio.' });
    return readBuffer(file).then(function (buf) {
      if (buf.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: 'A imagem passa de 40 MB. Escolha um arquivo de até 40 MB.' };
      var u8 = new Uint8Array(buf);
      var mime = sniff(u8);
      if (!mime) return { ok: false, error: 'Esse arquivo não é uma imagem PNG, JPG, GIF ou WebP.' };
      var animated = mime === 'image/gif' ? gifFrames(u8) > 1 : (mime === 'image/webp' ? webpAnimated(u8) : false);
      var blob = new Blob([buf], { type: mime });
      return decode(blob).then(function (bmp) {
        var w = bmp.width || (bmp.img && bmp.img.naturalWidth) || 0;
        var hgt = bmp.height || (bmp.img && bmp.img.naturalHeight) || 0;
        if (!w || !hgt) return { ok: false, error: 'Não foi possível abrir essa imagem. Ela pode estar corrompida.' };
        return { ok: true, name: String(file.name || 'imagem').slice(0, 120), mime: mime, data: buf, blob: blob, animated: animated, width: w, height: hgt, size: buf.byteLength, bitmap: bmp };
      }, function () {
        return { ok: false, error: 'Não foi possível abrir essa imagem. Ela pode estar corrompida.' };
      });
    }, function () {
      return { ok: false, error: 'Não foi possível ler o arquivo. Tente de novo.' };
    });
  }

  /* Miniatura estática do primeiro quadro, SEM recorte (o recorte é aplicado pelo CSS em todo lugar,
     assim mudar o enquadramento não exige reenviar a imagem). WebP ≤ 512 KB. */
  function makeThumb(bmp, maxW, maxH) {
    var src = bmp.img || bmp;
    var w = bmp.width || src.naturalWidth;
    var hgt = bmp.height || src.naturalHeight;
    var scale = Math.min(1, maxW / w, maxH / hgt);
    var tw = Math.max(1, Math.round(w * scale));
    var th = Math.max(1, Math.round(hgt * scale));
    var canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    var g = canvas.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, tw, th);
    var qualities = [0.86, 0.74, 0.6, 0.45];
    function attempt(i) {
      return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/webp', qualities[i]); }).then(function (blob) {
        if (!blob) throw new Error('thumb');
        if (blob.size > MAX_THUMB_BYTES && i < qualities.length - 1) return attempt(i + 1);
        if (blob.size > MAX_THUMB_BYTES) throw new Error('thumb');
        return readBuffer(blob).then(function (data) { return { mime: blob.type || 'image/webp', data: data, size: blob.size }; });
      });
    }
    return attempt(0);
  }

  // ---------------------------------------------------------------------------
  // Editor "Personalização do Perfil"
  // ---------------------------------------------------------------------------
  var edUid = 0;

  function renderEditor(container, opts) {
    var o = opts || {};
    var bridge = o.bridge || window.ghostRank || {};
    var getView = typeof o.getView === 'function' ? o.getView : function () { return {}; };
    var onDirtyChange = typeof o.onDirtyChange === 'function' ? o.onDirtyChange : function () {};
    edUid += 1;
    var pre = 'gle' + edUid + '-';
    var destroyed = false;
    var saving = false;
    var lastSaveFailed = false;
    var previewFx = null;
    var lastMeSig = null;

    function me() { var v = getView() || {}; return v.me || null; }
    function baseFromMe(u) {
      u = u || {};
      return {
        frame: validFrame(u.frame), effect: validEffect(u.effect),
        crop: normCrop(u.avatarCrop), bannerPos: clamp(u.bannerPos !== undefined && u.bannerPos !== null ? u.bannerPos : 50, 0, 100),
      };
    }
    var base = baseFromMe(me());
    var draft = freshDraft();
    function freshDraft() {
      return { frame: base.frame, effect: base.effect, crop: { x: base.crop.x, y: base.crop.y, zoom: base.crop.zoom }, bannerPos: base.bannerPos,
        avatar: null, removeAvatar: false, banner: null, removeBanner: false };
    }
    function isDirty() {
      return Boolean(draft.avatar || draft.removeAvatar || draft.banner || draft.removeBanner) ||
        draft.frame !== base.frame || draft.effect !== base.effect || !sameJson(normCrop(draft.crop), base.crop) || draft.bannerPos !== base.bannerPos;
    }
    var wasDirty = false;
    function changed() {
      var d = isDirty();
      actions.save.disabled = saving || !d;
      actions.cancel.disabled = saving || !d;
      bar.classList.toggle('is-dirty', d);
      barText.textContent = saving ? 'Salvando…' : (d ? 'Você tem alterações não salvas.' : 'Tudo salvo.');
      if (d !== wasDirty) { wasDirty = d; try { onDirtyChange(d); } catch (e) { /* app */ } }
    }
    function announce(text) { live.textContent = ''; window.setTimeout(function () { live.textContent = text; }, 20); }

    // Usuário de prévia: o que está salvo + o rascunho.
    function draftUser() {
      var u = Object.assign({}, me() || {});
      u.frame = draft.frame; u.effect = draft.effect; u.avatarCrop = normCrop(draft.crop); u.bannerPos = draft.bannerPos;
      if (draft.removeAvatar) { u.avatarUrl = null; u.avatarThumbUrl = null; u.animatedAvatar = false; }
      if (draft.avatar) { u.avatarUrl = draft.avatar.url; u.avatarThumbUrl = null; u.animatedAvatar = draft.avatar.animated; }
      if (draft.removeBanner) { u.bannerUrl = null; u.bannerThumbUrl = null; u.animatedBanner = false; }
      if (draft.banner) { u.bannerUrl = draft.banner.url; u.bannerThumbUrl = null; u.animatedBanner = draft.banner.animated; }
      return u;
    }

    // ----- estrutura -----
    var root = h('div', 'gle');
    var grid = h('div', 'gle-grid');
    var left = h('div', 'gle-form');
    var right = h('div', 'gle-preview-col');
    var live = h('div', 'gl-sr', { 'aria-live': 'polite', role: 'status' });
    root.appendChild(grid);
    grid.appendChild(left);
    grid.appendChild(right);
    root.appendChild(live);

    function section(title, desc, id) {
      var sec = h('section', 'gle-sec', { 'aria-labelledby': pre + id });
      sec.appendChild(h('h3', 'gle-h', { id: pre + id, text: title }));
      if (desc) sec.appendChild(h('p', 'gle-desc', { text: desc }));
      return sec;
    }
    function button(label, cls, onClick, extra) {
      var b = h('button', 'btn btn-small ' + (cls || ''), Object.assign({ type: 'button', text: label }, extra || {}));
      b.addEventListener('click', onClick);
      return b;
    }

    // ----- avatar -----
    var avSec = section('Avatar', 'PNG, JPG, GIF ou WebP — também animados — até 40 MB. Arraste a imagem dentro do círculo para enquadrar.', 'av');
    var avFile = h('input', 'gl-sr', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', tabindex: '-1', 'aria-hidden': 'true' });
    var avRow = h('div', 'gle-media-row');
    var avStage = h('div', 'gle-crop', { tabindex: '0', role: 'group', 'aria-label': 'Enquadramento do avatar. Use as setas para mover e + ou − para o zoom.' });
    var avControls = h('div', 'gle-media-ctrl');
    var zoomId = pre + 'zoom';
    var zoom = h('input', 'gle-range', { type: 'range', id: zoomId, min: '1', max: '3', step: '0.01' });
    var zoomOut = h('output', 'gle-range-out', { for: zoomId });
    var avButtons = h('div', 'gle-btns');
    var avErr = h('p', 'gle-error', { role: 'alert', hidden: true });
    var avProg = progressBox('avatar');
    var avInfo = h('p', 'gle-file', { hidden: true });
    avControls.appendChild(h('div', 'gle-range-row', null, [h('label', 'gle-label', { for: zoomId, text: 'Zoom' }), zoom, zoomOut]));
    avControls.appendChild(avButtons);
    avControls.appendChild(avInfo);
    avRow.appendChild(avStage);
    avRow.appendChild(avControls);
    avSec.appendChild(avRow);
    avSec.appendChild(avProg.el);
    avSec.appendChild(avErr);
    avSec.appendChild(avFile);
    left.appendChild(avSec);

    // ----- banner -----
    var bnSec = section('Banner', 'Imagem larga no topo do seu cartão — estática ou animada, até 40 MB. Arraste para cima ou para baixo para ajustar.', 'bn');
    var bnFile = h('input', 'gl-sr', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', tabindex: '-1', 'aria-hidden': 'true' });
    var bnStage = h('div', 'gle-bn', { tabindex: '0', role: 'group', 'aria-label': 'Posição do banner. Use as setas para cima e para baixo.' });
    var posId = pre + 'pos';
    var pos = h('input', 'gle-range', { type: 'range', id: posId, min: '0', max: '100', step: '1' });
    var posOut = h('output', 'gle-range-out', { for: posId });
    var bnButtons = h('div', 'gle-btns');
    var bnErr = h('p', 'gle-error', { role: 'alert', hidden: true });
    var bnProg = progressBox('banner');
    var bnInfo = h('p', 'gle-file', { hidden: true });
    bnSec.appendChild(bnStage);
    bnSec.appendChild(h('div', 'gle-range-row', null, [h('label', 'gle-label', { for: posId, text: 'Posição vertical' }), pos, posOut]));
    bnSec.appendChild(bnButtons);
    bnSec.appendChild(bnInfo);
    bnSec.appendChild(bnProg.el);
    bnSec.appendChild(bnErr);
    bnSec.appendChild(bnFile);
    left.appendChild(bnSec);

    // ----- molduras -----
    var frSec = section('Moldura', 'Fica em volta do avatar, sem mudar a sua foto. Todas são gratuitas.', 'fr');
    var frGrid = h('div', 'gle-tiles', { role: 'radiogroup', 'aria-labelledby': pre + 'fr' });
    frSec.appendChild(frGrid);
    left.appendChild(frSec);

    // ----- efeitos -----
    var fxSec = section('Efeito especial', 'Toca dentro do seu cartão quando alguém abre o seu perfil. Não aparece nos chats. Todos são gratuitos.', 'fx');
    var fxGrid = h('div', 'gle-tiles gle-tiles-fx', { role: 'radiogroup', 'aria-labelledby': pre + 'fx' });
    fxSec.appendChild(fxGrid);
    left.appendChild(fxSec);

    // ----- prévia -----
    var pvHead = h('div', 'gle-pv-head', null, [h('span', 'gle-label', { text: 'Prévia do cartão' })]);
    var replayBtn = button('Ver efeito', 'gle-replay', function () { if (previewFx) previewFx.replay(); });
    pvHead.appendChild(replayBtn);
    var pvHost = h('div', 'gle-pv');
    var pvNote = h('p', 'gle-desc gle-pv-note', { text: reducedMotion() ? 'Seu sistema pede menos movimento: a prévia mostra os efeitos parados.' : 'É assim que os outros veem o seu perfil.' });
    right.appendChild(h('div', 'gle-sticky', null, [pvHead, pvHost, pvNote]));

    // ----- ações -----
    var bar = h('div', 'gle-bar', { role: 'region', 'aria-label': 'Salvar personalização' });
    var barText = h('span', 'gle-bar-text', { text: 'Tudo salvo.' });
    var barErr = h('span', 'gle-bar-err', { role: 'alert', hidden: true });
    var actions = {
      reset: button('Restaurar aparência padrão', 'gle-link', function () { restoreDefault(); }),
      cancel: button('Cancelar', '', function () { cancel(); }),
      save: button('Salvar alterações', 'btn-primary', function () { save(); }),
      retry: button('Tentar de novo', 'btn-primary', function () { save(); }, { hidden: true }),
    };
    bar.appendChild(h('div', 'gle-bar-msg', null, [barText, barErr]));
    bar.appendChild(h('div', 'gle-bar-actions', null, [actions.reset, actions.cancel, actions.retry, actions.save]));
    root.appendChild(bar);

    container.appendChild(root);

    // ----- progresso -----
    function progressBox(kind) {
      var el = h('div', 'gle-prog', { hidden: true });
      var label = h('span', 'gle-prog-label');
      var track = h('div', 'gle-prog-track', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': kind === 'avatar' ? 'Envio do avatar' : 'Envio do banner' });
      var fill = h('div', 'gle-prog-fill');
      track.appendChild(fill);
      el.appendChild(label);
      el.appendChild(track);
      return {
        el: el,
        set: function (up, sending) {
          if (!up && !sending) { el.hidden = true; return; }
          el.hidden = false;
          var p = up && typeof up.progress === 'number' ? clamp(up.progress, 0, 1) : null;
          var status = up ? up.status : 'uploading';
          if (status === 'error') { el.hidden = true; return; }
          el.classList.toggle('is-indeterminate', p === null || status === 'processing');
          if (p !== null) { fill.style.transform = 'scaleX(' + p + ')'; track.setAttribute('aria-valuenow', String(Math.round(p * 100))); }
          else track.removeAttribute('aria-valuenow');
          var what = kind === 'avatar' ? 'avatar' : 'banner';
          label.textContent = status === 'processing' ? 'Finalizando o ' + what + '…' : (status === 'done' ? 'Envio concluído.' : ('Enviando o ' + what + '…' + (p !== null ? ' ' + Math.round(p * 100) + '%' : '')));
        },
      };
    }
    var sendingKind = null;
    function refreshProgress() {
      var v = getView() || {};
      var ups = v.uploads || {};
      avProg.set(ups.avatar && ups.avatar.status !== 'done' ? ups.avatar : null, sendingKind === 'avatar');
      bnProg.set(ups.banner && ups.banner.status !== 'done' ? ups.banner : null, sendingKind === 'banner');
    }

    // ----- render das partes -----
    function showErr(el, text) { el.textContent = text || ''; el.hidden = !text; }

    function renderAvatarStage() {
      clear(avStage);
      var u = draftUser();
      var src = u.avatarUrl || null;
      if (src) {
        var img = h('img', 'gle-crop-img', { alt: '', draggable: 'false' });
        img.src = src;
        applyCrop(img, draft.crop);
        avStage.appendChild(img);
        avStage.classList.remove('is-empty');
        avStage.setAttribute('aria-disabled', 'false');
      } else {
        avStage.appendChild(h('span', 'gle-crop-initial', { 'data-c': colorOf(u), text: initial(u) }));
        avStage.classList.add('is-empty');
        avStage.setAttribute('aria-disabled', 'true');
      }
      avStage.appendChild(h('span', 'gle-crop-ring', { 'aria-hidden': 'true' }));
      zoom.value = String(normCrop(draft.crop).zoom);
      zoom.disabled = !src;
      zoomOut.textContent = Math.round(normCrop(draft.crop).zoom * 100) + '%';
      clear(avButtons);
      avButtons.appendChild(button(src ? 'Trocar avatar' : 'Enviar avatar', 'btn-primary', function () { avFile.click(); }, { 'data-fk': 'gle-av-up' }));
      if (src) avButtons.appendChild(button('Remover avatar', 'gle-link gle-danger', function () {
        if (draft.avatar) { revoke(draft.avatar); draft.avatar = null; }
        else draft.removeAvatar = true;
        draft.crop = { x: 50, y: 50, zoom: 1 };
        avInfo.hidden = true;
        renderMedia(); renderPreview(); changed();
        announce('Avatar removido da prévia. Salve para aplicar.');
      }));
      if (src && !isDefaultCrop(draft.crop)) avButtons.appendChild(button('Centralizar', 'gle-link', function () { draft.crop = { x: 50, y: 50, zoom: 1 }; renderAvatarStage(); renderPreview(); changed(); }));
    }

    function renderBannerStage() {
      clear(bnStage);
      var u = draftUser();
      var b = banner(u, { animate: 'always', pos: draft.bannerPos });
      bnStage.appendChild(b);
      var has = Boolean(u.bannerUrl);
      bnStage.classList.toggle('is-empty', !has);
      bnStage.setAttribute('aria-disabled', has ? 'false' : 'true');
      if (!has) bnStage.appendChild(h('span', 'gle-bn-empty', { text: 'Sem banner: usamos a cor do seu perfil.' }));
      pos.value = String(draft.bannerPos);
      pos.disabled = !has;
      posOut.textContent = draft.bannerPos + '%';
      clear(bnButtons);
      bnButtons.appendChild(button(has ? 'Trocar banner' : 'Enviar banner', 'btn-primary', function () { bnFile.click(); }, { 'data-fk': 'gle-bn-up' }));
      if (has) bnButtons.appendChild(button('Remover banner', 'gle-link gle-danger', function () {
        if (draft.banner) { revoke(draft.banner); draft.banner = null; }
        else draft.removeBanner = true;
        draft.bannerPos = 50;
        bnInfo.hidden = true;
        renderMedia(); renderPreview(); changed();
        announce('Banner removido da prévia. Salve para aplicar.');
      }));
    }

    function renderMedia() { renderAvatarStage(); renderBannerStage(); }

    function tile(group, id, label, selected, visual, onPick) {
      var t = h('button', 'gle-tile' + (selected ? ' is-on' : ''), { type: 'button', role: 'radio', 'aria-checked': selected ? 'true' : 'false', tabindex: selected ? '0' : '-1', 'data-id': id || 'none', 'data-group': group });
      t.appendChild(h('span', 'gle-tile-vis', null, [visual]));
      t.appendChild(h('span', 'gle-tile-label', { text: label }));
      t.addEventListener('click', function () { onPick(id); });
      return t;
    }
    function roving(gridEl) {
      gridEl.addEventListener('keydown', function (ev) {
        var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(ev.key in keys) && ev.key !== 'Home' && ev.key !== 'End') return;
        var items = Array.prototype.slice.call(gridEl.querySelectorAll('.gle-tile'));
        var i = items.indexOf(document.activeElement);
        if (i < 0) return;
        ev.preventDefault();
        var n = ev.key === 'Home' ? 0 : (ev.key === 'End' ? items.length - 1 : (i + keys[ev.key] + items.length) % items.length);
        items[n].click();
        var again = gridEl.querySelectorAll('.gle-tile')[n];
        if (again) again.focus();
      });
    }
    roving(frGrid);
    roving(fxGrid);

    function renderFrames() {
      clear(frGrid);
      var u = draftUser();
      frGrid.appendChild(tile('frame', null, 'Nenhuma', !draft.frame, avatar(Object.assign({}, u, { frame: null }), { size: 52, animate: 'never' }), pickFrame));
      FRAMES.forEach(function (f) {
        frGrid.appendChild(tile('frame', f.id, f.label, draft.frame === f.id, avatar(Object.assign({}, u, { frame: f.id }), { size: 52, animate: 'never' }), pickFrame));
      });
    }
    function pickFrame(id) {
      if (draft.frame === id) return;
      draft.frame = id;
      renderFrames(); renderPreview(); changed();
      announce(id ? 'Moldura: ' + FRAMES.filter(function (f) { return f.id === id; })[0].label + '.' : 'Sem moldura.');
    }

    function fxIcon(id) {
      var svgEl = s('svg', { viewBox: '0 0 40 40', class: 'gle-fx-ico', 'data-fx': id || 'none', 'aria-hidden': 'true', focusable: 'false' });
      switch (id) {
        case 'burst':
          svgEl.appendChild(s('circle', { cx: 20, cy: 20, r: 5 }));
          for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; svgEl.appendChild(s('line', { x1: 20 + Math.cos(a) * 9, y1: 20 + Math.sin(a) * 9, x2: 20 + Math.cos(a) * 16, y2: 20 + Math.sin(a) * 16 })); }
          break;
        case 'flames':
          svgEl.appendChild(s('path', { d: 'M20 6 C26 14 30 18 28 26 C27 31 23 34 20 34 C16 34 12 31 12 26 C12 21 15 19 16 14 C18 18 19 19 21 20 C22 15 21 10 20 6 Z' }));
          break;
        case 'sparks':
          svgEl.appendChild(s('path', { d: 'M22 4 L12 22 L19 22 L16 36 L28 16 L21 16 Z' }));
          break;
        case 'magic':
          svgEl.appendChild(s('path', { d: 'M18 6 L20.5 15.5 L30 18 L20.5 20.5 L18 30 L15.5 20.5 L6 18 L15.5 15.5 Z' }));
          svgEl.appendChild(s('path', { d: 'M30 24 L31.2 28.8 L36 30 L31.2 31.2 L30 36 L28.8 31.2 L24 30 L28.8 28.8 Z' }));
          break;
        case 'mist':
          svgEl.appendChild(s('path', { d: 'M6 16 C10 12 14 20 20 16 C26 12 30 20 34 16' }));
          svgEl.appendChild(s('path', { d: 'M6 24 C10 20 14 28 20 24 C26 20 30 28 34 24' }));
          svgEl.appendChild(s('path', { d: 'M10 32 C14 28 18 34 22 31 C26 28 28 33 30 31' }));
          break;
        case 'crystal':
          svgEl.appendChild(s('path', { d: 'M20 5 L27 15 L20 35 L13 15 Z' }));
          svgEl.appendChild(s('path', { d: 'M13 15 L27 15' }));
          svgEl.appendChild(s('path', { d: 'M31 9 L34 14 L31 21 L28 14 Z' }));
          break;
        case 'waves':
          svgEl.appendChild(s('circle', { cx: 20, cy: 20, r: 4 }));
          svgEl.appendChild(s('circle', { cx: 20, cy: 20, r: 10, class: 'o' }));
          svgEl.appendChild(s('circle', { cx: 20, cy: 20, r: 16, class: 'o' }));
          break;
        case 'pulse':
          svgEl.appendChild(s('path', { d: 'M4 21 L12 21 L15 13 L20 29 L24 17 L27 21 L36 21' }));
          break;
        default:
          svgEl.appendChild(s('circle', { cx: 20, cy: 20, r: 12, class: 'o' }));
          svgEl.appendChild(s('line', { x1: 12, y1: 28, x2: 28, y2: 12 }));
      }
      return svgEl;
    }
    function renderEffects() {
      clear(fxGrid);
      fxGrid.appendChild(tile('effect', null, 'Nenhum', !draft.effect, fxIcon(null), pickEffect));
      EFFECTS.forEach(function (f) { fxGrid.appendChild(tile('effect', f.id, f.label, draft.effect === f.id, fxIcon(f.id), pickEffect)); });
    }
    function pickEffect(id) {
      if (draft.effect === id) { if (previewFx) previewFx.replay(); return; }
      draft.effect = id;
      renderEffects(); renderPreview(); changed();
      announce(id ? 'Efeito: ' + EFFECTS.filter(function (f) { return f.id === id; })[0].label + '.' : 'Sem efeito.');
    }

    function renderPreview() {
      if (previewFx) { previewFx.destroy(); previewFx = null; }
      clear(pvHost);
      var u = draftUser();
      var card = profileCard(u, { compact: true });
      pvHost.appendChild(card);
      replayBtn.disabled = !u.effect || reducedMotion();
      if (u.effect) previewFx = mountCardEffect(card, u);
    }

    // ----- arrastar para enquadrar -----
    function dragPan(stage, onMove) {
      var start = null;
      stage.addEventListener('pointerdown', function (ev) {
        if (stage.getAttribute('aria-disabled') === 'true' || ev.button !== 0) return;
        start = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
        try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
        stage.classList.add('is-grabbing');
        ev.preventDefault();
      });
      stage.addEventListener('pointermove', function (ev) {
        if (!start || ev.pointerId !== start.id) return;
        var dx = ev.clientX - start.x;
        var dy = ev.clientY - start.y;
        start.x = ev.clientX; start.y = ev.clientY;
        onMove(dx, dy, stage.getBoundingClientRect());
      });
      function end(ev) {
        if (!start || (ev && ev.pointerId !== start.id)) return;
        start = null;
        stage.classList.remove('is-grabbing');
        renderFrames(); renderPreview(); changed();
      }
      stage.addEventListener('pointerup', end);
      stage.addEventListener('pointercancel', end);
    }
    dragPan(avStage, function (dx, dy, rect) {
      var c = normCrop(draft.crop);
      var k = 100 / (rect.width * c.zoom);
      draft.crop = { x: clamp(c.x - dx * k * 1.6, 0, 100), y: clamp(c.y - dy * k * 1.6, 0, 100), zoom: c.zoom };
      var img = avStage.querySelector('.gle-crop-img');
      if (img) applyCrop(img, draft.crop);
    });
    dragPan(bnStage, function (dx, dy, rect) {
      draft.bannerPos = Math.round(clamp(draft.bannerPos - (dy / rect.height) * 60, 0, 100));
      var img = bnStage.querySelector('.gl-banner-img');
      if (img) img.style.objectPosition = '50% ' + draft.bannerPos + '%';
      pos.value = String(draft.bannerPos);
      posOut.textContent = draft.bannerPos + '%';
    });
    avStage.addEventListener('keydown', function (ev) {
      if (avStage.getAttribute('aria-disabled') === 'true') return;
      var c = normCrop(draft.crop);
      var step = ev.shiftKey ? 10 : 2;
      var nc = null;
      if (ev.key === 'ArrowLeft') nc = { x: c.x - step, y: c.y, zoom: c.zoom };
      else if (ev.key === 'ArrowRight') nc = { x: c.x + step, y: c.y, zoom: c.zoom };
      else if (ev.key === 'ArrowUp') nc = { x: c.x, y: c.y - step, zoom: c.zoom };
      else if (ev.key === 'ArrowDown') nc = { x: c.x, y: c.y + step, zoom: c.zoom };
      else if (ev.key === '+' || ev.key === '=') nc = { x: c.x, y: c.y, zoom: c.zoom + 0.1 };
      else if (ev.key === '-' || ev.key === '_') nc = { x: c.x, y: c.y, zoom: c.zoom - 0.1 };
      if (!nc) return;
      ev.preventDefault();
      draft.crop = normCrop(nc);
      renderAvatarStage(); renderFrames(); renderPreview(); changed();
      var again = root.querySelector('.gle-crop'); if (again) again.focus();
    });
    bnStage.addEventListener('keydown', function (ev) {
      if (bnStage.getAttribute('aria-disabled') === 'true') return;
      var d = ev.key === 'ArrowUp' ? -(ev.shiftKey ? 10 : 2) : (ev.key === 'ArrowDown' ? (ev.shiftKey ? 10 : 2) : 0);
      if (!d) return;
      ev.preventDefault();
      draft.bannerPos = Math.round(clamp(draft.bannerPos + d, 0, 100));
      renderBannerStage(); renderPreview(); changed();
      var again = root.querySelector('.gle-bn'); if (again) again.focus();
    });
    zoom.addEventListener('input', function () {
      var c = normCrop(draft.crop);
      draft.crop = { x: c.x, y: c.y, zoom: clamp(zoom.value, 1, 3) };
      zoomOut.textContent = Math.round(draft.crop.zoom * 100) + '%';
      var img = avStage.querySelector('.gle-crop-img');
      if (img) applyCrop(img, draft.crop);
    });
    zoom.addEventListener('change', function () { renderFrames(); renderPreview(); changed(); });
    pos.addEventListener('input', function () {
      draft.bannerPos = Math.round(clamp(pos.value, 0, 100));
      posOut.textContent = draft.bannerPos + '%';
      var img = bnStage.querySelector('.gl-banner-img');
      if (img) img.style.objectPosition = '50% ' + draft.bannerPos + '%';
    });
    pos.addEventListener('change', function () { renderPreview(); changed(); });

    // ----- escolher arquivo -----
    function revoke(item) { if (item && item.url) { try { URL.revokeObjectURL(item.url); } catch (e) { /* ok */ } } if (item && item.bitmap && item.bitmap.close) { try { item.bitmap.close(); } catch (e2) { /* ok */ } } }
    function onFile(input, kind) {
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        input.value = '';
        var errEl = kind === 'avatar' ? avErr : bnErr;
        var infoEl = kind === 'avatar' ? avInfo : bnInfo;
        showErr(errEl, '');
        if (!f) return;
        infoEl.hidden = false;
        infoEl.textContent = 'Conferindo a imagem…';
        validateImageFile(f).then(function (r) {
          if (destroyed) { if (r.bitmap && r.bitmap.close) r.bitmap.close(); return; }
          if (!r.ok) { infoEl.hidden = true; showErr(errEl, r.error); announce(r.error); return; }
          var item = { name: r.name, mime: r.mime, data: r.data, animated: r.animated, size: r.size, width: r.width, height: r.height, bitmap: r.bitmap, url: URL.createObjectURL(r.blob), thumb: null };
          if (kind === 'avatar') { revoke(draft.avatar); draft.avatar = item; draft.removeAvatar = false; draft.crop = { x: 50, y: 50, zoom: 1 }; }
          else { revoke(draft.banner); draft.banner = item; draft.removeBanner = false; draft.bannerPos = 50; }
          infoEl.textContent = r.name + ' · ' + fmtMB(r.size) + ' · ' + r.width + '×' + r.height + (r.animated ? ' · animada' : '');
          renderMedia(); renderFrames(); renderPreview(); changed();
          announce((kind === 'avatar' ? 'Avatar' : 'Banner') + ' escolhido' + (r.animated ? ' (animado)' : '') + '. Confira a prévia e salve.');
        });
      });
    }
    onFile(avFile, 'avatar');
    onFile(bnFile, 'banner');

    // ----- salvar / cancelar / restaurar -----
    function call(method, arg) {
      if (!bridge || typeof bridge[method] !== 'function') return Promise.resolve({ ok: false, error: 'Atualize o LUMENEX para usar esta opção.' });
      var r;
      try { r = bridge[method](arg); } catch (e) { return Promise.resolve({ ok: false, error: 'Algo deu errado. Tente de novo.' }); }
      return Promise.resolve(r).then(function (x) { return x || { ok: false, error: 'Sem resposta. Tente de novo.' }; }, function () {
        return { ok: false, error: 'Falha de conexão. Confira a internet e tente de novo.' };
      });
    }
    function setSaving(on) {
      saving = on;
      root.classList.toggle('is-saving', on);
      [avFile, bnFile].forEach(function (i) { i.disabled = on; });
      Array.prototype.forEach.call(root.querySelectorAll('.gle-btns button, .gle-tile'), function (b) { b.disabled = on; });
      actions.reset.disabled = on;
      changed();
    }
    function failSave(msg, kind) {
      lastSaveFailed = true;
      sendingKind = null;
      setSaving(false);
      refreshProgress();
      barErr.textContent = msg; barErr.hidden = false;
      actions.retry.hidden = false;
      actions.save.hidden = true;
      if (kind === 'avatar') showErr(avErr, msg);
      if (kind === 'banner') showErr(bnErr, msg);
      announce(msg);
      return msg;
    }

    function uploadMedia(kind) {
      var item = kind === 'avatar' ? draft.avatar : draft.banner;
      var thumbP = item.thumb ? Promise.resolve(item.thumb) : makeThumb(item.bitmap, kind === 'avatar' ? 256 : 960, kind === 'avatar' ? 256 : 360).then(function (t) { item.thumb = t; return t; });
      return thumbP.then(function (thumb) {
        sendingKind = kind;
        refreshProgress();
        return call(kind === 'avatar' ? 'uploadAvatar' : 'uploadBanner', {
          name: item.name, mime: item.mime, data: item.data, thumb: { mime: thumb.mime, data: thumb.data }, animated: Boolean(item.animated),
        });
      }, function () {
        return { ok: false, error: 'Não foi possível preparar a miniatura dessa imagem.' };
      }).then(function (r) {
        sendingKind = null;
        refreshProgress();
        if (!r.ok) return failSave(r.error || 'Não foi possível enviar a imagem.', kind);
        if (kind === 'avatar') { revoke(draft.avatar); draft.avatar = null; avInfo.hidden = true; }
        else { revoke(draft.banner); draft.banner = null; bnInfo.hidden = true; }
        return null;
      });
    }

    function save() {
      if (saving || !isDirty()) return Promise.resolve(null);
      lastSaveFailed = false;
      barErr.hidden = true;
      actions.retry.hidden = true;
      actions.save.hidden = false;
      showErr(avErr, ''); showErr(bnErr, '');
      setSaving(true);
      var chain = Promise.resolve(null);
      if (draft.avatar) chain = chain.then(function (e) { return e || uploadMedia('avatar'); });
      else if (draft.removeAvatar) chain = chain.then(function (e) { return e || call('removeAvatar').then(function (r) { if (!r.ok) return failSave(r.error || 'Não foi possível remover o avatar.', 'avatar'); draft.removeAvatar = false; return null; }); });
      if (draft.banner) chain = chain.then(function (e) { return e || uploadMedia('banner'); });
      else if (draft.removeBanner) chain = chain.then(function (e) { return e || call('removeBanner').then(function (r) { if (!r.ok) return failSave(r.error || 'Não foi possível remover o banner.', 'banner'); draft.removeBanner = false; return null; }); });
      chain = chain.then(function (e) {
        if (e) return e;
        var look = { frame: draft.frame, effect: draft.effect, avatarCrop: normCrop(draft.crop), bannerPos: draft.bannerPos };
        var cur = { frame: base.frame, effect: base.effect, avatarCrop: base.crop, bannerPos: base.bannerPos };
        if (sameJson(look, cur)) return null;
        var isDefault = !look.frame && !look.effect && isDefaultCrop(look.avatarCrop) && look.bannerPos === 50;
        var p = isDefault ? call('resetProfileLook') : call('updateProfileLook', { frame: look.frame, effect: look.effect, avatarCrop: isDefaultCrop(look.avatarCrop) ? null : look.avatarCrop, bannerPos: look.bannerPos });
        return p.then(function (r) {
          if (!r.ok) return failSave(r.error || 'Não foi possível salvar a aparência.');
          base = { frame: look.frame, effect: look.effect, crop: look.avatarCrop, bannerPos: look.bannerPos };
          return null;
        });
      });
      return chain.then(function (e) {
        if (e) return e;
        setSaving(false);
        // Base passa a ser o que foi salvo; quando a view chegar, ela confirma.
        base = { frame: draft.frame, effect: draft.effect, crop: normCrop(draft.crop), bannerPos: draft.bannerPos };
        draft = freshDraft();
        lastMeSig = null;
        renderAll();
        announce('Personalização salva.');
        barText.textContent = 'Personalização salva.';
        return null;
      });
    }

    function cancel() {
      if (saving) return;
      revoke(draft.avatar); revoke(draft.banner);
      base = baseFromMe(me());
      draft = freshDraft();
      barErr.hidden = true; actions.retry.hidden = true; actions.save.hidden = false;
      avInfo.hidden = true; bnInfo.hidden = true;
      showErr(avErr, ''); showErr(bnErr, '');
      renderAll();
      announce('Alterações descartadas.');
    }

    function restoreDefault() {
      if (saving) return;
      revoke(draft.avatar); revoke(draft.banner);
      draft.avatar = null; draft.banner = null; draft.removeAvatar = false; draft.removeBanner = false;
      draft.frame = null; draft.effect = null; draft.crop = { x: 50, y: 50, zoom: 1 }; draft.bannerPos = 50;
      avInfo.hidden = true; bnInfo.hidden = true;
      renderAll();
      announce('Aparência padrão na prévia: sem moldura, sem efeito, enquadramento central. Salve para aplicar. Suas imagens continuam.');
    }

    function renderAll() {
      renderMedia(); renderFrames(); renderEffects(); renderPreview(); refreshProgress(); changed();
    }

    function meSig(u) {
      if (!u) return '';
      return JSON.stringify([u.avatarUrl, u.avatarThumbUrl, u.bannerUrl, u.frame, u.effect, u.avatarCrop, u.bannerPos, u.displayName, u.username, u.about, u.customStatus, u.status, u.avatarColor]);
    }

    function update() {
      if (destroyed) return;
      refreshProgress();
      var m = me();
      var sig = meSig(m);
      if (sig === lastMeSig) return;
      lastMeSig = sig;
      if (saving) return;
      if (!isDirty()) { base = baseFromMe(m); draft = freshDraft(); renderAll(); }
      else { renderPreview(); }   // nome/status mudou com rascunho aberto: só a prévia
    }

    lastMeSig = meSig(me());
    renderAll();

    return {
      update: update,
      isDirty: isDirty,
      save: save,
      cancel: cancel,
      nudge: function () {
        bar.classList.remove('is-nudge');
        void bar.offsetWidth;
        bar.classList.add('is-nudge');
        announce('Você tem alterações não salvas na personalização. Salve ou cancele antes de sair.');
        if (!actions.save.disabled && !actions.save.hidden) actions.save.focus();
        else if (!actions.retry.hidden) actions.retry.focus();
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (previewFx) previewFx.destroy();
        revoke(draft.avatar); revoke(draft.banner);
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
  }

  window.GhostLook = {
    FRAMES: FRAMES,
    EFFECTS: EFFECTS,
    MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
    avatar: avatar,
    banner: banner,
    profileCard: profileCard,
    mountCardEffect: mountCardEffect,
    renderEditor: renderEditor,
    validateImageFile: validateImageFile,
    applyCrop: applyCrop,
    _internals: { sniff: sniff, gifFrames: gifFrames, webpAnimated: webpAnimated, normCrop: normCrop },
  };
})();
