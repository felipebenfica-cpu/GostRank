/* Ghost Rank - tela. Script clássico em um único IIFE (funciona em app:// e file://).
   Conversa somente com window.ghostRank. Nunca usa innerHTML com dados externos. */
(function () {
  'use strict';

  var bridge = window.ghostRank;
  var view = null;
  var syncing = false; // sincronização manual em andamento nesta tela

  function $(id) { return document.getElementById(id); }

  var els = {
    boot: $('boot-message'),
    setupView: $('setup-view'),
    setupForm: $('setup-form'),
    setupAccount: $('setup-account'),
    setupStart: $('setup-start'),
    setupGoal: $('setup-goal'),
    setupGain: $('setup-gain'),
    setupError: $('setup-error'),
    setupSubmit: $('setup-submit'),
    dash: $('dashboard-view'),
    heroPlayer: $('hero-player'),
    heroMmr: $('hero-mmr'),
    goalValue: $('goal-value'),
    remaining: $('remaining-text'),
    progress: $('progress'),
    progressFill: $('progress-fill'),
    progressCaption: $('progress-caption'),
    estimate: $('estimate'),
    estimateTitle: $('estimate-title'),
    estimateDetail: $('estimate-detail'),
    wrValue: $('wr-value'),
    wrSample: $('wr-sample'),
    lastBody: $('last-body'),
    matchesEmpty: $('matches-empty'),
    matchesWrap: $('matches-wrap'),
    matchesBody: $('matches-body'),
    syncStatus: $('sync-status'),
    syncText: $('sync-text'),
    actionMessage: $('action-message'),
    btnSync: $('btn-sync'),
    btnCorrect: $('btn-correct'),
    btnSettings: $('btn-settings'),
    btnReset: $('btn-reset'),
    dlgCorrect: $('dlg-correct'),
    formCorrect: $('form-correct'),
    correctMmr: $('correct-mmr'),
    correctError: $('correct-error'),
    dlgSettings: $('dlg-settings'),
    formSettings: $('form-settings'),
    settingsGoal: $('settings-goal'),
    settingsGain: $('settings-gain'),
    settingsError: $('settings-error'),
    dlgReset: $('dlg-reset'),
    formReset: $('form-reset'),
    resetError: $('reset-error')
  };

  /* ---------- utilidades ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function show(node, visible) { node.hidden = !visible; }

  // Aceita segundos ou milissegundos (sync.* vem em ms; startTime em s).
  function toMs(t) {
    if (typeof t !== 'number' || !isFinite(t)) return null;
    return t < 1e12 ? t * 1000 : t;
  }

  var nf = new Intl.NumberFormat('pt-BR');
  function num(n) { return nf.format(n); }

  function signed(n) {
    if (n > 0) return '+' + num(n);
    if (n < 0) return '−' + num(Math.abs(n));
    return '0';
  }

  function relative(ms) {
    var secs = Math.max(0, (Date.now() - ms) / 1000);
    if (secs < 60) return 'agora há pouco';
    var mins = Math.floor(secs / 60);
    if (mins < 60) return 'há ' + mins + ' min';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return 'há ' + hours + ' h';
    var days = Math.floor(hours / 24);
    return 'há ' + days + (days === 1 ? ' dia' : ' dias');
  }

  function duration(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds)) return '—';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function heroName(id) {
    var h = view && view.heroes && view.heroes[id];
    return typeof h === 'string' && h ? h : 'Herói #' + id;
  }

  function playerName() {
    var p = view && view.profile;
    if (!p) return '';
    return p.personaName ? p.personaName : 'Jogador #' + p.accountId;
  }

  function relTime(ms) {
    var t = el('time', 'rel-time', relative(ms));
    t.dataset.ts = String(ms);
    t.setAttribute('datetime', new Date(ms).toISOString());
    return t;
  }

  function resultBadge(win) {
    var b = el('span', 'badge', win ? 'Vitória' : 'Derrota');
    b.dataset.result = win ? 'win' : 'loss';
    return b;
  }

  function deltaNode(delta, win) {
    var d = el('span', 'delta', signed(delta) + ' MMR');
    d.dataset.result = win ? 'win' : 'loss';
    return d;
  }

  /* ---------- chamadas à ponte ---------- */

  function call(fn) {
    if (!bridge) return Promise.resolve({ ok: false, error: 'A ponte com o aplicativo não está disponível.' });
    return Promise.resolve()
      .then(fn)
      .catch(function () {
        return { ok: false, error: 'Algo deu errado ao falar com o aplicativo. Tente de novo.' };
      });
  }

  function applyResult(res) {
    if (res && res.ok && res.view) {
      view = res.view;
      render();
      return null;
    }
    return (res && res.error) || 'Algo deu errado. Tente de novo.';
  }

  function setMessage(node, message) {
    if (message) {
      node.textContent = message;
      show(node, true);
    } else {
      node.textContent = '';
      show(node, false);
    }
  }

  /* ---------- renderização ---------- */

  function render() {
    show(els.boot, false);
    var configured = !!(view && view.configured);
    show(els.setupView, !configured);
    show(els.dash, configured);

    if (configured && view.summary) renderDashboard();
    updateTimers();
  }

  function renderDashboard() {
    var s = view.summary;

    els.heroPlayer.textContent = playerName();
    els.heroMmr.textContent = num(s.currentMmr);
    els.goalValue.textContent = num(s.goalMmr);

    // progresso: caminho percorrido entre o MMR inicial e a meta
    var start = typeof s.startMmr === 'number' ? s.startMmr : s.currentMmr;
    var span = s.goalMmr - start;
    var pct = 0;
    if (s.currentMmr >= s.goalMmr) pct = 100;
    else if (span > 0) pct = Math.max(0, Math.min(100, ((s.currentMmr - start) / span) * 100));
    var pctRounded = Math.floor(pct);
    els.progressFill.style.setProperty('--progress', String(pct));
    els.progress.style.setProperty('--progress', String(pct));
    els.progress.setAttribute('aria-valuenow', String(pctRounded));
    els.progress.setAttribute('aria-valuetext', pctRounded + '% do caminho entre ' + num(start) + ' e ' + num(s.goalMmr) + ' MMR');
    var moved = s.currentMmr - start;
    if (s.currentMmr >= s.goalMmr) els.progressCaption.textContent = 'Meta alcançada. Você saiu de ' + num(start) + ' MMR.';
    else if (moved > 0) els.progressCaption.textContent = '+' + num(moved) + ' MMR desde o início (' + num(start) + ')';
    else if (moved < 0) els.progressCaption.textContent = '\u2212' + num(-moved) + ' MMR em relação ao início (' + num(start) + ')';
    else els.progressCaption.textContent = 'Ponto de partida: ' + num(start) + ' MMR';

    if (s.remaining > 0) {
      els.remaining.textContent = 'Faltam ' + num(s.remaining) + ' MMR';
    } else {
      els.remaining.textContent = 'Meta alcançada';
    }

    renderEstimate(s);
    renderWinrate(s);
    renderLast(s);
    renderMatches(s);
    renderSyncStatic();
  }

  function renderEstimate(s) {
    var title = '';
    var detail = '';
    var wr = s.recentWinrate != null ? Math.round(s.recentWinrate * 100) : null;
    switch (s.status) {
      case 'goal_reached':
        title = 'Meta alcançada!';
        detail = 'Você chegou lá. Quando quiser, defina uma nova meta em Ajustes.';
        break;
      case 'unreachable':
        title = 'Com esse winrate a meta não chega';
        detail = 'Com ' + (wr != null ? wr + '% de vitórias' : 'esse winrate') +
          ' recente (50% ou menos) o MMR não sobe no longo prazo. Vencer mais partidas muda esse cenário.';
        break;
      case 'insufficient_data':
        title = 'Poucos jogos recentes para estimar';
        detail = 'Jogue mais algumas ranqueadas e a estimativa de partidas aparece aqui.';
        break;
      default:
        if (typeof s.matchesNeeded === 'number') {
          title = '~' + num(s.matchesNeeded) + (s.matchesNeeded === 1 ? ' partida' : ' partidas') + ' até a meta';
          detail = 'Estimativa mantendo o winrate recente' + (wr != null ? ' de ' + wr + '%' : '') +
            ' e ' + num(s.gainPerMatch) + ' MMR por partida.';
        } else {
          title = 'Estimativa indisponível';
          detail = 'Ainda não há dados suficientes para calcular.';
        }
    }
    els.estimate.dataset.status = s.status;
    els.estimateTitle.textContent = title;
    els.estimateDetail.textContent = detail;
  }

  function renderWinrate(s) {
    if (s.recentWinrate == null || !s.sampleSize) {
      els.wrValue.textContent = '—';
      els.wrSample.textContent = 'Sem partidas recentes para calcular.';
      return;
    }
    els.wrValue.textContent = Math.round(s.recentWinrate * 100) + '%';
    els.wrSample.textContent = 'Nas últimas ' + s.sampleSize + (s.sampleSize === 1 ? ' partida' : ' partidas');
  }

  function renderLast(s) {
    els.lastBody.textContent = '';
    var m = s.lastMatch;
    if (!m) {
      els.lastBody.appendChild(el('p', 'caption', 'Nenhuma partida rastreada ainda.'));
      return;
    }
    var row = el('div', 'last-result');
    row.appendChild(resultBadge(m.win));
    row.appendChild(deltaNode(m.delta, m.win));
    els.lastBody.appendChild(row);
    els.lastBody.appendChild(el('p', 'last-hero', heroName(m.heroId)));
    var when = el('p', 'caption');
    var ms = toMs(m.startTime);
    if (ms != null) when.appendChild(relTime(ms));
    els.lastBody.appendChild(when);
  }

  function renderMatches(s) {
    var list = Array.isArray(s.matches) ? s.matches : [];
    show(els.matchesEmpty, list.length === 0);
    show(els.matchesWrap, list.length > 0);
    els.matchesBody.textContent = '';
    list.forEach(function (m) {
      var tr = document.createElement('tr');

      var tdResult = el('td');
      tdResult.appendChild(resultBadge(m.win));
      tr.appendChild(tdResult);

      tr.appendChild(el('td', 'cell-hero', heroName(m.heroId)));

      var tdDelta = el('td', 'num');
      var d = el('span', 'delta', signed(m.delta));
      d.dataset.result = m.win ? 'win' : 'loss';
      tdDelta.appendChild(d);
      tr.appendChild(tdDelta);

      tr.appendChild(el('td', 'num', num(m.mmrAfter)));

      var tdWhen = el('td', 'cell-when');
      var ms = toMs(m.startTime);
      if (ms != null) tdWhen.appendChild(relTime(ms));
      else tdWhen.textContent = '—';
      tr.appendChild(tdWhen);

      tr.appendChild(el('td', 'num', duration(m.duration)));
      els.matchesBody.appendChild(tr);
    });
  }

  /* Sincronização: parte estática (re-renderizada a cada view) */
  function renderSyncStatic() {
    var sync = (view && view.sync) || { status: 'idle' };
    els.syncText.textContent = '';
    els.syncStatus.dataset.state = sync.status || 'idle';

    var main;
    if (sync.status === 'syncing') {
      main = el('p', 'sync-line-main', 'Sincronizando com o OpenDota…');
    } else {
      main = el('p', 'sync-line-main');
      var last = toMs(sync.lastSyncAt);
      if (last != null) {
        main.appendChild(document.createTextNode('Última sincronização: '));
        main.appendChild(relTime(last));
      } else {
        main.textContent = 'Ainda não sincronizou.';
      }
    }
    els.syncText.appendChild(main);

    if (sync.status === 'error' && sync.error) {
      els.syncText.appendChild(el('p', 'sync-line-error', 'Não deu para sincronizar: ' + sync.error));
      els.syncText.appendChild(el('p', null, 'Tentaremos de novo automaticamente.'));
    } else if (sync.status !== 'syncing') {
      var next = toMs(sync.nextSyncAt);
      if (next != null && next > Date.now()) {
        var line = el('p');
        line.appendChild(document.createTextNode('Próxima verificação automática em '));
        var span = el('span', 'countdown');
        span.dataset.until = String(next);
        line.appendChild(span);
        line.appendChild(document.createTextNode('.'));
        els.syncText.appendChild(line);
      }
    }
  }

  function formatCountdown(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    if (total < 60) return total + ' s';
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ' min ' + (s < 10 ? '0' : '') + s + ' s';
  }

  /* Atualiza o que muda com o tempo (1x por segundo) */
  function updateTimers() {
    var now = Date.now();

    var times = document.querySelectorAll('time[data-ts]');
    for (var i = 0; i < times.length; i++) {
      var ts = Number(times[i].dataset.ts);
      var text = relative(ts);
      if (times[i].textContent !== text) times[i].textContent = text;
    }

    var cds = document.querySelectorAll('.countdown[data-until]');
    for (var j = 0; j < cds.length; j++) {
      var until = Number(cds[j].dataset.until);
      cds[j].textContent = until > now ? formatCountdown(until - now) : 'instantes';
    }

    // botão "Atualizar agora"
    var sync = (view && view.sync) || {};
    var availableAt = toMs(sync.manualAvailableAt);
    var remainingMs = availableAt != null ? availableAt - now : 0;
    var label;
    var disabled = false;
    if (syncing || sync.status === 'syncing') {
      label = 'Atualizando…';
      disabled = true;
    } else if (remainingMs > 0) {
      label = 'Atualizar em ' + Math.ceil(remainingMs / 1000) + ' s';
      disabled = true;
    } else {
      label = 'Atualizar agora';
    }
    if (els.btnSync.textContent !== label) els.btnSync.textContent = label;
    if (els.btnSync.disabled !== disabled) els.btnSync.disabled = disabled;
  }

  /* ---------- configuração inicial ---------- */

  function fieldForError(message) {
    var m = String(message || '').toLowerCase();
    if (/meta/.test(m)) return els.setupGoal;
    if (/ganho/.test(m)) return els.setupGain;
    if (/inicial|mmr/.test(m)) return els.setupStart;
    return els.setupAccount;
  }

  function clearInvalid() {
    [els.setupAccount, els.setupStart, els.setupGoal, els.setupGain].forEach(function (i) {
      i.removeAttribute('aria-invalid');
      i.removeAttribute('aria-errormessage');
    });
  }

  els.setupForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setMessage(els.setupError, '');
    clearInvalid();
    els.setupSubmit.disabled = true;
    els.setupSubmit.textContent = 'Buscando suas partidas…';

    call(function () {
      return bridge.setup({
        accountInput: els.setupAccount.value.trim(),
        startMmr: els.setupStart.value.trim(),
        goalMmr: els.setupGoal.value.trim(),
        gainPerMatch: els.setupGain.value.trim()
      });
    }).then(function (res) {
      els.setupSubmit.disabled = false;
      els.setupSubmit.textContent = 'Começar a acompanhar';
      var err = applyResult(res);
      if (err) {
        setMessage(els.setupError, err);
        var field = fieldForError(err);
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-errormessage', 'setup-error');
        field.focus();
      } else {
        focusMain();
      }
    });
  });

  function focusMain() {
    var main = $('conteudo');
    if (main) main.focus({ preventScroll: true });
  }

  /* ---------- ações do painel ---------- */

  els.btnSync.addEventListener('click', function () {
    setMessage(els.actionMessage, '');
    syncing = true;
    updateTimers();
    call(function () { return bridge.sync(); }).then(function (res) {
      syncing = false;
      var err = applyResult(res);
      if (err) setMessage(els.actionMessage, err);
      updateTimers();
    });
  });

  function openDialog(dlg) {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  // Botões "Cancelar" e clique no fundo escuro fecham o diálogo
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (dlg) {
    dlg.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('[data-close]')) dlg.close();
    });
  });

  // Corrigir MMR
  els.btnCorrect.addEventListener('click', function () {
    setMessage(els.correctError, '');
    els.correctMmr.removeAttribute('aria-invalid');
    els.correctMmr.value = view && view.summary ? String(view.summary.currentMmr) : '';
    openDialog(els.dlgCorrect);
    els.correctMmr.focus();
    els.correctMmr.select();
  });

  els.formCorrect.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setMessage(els.correctError, '');
    els.correctMmr.removeAttribute('aria-invalid');
    var value = els.correctMmr.value.trim();
    call(function () { return bridge.correctMmr(value); }).then(function (res) {
      var err = applyResult(res);
      if (err) {
        setMessage(els.correctError, err);
        els.correctMmr.setAttribute('aria-invalid', 'true');
        els.correctMmr.focus();
      } else {
        els.dlgCorrect.close();
      }
    });
  });

  // Ajustes
  els.btnSettings.addEventListener('click', function () {
    setMessage(els.settingsError, '');
    els.settingsGoal.removeAttribute('aria-invalid');
    els.settingsGain.removeAttribute('aria-invalid');
    var s = view && view.summary;
    els.settingsGoal.value = s ? String(s.goalMmr) : '';
    els.settingsGain.value = s ? String(s.gainPerMatch) : '25';
    openDialog(els.dlgSettings);
    els.settingsGoal.focus();
    els.settingsGoal.select();
  });

  els.formSettings.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setMessage(els.settingsError, '');
    els.settingsGoal.removeAttribute('aria-invalid');
    els.settingsGain.removeAttribute('aria-invalid');
    var goal = els.settingsGoal.value.trim();
    var gain = els.settingsGain.value.trim();
    call(function () { return bridge.updateSettings({ goalMmr: goal, gainPerMatch: gain }); }).then(function (res) {
      var err = applyResult(res);
      if (err) {
        setMessage(els.settingsError, err);
        var f = /ganho/i.test(err) ? els.settingsGain : els.settingsGoal;
        f.setAttribute('aria-invalid', 'true');
        f.focus();
      } else {
        els.dlgSettings.close();
      }
    });
  });

  // Apagar dados
  els.btnReset.addEventListener('click', function () {
    setMessage(els.resetError, '');
    openDialog(els.dlgReset);
  });

  els.formReset.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setMessage(els.resetError, '');
    call(function () { return bridge.reset(); }).then(function (res) {
      var err = applyResult(res);
      if (err) {
        setMessage(els.resetError, err);
      } else {
        els.dlgReset.close();
        els.setupForm.reset();
        els.setupGain.value = '25';
        setMessage(els.setupError, '');
        clearInvalid();
        setMessage(els.actionMessage, '');
        els.setupAccount.focus();
      }
    });
  });

  /* ---------- inicialização ---------- */

  function start() {
    if (!bridge) {
      els.boot.textContent = 'Não foi possível conectar ao aplicativo. Feche e abra o Ghost Rank de novo.';
      return;
    }

    if (typeof bridge.onUpdate === 'function') {
      bridge.onUpdate(function (v) {
        if (v && typeof v === 'object') {
          view = v;
          render();
        }
      });
    }

    call(function () { return bridge.getView(); }).then(function (res) {
      var err = applyResult(res);
      if (err) {
        els.boot.textContent = err;
        show(els.boot, true);
        return;
      }
      if (!view.configured) els.setupAccount.focus();
    });

    window.setInterval(updateTimers, 1000);
  }

  start();
})();
