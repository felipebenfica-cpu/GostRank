/* Ghost Rank - tela. Script clássico em um único IIFE (funciona em app:// e file://).
   Conversa somente com window.ghostRank. Nunca usa innerHTML com dados externos. */
(function () {
  'use strict';

  var bridge = window.ghostRank;
  var voice = window.GhostVoice || null;
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
    resetError: $('reset-error'),
    accountBar: $('account-bar'),
    accountNote: $('account-unconfigured'),
    btnSignin: $('btn-signin'),
    btnAccount: $('btn-account'),
    accountName: $('account-name')
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
    renderAccount();
    renderTabs();
    renderGroup();
    if (voice) voice.update(view);
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

  /* ---------- conta ---------- */

  function authInfo() {
    var a = view && view.auth;
    return a && typeof a === 'object' ? a : null;
  }

  function accountLabel(a) {
    return (a && (a.displayName || a.email)) || 'Minha conta';
  }

  function renderAccount() {
    var a = authInfo();
    show(els.accountBar, !!a);
    if (!a) return;
    show(els.accountNote, a.status === 'unconfigured');
    show(els.btnSignin, a.status === 'signed_out');
    var signedIn = a.status === 'signed_in';
    show(els.btnAccount, signedIn);
    if (signedIn) {
      var name = accountLabel(a);
      els.accountName.textContent = name;
      els.btnAccount.setAttribute('aria-label', 'Minha conta, ' + name);
      els.btnAccount.title = name;
    }
    var linked = !!a.steamLinked;
    show($('steam-linked'), signedIn && linked);
    show($('btn-link-steam'), signedIn && !linked);
    show($('steam-help'), signedIn && !linked);
    if (linked) setMessage($('steam-note'), '');
  }

  var ac = {
    signin: { dlg: $('dlg-signin'), form: $('form-signin'), email: $('signin-email'), pw: $('signin-password'), error: $('signin-error'), submit: $('signin-submit'), label: 'Entrar', busy: 'Entrando…' },
    signup: { dlg: $('dlg-signup'), form: $('form-signup'), email: $('signup-email'), pw: $('signup-password'), pw2: $('signup-confirm'), error: $('signup-error'), submit: $('signup-submit'), label: 'Criar conta', busy: 'Criando…', fields: $('signup-fields'), done: $('signup-done'), cancel: $('signup-cancel'), next: $('signup-to-signin') },
    recover: { dlg: $('dlg-recover'), form: $('form-recover'), email: $('recover-email'), error: $('recover-error'), submit: $('recover-submit'), label: 'Enviar link', busy: 'Enviando…', fields: $('recover-fields'), done: $('recover-done'), cancel: $('recover-cancel'), next: $('recover-to-signin') },
    account: { dlg: $('dlg-account'), form: $('form-account'), nick: $('account-nick'), email: $('account-email'), error: $('account-error'), saved: $('account-saved'), submit: $('account-save'), label: 'Salvar', busy: 'Salvando…', signout: $('btn-signout'), del: $('btn-delete-account') },
    del: { dlg: $('dlg-delete-account'), form: $('form-delete-account'), error: $('delete-account-error'), submit: $('delete-account-submit'), label: 'Sim, apagar minha conta', busy: 'Apagando…' }
  };

  function setInvalid(input, message, errorId) {
    if (!input) return;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-errormessage', errorId);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-errormessage');
    }
  }

  function clearErrors(d) {
    setMessage(d.error, '');
    [d.email, d.pw, d.pw2, d.nick].forEach(function (i) { setInvalid(i, ''); });
  }

  function failField(d, field, message) {
    setMessage(d.error, message);
    setInvalid(field, message, d.error.id);
    if (field) field.focus();
  }

  function setBusy(d, busy) {
    d.submit.disabled = busy;
    d.submit.textContent = busy ? d.busy : d.label;
    if (busy) d.form.setAttribute('aria-busy', 'true');
    else d.form.removeAttribute('aria-busy');
    if (d.signout) d.signout.disabled = busy;
    if (d.del) d.del.disabled = busy;
  }

  // Campos de senha: sempre voltam vazios e escondidos
  function wipePasswords(d) {
    [d.pw, d.pw2].forEach(function (i) {
      if (!i) return;
      i.value = '';
      i.type = 'password';
    });
    Array.prototype.forEach.call(d.form.querySelectorAll('.pw-toggle'), function (b) {
      b.setAttribute('aria-pressed', 'false');
    });
  }

  function emailLooksValid(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function resetDialog(d) {
    clearErrors(d);
    setBusy(d, false);
    wipePasswords(d);
    if (d.fields) {
      show(d.fields, true);
      show(d.done, false);
      show(d.submit, true);
      show(d.next, false);
      d.cancel.textContent = 'Cancelar';
    }
    if (d.saved) setMessage(d.saved, '');
  }

  function openAuthDialog(d, focusEl) {
    resetDialog(d);
    openDialog(d.dlg);
    if (focusEl) focusEl.focus();
  }

  function finishDone(d) {
    show(d.fields, false);
    show(d.submit, false);
    show(d.next, true);
    d.cancel.textContent = 'Fechar';
    show(d.done, true);
    d.done.focus();
  }

  // Limpa senhas sempre que um diálogo fecha (Esc, Cancelar, sucesso)
  Object.keys(ac).forEach(function (k) {
    var d = ac[k];
    d.dlg.addEventListener('close', function () { wipePasswords(d); setBusy(d, false); });
  });

  // Alternar entre diálogos (links "Esqueci minha senha", "Criar conta"...)
  var gotoMap = { 'dlg-signin': 'signin', 'dlg-signup': 'signup', 'dlg-recover': 'recover' };
  Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (b) {
    b.addEventListener('click', function () {
      var target = ac[gotoMap[b.getAttribute('data-goto')]];
      var from = b.closest('dialog');
      var prefill = '';
      var fromD = null;
      Object.keys(ac).forEach(function (k) { if (ac[k].dlg === from) fromD = ac[k]; });
      if (fromD && fromD.email && fromD.email.value) prefill = fromD.email.value;
      if (from) from.close();
      openAuthDialog(target, target.email);
      if (prefill && !target.email.value) target.email.value = prefill;
      if (prefill) target.pw ? target.pw.focus() : target.email.focus();
    });
  });

  // Mostrar/ocultar senha
  Array.prototype.forEach.call(document.querySelectorAll('.pw-toggle'), function (b) {
    b.addEventListener('click', function () {
      var input = $(b.getAttribute('aria-controls'));
      var on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      input.type = on ? 'text' : 'password';
    });
  });

  els.btnSignin.addEventListener('click', function () { openAuthDialog(ac.signin, ac.signin.email); });

  // Entrar
  ac.signin.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var d = ac.signin;
    clearErrors(d);
    var email = d.email.value.trim();
    var password = d.pw.value;
    if (!email) return failField(d, d.email, 'Informe o seu e-mail.');
    if (!password) return failField(d, d.pw, 'Informe a sua senha.');
    setBusy(d, true);
    call(function () { return bridge.signIn({ email: email, password: password }); }).then(function (res) {
      d.pw.value = '';
      setBusy(d, false);
      var err = applyResult(res);
      if (err) {
        failField(d, /confirm/i.test(err) ? d.email : (/senha/i.test(err) ? d.pw : d.email), err);
      } else {
        d.dlg.close();
        if (els.btnAccount.hidden) focusMain(); else els.btnAccount.focus();
      }
    });
  });

  // Criar conta
  ac.signup.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var d = ac.signup;
    if (d.fields.hidden) return;
    clearErrors(d);
    var email = d.email.value.trim();
    var password = d.pw.value;
    var confirm = d.pw2.value;
    if (!email) return failField(d, d.email, 'Informe o seu e-mail.');
    if (!emailLooksValid(email)) return failField(d, d.email, 'Informe um e-mail válido.');
    if (password.length < 10) return failField(d, d.pw, 'A senha precisa ter pelo menos 10 caracteres.');
    if (password !== confirm) {
      d.pw2.value = '';
      return failField(d, d.pw2, 'As senhas não conferem.');
    }
    setBusy(d, true);
    call(function () { return bridge.signUp({ email: email, password: password }); }).then(function (res) {
      d.pw.value = '';
      d.pw2.value = '';
      setBusy(d, false);
      var err = applyResult(res);
      if (err) {
        var f = /conferem/i.test(err) ? d.pw2 : (/senha/i.test(err) ? d.pw : d.email);
        failField(d, f, err);
      } else {
        wipePasswords(d);
        finishDone(d);
      }
    });
  });

  // Recuperar senha: a mensagem é sempre a mesma, exista a conta ou não
  ac.recover.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var d = ac.recover;
    if (d.fields.hidden) return;
    clearErrors(d);
    var email = d.email.value.trim();
    if (!email) return failField(d, d.email, 'Informe o seu e-mail.');
    if (!emailLooksValid(email)) return failField(d, d.email, 'Informe um e-mail válido.');
    setBusy(d, true);
    call(function () { return bridge.recover({ email: email }); }).then(function () {
      setBusy(d, false);
      finishDone(d);
    });
  });

  // Minha conta
  function selectedVisibility() {
    var r = ac.account.form.querySelector('input[name="mmr-visibility"]:checked');
    return r ? r.value : null;
  }

  els.btnAccount.addEventListener('click', function () {
    var d = ac.account;
    var a = authInfo() || {};
    resetDialog(d);
    d.email.textContent = a.email || '';
    d.nick.value = a.displayName || '';
    Array.prototype.forEach.call(d.form.querySelectorAll('input[name="mmr-visibility"]'), function (r) {
      r.checked = r.value === (a.mmrVisibility || 'friends');
    });
    openDialog(d.dlg);
    d.nick.focus();
    d.nick.select();
  });

  ac.account.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var d = ac.account;
    clearErrors(d);
    setMessage(d.saved, '');
    var nick = d.nick.value.trim();
    var vis = selectedVisibility();
    if (nick.length < 2 || nick.length > 24) return failField(d, d.nick, 'O apelido precisa ter de 2 a 24 caracteres.');
    setBusy(d, true);
    call(function () { return bridge.updateProfile({ displayName: nick, mmrVisibility: vis }); }).then(function (res) {
      setBusy(d, false);
      var err = applyResult(res);
      if (err) failField(d, d.nick, err);
      else setMessage(d.saved, 'Alterações salvas.');
    });
  });

  ac.account.signout.addEventListener('click', function () {
    var d = ac.account;
    clearErrors(d);
    setBusy(d, true);
    call(function () { return bridge.signOut(); }).then(function (res) {
      setBusy(d, false);
      var err = applyResult(res);
      if (err) {
        setMessage(d.error, err);
      } else {
        d.dlg.close();
        if (els.btnSignin.hidden) focusMain(); else els.btnSignin.focus();
      }
    });
  });

  // Apagar conta (confirmação separada)
  ac.account.del.addEventListener('click', function () {
    openAuthDialog(ac.del, null);
    ac.del.form.querySelector('[data-close]').focus();
  });

  ac.del.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var d = ac.del;
    clearErrors(d);
    setBusy(d, true);
    call(function () { return bridge.deleteAccount(); }).then(function (res) {
      setBusy(d, false);
      var err = applyResult(res);
      if (err) {
        setMessage(d.error, err);
      } else {
        d.dlg.close();
        ac.account.dlg.close();
        if (els.btnSignin.hidden) focusMain(); else els.btnSignin.focus();
      }
    });
  });

  /* ---------- Steam ---------- */

  $('btn-link-steam').addEventListener('click', function () {
    var btn = $('btn-link-steam');
    var note = $('steam-note');
    setMessage(ac.account.error, '');
    setMessage(note, '');
    btn.disabled = true;
    call(function () { return bridge.linkSteam(); }).then(function (res) {
      btn.disabled = false;
      if (res && res.ok) {
        setMessage(note, 'Abrimos o Steam no seu navegador. Entre por lá e depois volte para o Ghost Rank.');
      } else {
        setMessage(ac.account.error, (res && res.error) || 'Não deu para abrir o Steam. Tente de novo.');
      }
    });
  });

  /* ---------- abas ---------- */

  var tabs = {
    mmr: { tab: $('tab-mmr'), panel: $('panel-mmr') },
    group: { tab: $('tab-group'), panel: $('panel-group') }
  };
  var tabOrder = ['mmr', 'group'];
  var currentTab = 'mmr';

  function groupAllowed() {
    var a = authInfo();
    return !!(a && a.status === 'signed_in');
  }

  function selectTab(name, focus) {
    if (name === 'group' && !groupAllowed()) return;
    var changed = currentTab !== name;
    currentTab = name;
    tabOrder.forEach(function (k) {
      var on = k === name;
      tabs[k].tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[k].tab.tabIndex = on ? 0 : -1;
      show(tabs[k].panel, on);
    });
    if (focus) tabs[name].tab.focus();
    if (changed && name === 'group') scrollChatToEnd();
  }

  function renderTabs() {
    show($('tabs-bar'), true);
    var allowed = groupAllowed();
    var t = tabs.group.tab;
    if (allowed) {
      t.removeAttribute('aria-disabled');
      t.removeAttribute('aria-describedby');
    } else {
      t.setAttribute('aria-disabled', 'true');
      t.setAttribute('aria-describedby', 'tab-group-hint');
    }
    show($('tab-group-hint'), !allowed);
    if (!allowed && currentTab === 'group') selectTab('mmr', false);
    else selectTab(currentTab, false);
  }

  tabOrder.forEach(function (k, i) {
    var t = tabs[k].tab;
    t.addEventListener('click', function () { selectTab(k, false); });
    t.addEventListener('keydown', function (ev) {
      var next = null;
      if (ev.key === 'ArrowRight') next = (i + 1) % tabOrder.length;
      else if (ev.key === 'ArrowLeft') next = (i - 1 + tabOrder.length) % tabOrder.length;
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = tabOrder.length - 1;
      if (next === null) return;
      ev.preventDefault();
      var name = tabOrder[next];
      // aba desabilitada recebe foco (para ouvir a dica), mas não abre
      if (name === 'group' && !groupAllowed()) tabs[name].tab.focus();
      else selectTab(name, true);
    });
  });

  /* ---------- grupo ---------- */

  var INVITE_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    on_track: [['polyline', { points: '3 17 9 11 13 15 21 7' }], ['polyline', { points: '15 7 21 7 21 13' }]],
    unreachable: [['path', { d: 'M12 3 2.5 20h19L12 3z' }], ['line', { x1: 12, y1: 10, x2: 12, y2: 14.5 }], ['line', { x1: 12, y1: 17.4, x2: 12, y2: 17.5 }]],
    insufficient_data: [['circle', { cx: 12, cy: 12, r: 9 }], ['line', { x1: 12, y1: 11, x2: 12, y2: 16 }], ['line', { x1: 12, y1: 7.9, x2: 12, y2: 8 }]],
    goal_reached: [['circle', { cx: 12, cy: 12, r: 9 }], ['polyline', { points: '8 12.5 11 15.5 16 9.5' }]],
    hidden: [['path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }], ['line', { x1: 4, y1: 4, x2: 20, y2: 20 }]]
  };
  var STATUS_LABEL = {
    goal_reached: 'Meta alcançada',
    on_track: 'No caminho da meta',
    unreachable: 'Com esse winrate a meta não chega',
    insufficient_data: 'Poucos jogos recentes para estimar'
  };

  function icon(name, size, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size || 18));
    svg.setAttribute('height', String(size || 18));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', cls || 'btn-icon');
    (ICONS[name] || []).forEach(function (part) {
      var node = document.createElementNS(SVG_NS, part[0]);
      Object.keys(part[1]).forEach(function (k) { node.setAttribute(k, String(part[1][k])); });
      svg.appendChild(node);
    });
    return svg;
  }

  var g = {
    none: $('group-none'),
    view: $('group-view'),
    name: $('group-name'),
    meta: $('group-meta'),
    error: $('group-error'),
    btnInvite: $('btn-invite'),
    btnLeave: $('btn-leave'),
    inviteBox: $('invite-box'),
    inviteCode: $('invite-code'),
    inviteExpiry: $('invite-expiry'),
    inviteStatus: $('invite-status'),
    btnCopy: $('btn-copy-invite'),
    ranking: $('ranking-list'),
    createForm: $('form-create-group'),
    createName: $('create-group-name'),
    createError: $('create-group-error'),
    createSubmit: $('create-group-submit'),
    joinForm: $('form-join-group'),
    joinCode: $('join-group-code'),
    joinError: $('join-group-error'),
    joinSubmit: $('join-group-submit'),
    dlgLeave: $('dlg-leave'),
    formLeave: $('form-leave'),
    leaveText: $('dlg-leave-text'),
    leaveError: $('leave-error'),
    leaveSubmit: $('leave-submit'),
    dlgRemove: $('dlg-remove'),
    formRemove: $('form-remove'),
    removeTitle: $('dlg-remove-title'),
    removeError: $('remove-error'),
    removeSubmit: $('remove-submit')
  };
  var lastGroupId = null;
  var removeTarget = null;
  var removeReturnFocus = null;

  function groupInfo() {
    var gr = view && view.group;
    return groupAllowed() && gr && typeof gr === 'object' ? gr : null;
  }

  function memberName(m) {
    return (m && typeof m.displayName === 'string' && m.displayName) ? m.displayName : 'Fantasma sem nome';
  }

  function renderGroup() {
    var gr = groupInfo();
    show(g.none, groupAllowed() && !gr);
    show(g.view, !!gr);
    var gid = gr ? gr.id : null;
    if (gid !== lastGroupId) {
      // trocou de grupo (ou saiu): limpa convite, mensagens e chat anterior
      lastGroupId = gid;
      show(g.inviteBox, false);
      setMessage(g.error, '');
      chatState.signature = '';
      chatState.lastId = null;
      chatState.forceScroll = true;
    }
    if (!gr) return;

    var members = Array.isArray(gr.members) ? gr.members : [];
    g.name.textContent = gr.name || 'Grupo';
    g.meta.textContent = members.length + ' de 10 ' + (members.length === 1 ? 'membro' : 'membros') +
      (gr.isOwner ? ' · você é o dono' : '');
    show(g.btnInvite, !!gr.isOwner);
    if (!gr.isOwner) show(g.inviteBox, false);
    renderRanking(gr, members);
    renderChat();
  }

  function sortedMembers(members) {
    return members.slice().sort(function (a, b) {
      var am = a.mmr && typeof a.mmr.progress === 'number';
      var bm = b.mmr && typeof b.mmr.progress === 'number';
      if (am !== bm) return am ? -1 : 1;
      if (am && b.mmr.progress !== a.mmr.progress) return b.mmr.progress - a.mmr.progress;
      if (am && b.mmr.current !== a.mmr.current) return b.mmr.current - a.mmr.current;
      return memberName(a).localeCompare(memberName(b), 'pt-BR');
    });
  }

  function renderRanking(gr, members) {
    g.ranking.textContent = '';
    sortedMembers(members).forEach(function (m, idx) {
      var li = el('li', 'rank-item');
      if (m.isMe) li.classList.add('is-me');

      li.appendChild(el('span', 'rank-pos', (idx + 1) + 'º'));

      var body = el('div', 'rank-body');
      var head = el('div', 'rank-head');
      head.appendChild(el('span', 'rank-name', memberName(m)));
      if (m.isMe) head.appendChild(el('span', 'tag tag-me', 'você'));
      if (m.isOwner) head.appendChild(el('span', 'tag', 'dono'));
      body.appendChild(head);

      var mmr = m.mmr;
      if (mmr && typeof mmr.progress === 'number') {
        var pct = Math.floor(Math.max(0, Math.min(1, mmr.progress)) * 100);
        var line = el('p', 'rank-mmr');
        line.appendChild(el('strong', null, num(mmr.current)));
        line.appendChild(el('span', 'rank-arrow', ' → '));
        line.appendChild(document.createTextNode(num(mmr.goal) + ' MMR'));
        body.appendChild(line);

        var bar = el('div', 'rank-progress');
        var track = el('div', 'mini-progress');
        track.setAttribute('aria-hidden', 'true');
        var fill = el('div', 'mini-progress-fill');
        fill.style.setProperty('--progress', String(pct));
        track.appendChild(fill);
        bar.appendChild(track);
        bar.appendChild(el('span', 'rank-pct', pct + '% da meta'));
        body.appendChild(bar);

        var st = el('p', 'rank-status');
        var status = STATUS_LABEL[mmr.status] ? mmr.status : 'insufficient_data';
        st.dataset.status = status;
        st.appendChild(icon(status, 18, 'rank-icon'));
        st.appendChild(el('span', null, STATUS_LABEL[status]));
        body.appendChild(st);

        var upd = toMs(mmr.updatedAt);
        if (upd != null) {
          var cap = el('p', 'caption rank-updated');
          cap.appendChild(document.createTextNode('Atualizado '));
          cap.appendChild(relTime(upd));
          body.appendChild(cap);
        }
      } else {
        var hid = el('p', 'rank-status rank-hidden');
        hid.appendChild(icon('hidden', 18, 'rank-icon'));
        hid.appendChild(el('span', null, 'MMR escondido'));
        body.appendChild(hid);
      }
      li.appendChild(body);

      if (gr.isOwner && !m.isMe) {
        var rm = el('button', 'btn btn-small btn-quiet-danger', 'Remover');
        rm.type = 'button';
        rm.setAttribute('aria-haspopup', 'dialog');
        rm.setAttribute('aria-label', 'Remover ' + memberName(m) + ' do grupo');
        rm.addEventListener('click', function () { openRemove(m, rm); });
        head.appendChild(rm);
      }
      g.ranking.appendChild(li);
    });
  }

  // Criar grupo
  g.createForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setMessage(g.createError, '');
    setInvalid(g.createName, '');
    var name = g.createName.value.trim();
    if (name.length < 2 || name.length > 32) {
      setMessage(g.createError, 'O nome do grupo precisa ter de 2 a 32 caracteres.');
      setInvalid(g.createName, 'x', 'create-group-error');
      g.createName.focus();
      return;
    }
    g.createSubmit.disabled = true;
    g.createSubmit.textContent = 'Criando…';
    call(function () { return bridge.createGroup(name); }).then(function (res) {
      g.createSubmit.disabled = false;
      g.createSubmit.textContent = 'Criar grupo';
      var err = applyResult(res);
      if (err) {
        setMessage(g.createError, err);
        setInvalid(g.createName, 'x', 'create-group-error');
        g.createName.focus();
      } else {
        g.createForm.reset();
        g.name.setAttribute('tabindex', '-1');
        g.name.focus();
      }
    });
  });

  // Entrar com código: maiúsculas enquanto digita
  g.joinCode.addEventListener('input', function () {
    var start = g.joinCode.selectionStart;
    var end = g.joinCode.selectionEnd;
    var up = g.joinCode.value.toUpperCase().replace(/[\s-]+/g, '').slice(0, 10);
    if (up !== g.joinCode.value) {
      g.joinCode.value = up;
      try { g.joinCode.setSelectionRange(Math.min(start, up.length), Math.min(end, up.length)); } catch (e) { /* ignora */ }
    }
  });

  g.joinForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setMessage(g.joinError, '');
    setInvalid(g.joinCode, '');
    var code = g.joinCode.value.replace(/[\s-]+/g, '').toUpperCase();
    if (!INVITE_ALPHABET.test(code)) {
      setMessage(g.joinError, 'O código tem 10 letras e números (sem I, L, O, 0 e 1), como K7M2QX9PTA.');
      setInvalid(g.joinCode, 'x', 'join-group-error');
      g.joinCode.focus();
      return;
    }
    g.joinSubmit.disabled = true;
    g.joinSubmit.textContent = 'Entrando…';
    call(function () { return bridge.joinGroup(code); }).then(function (res) {
      g.joinSubmit.disabled = false;
      g.joinSubmit.textContent = 'Entrar no grupo';
      var err = applyResult(res);
      if (err) {
        setMessage(g.joinError, err);
        setInvalid(g.joinCode, 'x', 'join-group-error');
        g.joinCode.focus();
      } else {
        g.joinForm.reset();
        g.name.setAttribute('tabindex', '-1');
        g.name.focus();
      }
    });
  });

  // Convidar
  var dateFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  g.btnInvite.addEventListener('click', function () {
    setMessage(g.error, '');
    g.btnInvite.disabled = true;
    call(function () { return bridge.createInvite(); }).then(function (res) {
      g.btnInvite.disabled = false;
      if (!res || !res.ok || typeof res.code !== 'string') {
        setMessage(g.error, (res && res.error) || 'Não deu para criar o convite. Tente de novo.');
        return;
      }
      g.inviteCode.textContent = res.code;
      var exp = toMs(typeof res.expiresAt === 'string' ? Date.parse(res.expiresAt) : res.expiresAt);
      g.inviteExpiry.textContent = exp != null
        ? 'Vale até ' + dateFmt.format(new Date(exp)) + ' e serve para até 5 pessoas.'
        : 'Serve para até 5 pessoas.';
      g.inviteStatus.textContent = '';
      show(g.inviteBox, true);
      g.btnCopy.focus();
    });
  });

  function selectInviteCode() {
    var sel = window.getSelection && window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    var range = document.createRange();
    range.selectNodeContents(g.inviteCode);
    sel.addRange(range);
  }

  g.btnCopy.addEventListener('click', function () {
    var code = g.inviteCode.textContent;
    var fallback = function () {
      g.inviteCode.focus();
      selectInviteCode();
      g.inviteStatus.textContent = 'Não deu para copiar sozinho. O código está selecionado: aperte Ctrl+C.';
    };
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return fallback();
      navigator.clipboard.writeText(code).then(function () {
        g.inviteStatus.textContent = 'Código copiado. Agora é só mandar para o seu amigo.';
      }, fallback);
    } catch (e) {
      fallback();
    }
  });

  // Sair do grupo
  g.btnLeave.addEventListener('click', function () {
    var gr = groupInfo();
    if (!gr) return;
    var others = (gr.members || []).filter(function (m) { return !m.isMe; }).length;
    var text;
    if (gr.isOwner && others > 0) {
      text = 'Você é o dono. Ao sair, a posse do grupo passa para o membro mais antigo. Você só volta com um novo convite.';
    } else if (gr.isOwner) {
      text = 'Você é o único membro. Ao sair, o grupo e o chat são apagados.';
    } else {
      text = 'Você sai do ranking e do chat. Para voltar, vai precisar de um novo convite.';
    }
    g.leaveText.textContent = text;
    setMessage(g.leaveError, '');
    g.leaveSubmit.disabled = false;
    openDialog(g.dlgLeave);
    g.formLeave.querySelector('[data-close]').focus();
  });

  g.formLeave.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setMessage(g.leaveError, '');
    g.leaveSubmit.disabled = true;
    call(function () { return bridge.leaveGroup(); }).then(function (res) {
      g.leaveSubmit.disabled = false;
      var err = applyResult(res);
      if (err) {
        setMessage(g.leaveError, err);
      } else {
        g.dlgLeave.close();
        if (!g.createName.closest('[hidden]')) g.createName.focus();
        else focusMain();
      }
    });
  });

  // Remover membro
  function openRemove(member, button) {
    removeTarget = member;
    removeReturnFocus = button;
    g.removeTitle.textContent = 'Remover ' + memberName(member) + ' do grupo?';
    setMessage(g.removeError, '');
    g.removeSubmit.disabled = false;
    openDialog(g.dlgRemove);
    g.formRemove.querySelector('[data-close]').focus();
  }

  g.formRemove.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!removeTarget) return;
    var id = removeTarget.userId;
    setMessage(g.removeError, '');
    g.removeSubmit.disabled = true;
    call(function () { return bridge.removeMember(id); }).then(function (res) {
      g.removeSubmit.disabled = false;
      var err = applyResult(res);
      if (err) {
        setMessage(g.removeError, err);
      } else {
        removeTarget = null;
        g.dlgRemove.close();
      }
    });
  });

  g.dlgRemove.addEventListener('close', function () {
    if (removeReturnFocus && document.body.contains(removeReturnFocus)) removeReturnFocus.focus();
    else focusMain();
    removeReturnFocus = null;
  });

  /* ---------- chat ---------- */

  var c = {
    scroll: $('chat-scroll'),
    list: $('chat-list'),
    empty: $('chat-empty'),
    status: $('chat-status'),
    live: $('chat-live'),
    form: $('form-chat'),
    input: $('chat-input'),
    send: $('chat-send'),
    counter: $('chat-counter'),
    error: $('chat-error')
  };
  var chatState = { signature: '', lastId: null, forceScroll: true, sending: false };
  var CHAT_MAX = 1000;
  var timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
  var dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

  function chatTime(ms) {
    var d = new Date(ms);
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? timeFmt.format(d) : dayFmt.format(d) + ' ' + timeFmt.format(d);
  }

  function atBottom() {
    return c.scroll.scrollHeight - c.scroll.scrollTop - c.scroll.clientHeight < 32;
  }

  function scrollChatToEnd() {
    c.scroll.scrollTop = c.scroll.scrollHeight;
  }

  function renderChat() {
    var chat = (view && view.chat) || { messages: [], status: 'idle' };
    var msgs = Array.isArray(chat.messages) ? chat.messages : [];
    show(c.status, chat.status === 'error');
    show(c.empty, msgs.length === 0);

    var first = msgs.length ? msgs[0].id : '';
    var last = msgs.length ? msgs[msgs.length - 1].id : '';
    var sig = lastGroupId + '|' + msgs.length + '|' + first + '|' + last;
    if (sig === chatState.signature) return;

    var stick = chatState.forceScroll || atBottom();
    var prevTop = c.scroll.scrollTop;
    var announce = [];
    var isFirstLoad = chatState.lastId === null;

    c.list.textContent = '';
    msgs.forEach(function (m) {
      var mine = !!m.mine;
      var li = el('li', 'msg' + (mine ? ' mine' : ''));
      var meta = el('p', 'msg-meta');
      meta.appendChild(el('span', 'msg-author', mine ? 'Você' : (m.displayName || 'Fantasma')));
      var ms = toMs(m.createdAt);
      if (ms != null) {
        var t = el('time', 'msg-time', chatTime(ms));
        t.setAttribute('datetime', new Date(ms).toISOString());
        meta.appendChild(t);
      }
      li.appendChild(meta);
      li.appendChild(el('p', 'msg-body', typeof m.body === 'string' ? m.body : ''));
      c.list.appendChild(li);
      if (!isFirstLoad && !mine && typeof m.id === 'number' && m.id > chatState.lastId) announce.push(m);
    });

    chatState.signature = sig;
    chatState.lastId = msgs.reduce(function (mx, m) { return typeof m.id === 'number' && m.id > mx ? m.id : mx; }, chatState.lastId || 0);

    if (stick) scrollChatToEnd();
    else c.scroll.scrollTop = prevTop;
    chatState.forceScroll = false;

    // anuncia só mensagens novas de outras pessoas, e só com a aba Grupo aberta
    if (announce.length && currentTab === 'group') {
      var lm = announce[announce.length - 1];
      var who = lm.displayName || 'Fantasma';
      c.live.textContent = (announce.length > 1 ? announce.length + ' mensagens novas. Última de ' : 'Mensagem de ') + who + ': ' + lm.body;
    }
  }

  // se o usuário estava no fim, continua no fim quando a área muda de tamanho
  var chatStuck = true;
  c.scroll.addEventListener('scroll', function () { chatStuck = atBottom(); });
  if (typeof window.ResizeObserver === 'function') {
    new window.ResizeObserver(function () { if (chatStuck) scrollChatToEnd(); }).observe(c.scroll);
  }

  function updateCounter() {
    var len = c.input.value.length;
    if (len > 900) {
      c.counter.textContent = len + ' de ' + CHAT_MAX + ' caracteres';
      c.counter.dataset.full = len >= CHAT_MAX ? 'true' : 'false';
      show(c.counter, true);
    } else {
      show(c.counter, false);
    }
  }

  c.input.addEventListener('input', function () {
    updateCounter();
    if (!c.error.hidden) setMessage(c.error, '');
  });

  c.input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault();
      if (typeof c.form.requestSubmit === 'function') c.form.requestSubmit();
      else c.form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  c.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (chatState.sending) return;
    setMessage(c.error, '');
    var body = c.input.value.trim();
    if (!body) {
      c.input.focus();
      return;
    }
    if (body.length > CHAT_MAX) {
      setMessage(c.error, 'A mensagem pode ter no máximo 1000 caracteres.');
      c.input.focus();
      return;
    }
    chatState.sending = true;
    c.send.disabled = true;
    call(function () { return bridge.sendMessage(body); }).then(function (res) {
      chatState.sending = false;
      c.send.disabled = false;
      chatState.forceScroll = true;
      var err = applyResult(res);
      if (err) {
        chatState.forceScroll = false;
        setMessage(c.error, err);
      } else {
        c.input.value = '';
        updateCounter();
        scrollChatToEnd();
      }
      c.input.focus();
    });
  });

  /* ---------- inicialização ---------- */

  function start() {
    if (!bridge) {
      els.boot.textContent = 'Não foi possível conectar ao aplicativo. Feche e abra o Ghost Rank de novo.';
      return;
    }

    if (voice) voice.init({ bridge: bridge, getView: function () { return view; } });

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
