/* LUMENEX - cenário vivo do tema Frostivus. Puramente decorativo: nenhuma camada recebe cliques,
   nada daqui toca em rede, voz ou dados.
   Camadas: arte de fundo > névoa e luz (CSS) > arte da frente > canvas (estandartes, neve, brasas,
   energia arcana) atrás da interface, e um canvas ralo de neve próxima na frente dela.
   Níveis: 'full', 'low' (menos partículas, 20 qps, sem paralaxe) e 'off' (cena parada).
   prefers-reduced-motion e aba escondida param a animação; em chamada de voz usa 'low'. */
(function () {
  'use strict';
  var KEY = 'lumenex-fx';
  var W = 1920, H = 1080;
  var root = document.documentElement;
  var state = null;
  var media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function preference() {
    try {
      var v = window.localStorage.getItem(KEY);
      if (v === 'full' || v === 'low' || v === 'off') return v;
    } catch (e) { /* sem armazenamento */ }
    return 'full';
  }

  function effective() {
    if (media && media.matches) return 'off';
    var p = preference();
    if (p !== 'full') return p;
    var app = document.getElementById('app');
    if (app && app.getAttribute('data-voice') === 'connected') return 'low';
    var weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || window.innerWidth < 700;
    return weak ? 'low' : 'full';
  }

  function div(cls, parent) {
    var n = document.createElement('div');
    n.className = cls;
    parent.appendChild(n);
    return n;
  }

  function art(name, parent) {
    var img = document.createElement('img');
    img.className = 'lx-art lx-art-' + name;
    img.alt = '';
    img.decoding = 'async';
    var base = 'frostivus/' + name;
    var meta = document.querySelector('meta[name="lx-asset-base"]');
    if (meta) base = meta.content + base;
    img.sizes = '100vw';
    img.srcset = base + '-960.webp 960w, ' + base + '.webp 1920w';
    img.src = base + '.webp';
    img.addEventListener('load', function () { img.classList.add('is-ready'); });
    parent.appendChild(img);
    return img;
  }

  // Sprite macio reaproveitado por todas as partículas (nada de gradiente por quadro).
  function sprite(inner, outer) {
    var c = document.createElement('canvas');
    c.width = c.height = 32;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.35, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function seed(s) {
    var low = s.level === 'low';
    var area = Math.min(1.4, (s.vw * s.vh) / (1440 * 900));
    var k = area * s.density * (low ? 0.4 : 1);
    function many(n, make) {
      var out = [];
      for (var i = 0; i < Math.round(n * k); i++) out.push(make());
      return out;
    }
    function flake(size, speed, alpha) {
      return function () {
        return { x: rnd(0, s.vw), y: rnd(0, s.vh), r: rnd(size[0], size[1]), v: rnd(speed[0], speed[1]), a: alpha, p: rnd(0, 6.28) };
      };
    }
    s.far = many(110, flake([2, 4], [14, 28], 0.45));
    s.mid = many(55, flake([4, 8], [30, 55], 0.65));
    s.near = low ? [] : many(12, flake([9, 15], [60, 100], 0.35));
    s.embers = many(34, function () { return { x: rnd(660, 1140), y: rnd(420, 760), r: rnd(4, 10), v: rnd(14, 40), p: rnd(0, 6.28), life: rnd(0, 1) }; });
    s.arcane = many(22, function () { return { a: rnd(0, 6.28), d: rnd(30, 120), r: rnd(4, 9), v: rnd(0.2, 0.8) * (Math.random() < 0.5 ? -1 : 1) }; });
  }

  function resize(s) {
    s.vw = window.innerWidth;
    s.vh = window.innerHeight;
    // DPR limitado a 1: partículas macias não ganham nada em tela de alta densidade.
    s.back.width = s.front.width = s.vw;
    s.back.height = s.front.height = s.vh;
    s.scale = Math.max(s.vw / W, s.vh / H);
    s.ox = (s.vw - W * s.scale) / 2;
    s.oy = s.vh - H * s.scale;
    seed(s);
  }

  /* Estandarte: tiras verticais deslocadas por uma onda; brasão próprio (estrela de quatro pontas). */
  function banner(g, s, x, y, w, h, t, phase) {
    var k = s.scale;
    var n = 10;
    var top = [], bottom = [];
    for (var i = 0; i <= n; i++) {
      var u = i / n;
      var wave = Math.sin(t * 2 + u * 4 + phase) * 7;
      var px = s.ox + (x + u * w) * k + s.px;
      var py = s.oy + (y - u * w * 0.36) * k;
      top.push([px, py]);
      var tail = u === 0.5 ? -38 : 0;
      bottom.push([px + wave * k, py + (h + tail + wave) * k]);
    }
    g.beginPath();
    top.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
    for (var j = n; j >= 0; j--) g.lineTo(bottom[j][0], bottom[j][1]);
    g.closePath();
    g.fillStyle = '#6d1424';
    g.fill();
    g.lineWidth = Math.max(1, 3 * k);
    g.strokeStyle = '#C5A05C';
    g.stroke();
    var cx = (top[5][0] + bottom[5][0]) / 2, cy = (top[5][1] + bottom[5][1]) / 2, r = w * 0.26 * k;
    g.beginPath();
    [[0, -1.5], [0.28, -0.28], [1, 0], [0.28, 0.28], [0, 1.5], [-0.28, 0.28], [-1, 0], [-0.28, -0.28]].forEach(function (p, i) {
      if (i) g.lineTo(cx + p[0] * r, cy + p[1] * r); else g.moveTo(cx + p[0] * r, cy + p[1] * r);
    });
    g.closePath();
    g.fillStyle = '#E4F4FF';
    g.fill();
  }

  function draw(s, t, dt) {
    var g = s.back.getContext('2d');
    var f = s.front.getContext('2d');
    var k = s.scale;
    g.clearRect(0, 0, s.vw, s.vh);
    f.clearRect(0, 0, s.vw, s.vh);
    banner(g, s, 1708, 522, 118, 250, t, 0);

    function fall(ctx, list, wind) {
      for (var i = 0; i < list.length; i++) {
        var q = list[i];
        q.y += q.v * dt;
        q.x += (wind + Math.sin(t + q.p) * 12) * dt;
        if (q.y > s.vh + 16) { q.y = -16; q.x = rnd(0, s.vw); }
        if (q.x > s.vw + 16) q.x = -16;
        ctx.globalAlpha = q.a;
        ctx.drawImage(s.snow, q.x - q.r, q.y - q.r, q.r * 2, q.r * 2);
      }
    }
    fall(g, s.far, 6);
    fall(g, s.mid, 14);
    fall(f, s.near, 28);

    g.globalCompositeOperation = 'lighter';
    s.embers.forEach(function (e) {
      e.y -= e.v * dt;
      e.life += dt * 0.18;
      if (e.life > 1) { e.life = 0; e.x = rnd(660, 1140); e.y = rnd(640, 780); }
      g.globalAlpha = Math.sin(e.life * Math.PI) * 0.85;
      var x = s.ox + (e.x + Math.sin(t * 1.3 + e.p) * 18) * k, y = s.oy + e.y * k;
      g.drawImage(s.ember, x - e.r * k, y - e.r * k, e.r * 2 * k, e.r * 2 * k);
    });
    var ox = s.ox + 1636 * k + s.px, oy = s.oy + 188 * k;
    var pulse = 1 + Math.sin(t * 1.8) * 0.12;
    g.globalAlpha = 0.5;
    g.drawImage(s.glow, ox - 80 * k * pulse, oy - 80 * k * pulse, 160 * k * pulse, 160 * k * pulse);
    s.arcane.forEach(function (m) {
      m.a += m.v * dt;
      g.globalAlpha = 0.75;
      g.drawImage(s.glow, ox + Math.cos(m.a) * m.d * k - m.r * k, oy + Math.sin(m.a) * m.d * 0.5 * k - m.r * k, m.r * 2 * k, m.r * 2 * k);
    });
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    f.globalAlpha = 1;
  }

  function loop(now) {
    var s = state;
    if (!s) return;
    s.raf = window.requestAnimationFrame(loop);
    // Média do intervalo entre quadros da página: mede se o aparelho está dando conta.
    var raw = s.prev ? Math.min(200, now - s.prev) : 16;
    s.prev = now;
    s.avg += (raw - s.avg) * 0.05;
    var step = s.level === 'low' ? 50 : 33;
    var gap = now - s.last;
    if (gap < step - 4) return;
    s.last = now;
    // Máquina lenta: se os quadros atrasam de forma contínua, corta partículas.
    s.slow = s.avg > 28 ? s.slow + 1 : Math.max(0, s.slow - 1);
    if (s.slow > 30) {
      s.slow = 0;
      // completo -> reduzido; se ainda atrasar, menos partículas e, por fim, cena parada.
      if (s.level === 'full') s.limit = 'low';
      else if (s.density > 0.4) s.density *= 0.6;
      else s.limit = 'off';
      apply();
      return;
    }
    if (s.level === 'full' && Math.abs(s.targetX - s.px) > 0.3) {
      s.px += (s.targetX - s.px) * 0.08;
      parallax(s, s.px);
    }
    draw(s, now / 1000, Math.min(0.1, gap / 1000));
  }

  function parallax(s, px) {
    s.cena.style.transform = px ? 'translate3d(' + (px * 0.4).toFixed(1) + 'px,0,0)' : '';
    s.frente.style.transform = px ? 'translate3d(' + px.toFixed(1) + 'px,0,0)' : '';
  }

  function stop(s) {
    if (s.raf) window.cancelAnimationFrame(s.raf);
    s.raf = 0;
  }

  function apply() {
    var s = state;
    if (!s) return;
    var level = effective();
    if (s.limit === 'off') level = 'off';
    else if (s.limit === 'low' && level === 'full') level = 'low';
    stop(s);
    s.level = level;
    root.setAttribute('data-fx', level);
    seed(s);
    s.px = s.targetX = 0;
    parallax(s, 0);
    s.front.hidden = level !== 'full';
    if (level === 'off') {
      s.far = []; s.mid = []; s.near = []; s.embers = []; s.arcane = [];
      draw(s, 0, 0); // quadro parado: só o estandarte e o brilho do cajado
      return;
    }
    if (document.hidden) return;
    s.last = s.prev = 0;
    s.avg = 16;
    s.slow = 0;
    s.raf = window.requestAnimationFrame(loop);
  }

  function mount() {
    if (state || !document.body) return;
    var scene = document.createElement('div');
    scene.className = 'lx-scene';
    scene.setAttribute('aria-hidden', 'true');
    var cena = art('cena', scene);
    div('lx-rays', scene);
    div('lx-fog lx-fog-a', scene);
    var frente = art('frente', scene);
    div('lx-fog lx-fog-b', scene);
    var back = document.createElement('canvas');
    back.className = 'lx-canvas';
    scene.appendChild(back);
    var front = document.createElement('canvas');
    front.className = 'lx-canvas-front';
    front.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(scene, document.body.firstChild);
    document.body.appendChild(front);
    state = {
      scene: scene, cena: cena, frente: frente, limit: null, prev: 0, avg: 16, back: back, front: front, density: 1, level: 'off', raf: 0, last: 0, slow: 0, px: 0, targetX: 0,
      snow: sprite('rgba(228,244,255,0.95)', 'rgba(228,244,255,0)'),
      ember: sprite('rgba(255,150,70,0.95)', 'rgba(255,57,28,0)'),
      glow: sprite('rgba(120,200,255,0.9)', 'rgba(0,123,255,0)'),
    };
    state.onResize = function () { resize(state); apply(); };
    state.onMove = function (ev) { if (state.level === 'full') state.targetX = (ev.clientX / state.vw - 0.5) * -14; };
    state.onVisibility = apply;
    window.addEventListener('resize', state.onResize);
    window.addEventListener('pointermove', state.onMove, { passive: true });
    document.addEventListener('visibilitychange', state.onVisibility);
    var app = document.getElementById('app');
    if (app) {
      state.voiceWatch = new MutationObserver(apply);
      state.voiceWatch.observe(app, { attributes: true, attributeFilter: ['data-voice'] });
    }
    resize(state);
    apply();
  }

  function unmount() {
    var s = state;
    if (!s) return;
    stop(s);
    window.removeEventListener('resize', s.onResize);
    window.removeEventListener('pointermove', s.onMove);
    document.removeEventListener('visibilitychange', s.onVisibility);
    if (s.voiceWatch) s.voiceWatch.disconnect();
    s.back.width = s.front.width = 0;
    s.scene.remove();
    s.front.remove();
    root.removeAttribute('data-fx');
    state = null;
  }

  function sync() {
    var theme = window.lxThemes && window.lxThemes.get(root.getAttribute('data-theme'));
    if (theme && theme.id === 'frostivus') mount(); else unmount();
  }

  window.lxFrostivus = {
    getEffects: preference,
    setEffects: function (v) {
      if (v !== 'full' && v !== 'low' && v !== 'off') return;
      try { window.localStorage.setItem(KEY, v); } catch (e) { /* vale só até fechar */ }
      if (state) { state.limit = null; state.density = 1; }
      apply();
    },
    isRunning: function () { return Boolean(state && state.raf); },
  };

  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  if (media && media.addEventListener) media.addEventListener('change', apply);
  sync();
})();
