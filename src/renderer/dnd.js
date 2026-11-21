/* LUMENEX - GhostDnd: arrastar e soltar genérico (Pointer Events), usado só por ADM.
   Mouse: segura e arrasta (a partir de 5 px). Toque: toque prolongado (450 ms) e arrasta.
   Esc cancela. Sem bibliotecas, sem estilo inline em HTML (posição via CSSOM).

   GhostDnd.attach(root, {
     selector: '[data-dnd]',            // o que pode ser arrastado (dentro de root)
     enabled: function () {},           // pode arrastar agora? (ex.: é ADM)
     canDrag: function (el) {},         // opcional, por item
     label: function (el) {},           // texto do "fantasma" que segue o ponteiro
     resolve: function (el, x, y) {},   // destino sob o ponteiro → { el, position: 'before'|'after'|'inside'|'end', ... } ou null
     onDrop: function (el, target) {},
     onEnd: function () {},             // opcional: o arrasto terminou (soltou ou cancelou)
     scroller: elemento que rola (padrão: root),
     longPressMs: 450
   }) → { destroy() }
*/
(function () {
  'use strict';

  var MARK_CLASSES = ['dnd-before', 'dnd-after', 'dnd-inside', 'dnd-end'];

  function attach(root, o) {
    o = o || {};
    var selector = o.selector || '[data-dnd]';
    var longPress = o.longPressMs || 450;
    var st = null;

    function scroller() { return o.scroller || root; }

    function clearMark() {
      if (st && st.target && st.target.el) MARK_CLASSES.forEach(function (c) { st.target.el.classList.remove(c); });
    }

    function onDown(ev) {
      if (st) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (typeof o.enabled === 'function' && !o.enabled()) return;
      var el = ev.target && ev.target.closest ? ev.target.closest(selector) : null;
      if (!el || !root.contains(el)) return;
      if (typeof o.canDrag === 'function' && !o.canDrag(el)) return;
      st = { el: el, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, type: ev.pointerType, armed: ev.pointerType === 'mouse', dragging: false, target: null, timer: 0, ghost: null, raf: 0 };
      if (ev.pointerType !== 'mouse') {
        st.timer = setTimeout(function () {
          if (!st || st.dragging) return;
          st.armed = true;
          begin();
          try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* opcional */ }
        }, longPress);
      }
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onCancel, true);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
      document.addEventListener('contextmenu', onContext, true);
    }

    function begin() {
      st.dragging = true;
      st.el.classList.add('is-drag-source');
      document.body.classList.add('is-dnd');
      var g = document.createElement('div');
      g.className = 'dnd-ghost';
      g.setAttribute('aria-hidden', 'true');
      g.textContent = typeof o.label === 'function' ? String(o.label(st.el) || '') : (st.el.textContent || '').trim().slice(0, 40);
      document.body.appendChild(g);
      st.ghost = g;
      place();
      update();
    }

    function place() {
      if (!st || !st.ghost) return;
      st.ghost.style.transform = 'translate(' + Math.round(st.x + 14) + 'px, ' + Math.round(st.y + 10) + 'px)';
    }

    function update() {
      if (!st || !st.dragging) return;
      var t = null;
      try { t = o.resolve ? o.resolve(st.el, st.x, st.y) : null; } catch (e) { t = null; }
      var same = t && st.target && t.el === st.target.el && t.position === st.target.position;
      if (!same) {
        clearMark();
        st.target = t;
        if (t && t.el) t.el.classList.add('dnd-' + t.position);
      } else {
        st.target = t;
      }
      autoScroll();
    }

    function autoScroll() {
      var sc = scroller();
      if (!sc || !st) return;
      var r = sc.getBoundingClientRect();
      var edge = 36;
      var dy = 0;
      if (st.y < r.top + edge) dy = -Math.ceil((r.top + edge - st.y) / 3);
      else if (st.y > r.bottom - edge) dy = Math.ceil((st.y - (r.bottom - edge)) / 3);
      if (!dy) return;
      sc.scrollTop += dy;
      if (!st.raf) st.raf = requestAnimationFrame(function () { if (st) { st.raf = 0; update(); } });
    }

    function onMove(ev) {
      if (!st || ev.pointerId !== st.id) return;
      st.x = ev.clientX;
      st.y = ev.clientY;
      var dist = Math.hypot(st.x - st.x0, st.y - st.y0);
      if (!st.dragging) {
        if (st.type !== 'mouse') {
          // tocou e mexeu antes do toque prolongado: é rolagem, não arrasto
          if (!st.armed && dist > 8) cleanup();
          return;
        }
        if (dist < 5) return;
        begin();
      }
      ev.preventDefault();
      place();
      update();
    }

    function onTouchMove(ev) {
      if (st && (st.dragging || st.armed)) ev.preventDefault();
    }

    function onContext(ev) {
      // toque prolongado no celular abre o menu do sistema; durante o arrasto, não
      if (st && (st.dragging || st.armed)) { ev.preventDefault(); ev.stopPropagation(); }
    }

    function swallowClick() {
      var stop = function (e) { e.stopPropagation(); e.preventDefault(); };
      document.addEventListener('click', stop, true);
      setTimeout(function () { document.removeEventListener('click', stop, true); }, 0);
    }

    function onUp(ev) {
      if (!st || ev.pointerId !== st.id) return;
      var was = st.dragging;
      var el = st.el;
      var target = st.target;
      cleanup();
      if (!was) return;
      ev.preventDefault();
      swallowClick();
      if (target && typeof o.onDrop === 'function') {
        try { o.onDrop(el, target); } catch (e) { /* o chamador mostra o erro */ }
      }
    }

    function onCancel(ev) { if (st && ev.pointerId === st.id) cleanup(); }

    function onKey(ev) {
      if (st && ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        var was = st.dragging;
        cleanup();
        if (was) swallowClick();
      }
    }

    function cleanup() {
      if (!st) return;
      var wasDragging = st.dragging;
      clearTimeout(st.timer);
      if (st.raf) cancelAnimationFrame(st.raf);
      clearMark();
      st.el.classList.remove('is-drag-source');
      if (st.ghost && st.ghost.parentNode) st.ghost.parentNode.removeChild(st.ghost);
      document.body.classList.remove('is-dnd');
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('touchmove', onTouchMove, { capture: true, passive: false });
      document.removeEventListener('contextmenu', onContext, true);
      st = null;
      if (wasDragging && typeof o.onEnd === 'function') { try { o.onEnd(); } catch (e) { /* ignora */ } }
    }

    root.addEventListener('pointerdown', onDown);
    return {
      destroy: function () { cleanup(); root.removeEventListener('pointerdown', onDown); },
      isDragging: function () { return !!(st && st.dragging); }
    };
  }

  /** Reordena uma lista: tira `id` e coloca antes/depois de `refId` (ou no índice). Função pura. */
  function moveInList(ids, id, refId, position) {
    var out = ids.filter(function (x) { return x !== id; });
    var i = refId == null ? (position === 'start' ? 0 : out.length) : out.indexOf(refId);
    if (i < 0) i = out.length;
    else if (refId != null && position === 'after') i += 1;
    out.splice(i, 0, id);
    return out;
  }

  window.GhostDnd = { attach: attach, moveInList: moveInList };
})();
