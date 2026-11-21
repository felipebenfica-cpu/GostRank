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
    resetError: $('reset-error'),
    btnSignin: $('btn-signin'),
    btnAccount: $('btn-account'),
    accountName: $('account-name'),
    userStatus: $('user-status'),
    userAvatar: $('user-avatar'),
    userInitials: $('user-initials'),
    userDot: $('user-dot')
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
    renderGroup();
    renderNav();
    if (voiceReady()) {
      try { window.GhostVoice.update(view); } catch (e) { /* a voz não derruba a tela */ }
    }
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
    var status = a ? a.status : null;
    var signedIn = status === 'signed_in';
    show(els.btnSignin, status === 'signed_out');
    show(els.btnAccount, signedIn);
    socialSession(a);
    show(els.userDot, signedIn);
    var name;
    if (signedIn) {
      name = accountLabel(a);
      els.btnAccount.setAttribute('aria-label', 'Minha conta, ' + name);
      els.userStatus.textContent = 'online';
    } else if (status === 'unconfigured') {
      name = 'Ghost Rank';
      els.userStatus.textContent = 'Contas ainda não configuradas';
    } else if (status === 'signed_out') {
      name = 'Sem conta';
      els.userStatus.textContent = 'Modo local';
    } else {
      name = 'Ghost Rank';
      els.userStatus.textContent = '';
    }
    els.accountName.textContent = name;
    els.accountName.title = name;
    els.userInitials.textContent = signedIn ? initials(name) : '';
    els.userAvatar.dataset.tone = signedIn ? String(toneFor(a.email || name)) : '0';
    els.userAvatar.classList.toggle('has-initials', signedIn);
    if (!a) return;
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
    if (socialAccount) readSelf();
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

  /* ---------- utilidades da janela (avatares, ícones) ---------- */

  var INVITE_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    on_track: [['polyline', { points: '3 17 9 11 13 15 21 7' }], ['polyline', { points: '15 7 21 7 21 13' }]],
    unreachable: [['path', { d: 'M12 3 2.5 20h19L12 3z' }], ['line', { x1: 12, y1: 10, x2: 12, y2: 14.5 }], ['line', { x1: 12, y1: 17.4, x2: 12, y2: 17.5 }]],
    insufficient_data: [['circle', { cx: 12, cy: 12, r: 9 }], ['line', { x1: 12, y1: 11, x2: 12, y2: 16 }], ['line', { x1: 12, y1: 7.9, x2: 12, y2: 8 }]],
    goal_reached: [['circle', { cx: 12, cy: 12, r: 9 }], ['polyline', { points: '8 12.5 11 15.5 16 9.5' }]],
    hidden: [['path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }], ['line', { x1: 4, y1: 4, x2: 20, y2: 20 }]],
    crown: [['path', { d: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z' }]],
    micOff: [['path', { d: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z' }], ['path', { d: 'M5 11a7 7 0 0 0 14 0' }], ['line', { x1: 12, y1: 18, x2: 12, y2: 21 }], ['line', { x1: 3, y1: 3, x2: 21, y2: 21 }]],
    deafened: [['path', { d: 'M3 14v-2a9 9 0 0 1 18 0v2' }], ['path', { d: 'M3 14h3v6H4a1 1 0 0 1-1-1v-5z' }], ['path', { d: 'M18 14h3v5a1 1 0 0 1-1 1h-2v-6z' }], ['line', { x1: 3, y1: 3, x2: 21, y2: 21 }]]
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

  // Iniciais: primeira letra das duas primeiras palavras ("Lua<Cheia>" -> "LC", "Eco" -> "E"); igual ao voice.js
  function initials(name) {
    var words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    var a = Array.from(words[0])[0] || '';
    var b = words.length > 1 ? (Array.from(words[1])[0] || '') : '';
    return (a + b).toUpperCase();
  }

  // Tom do avatar (0 a 5) estável por pessoa
  function toneFor(key) {
    var s = String(key || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 6;
  }

  function avatar(name, key, size) {
    var a = el('span', 'avatar avatar-' + (size || 'sm'));
    a.dataset.tone = String(toneFor(key || name));
    a.setAttribute('aria-hidden', 'true');
    a.appendChild(el('span', 'avatar-initials', initials(name)));
    var member = groupMembers(groupInfo()).find(function (m) { return m.userId === key; });
    if (member) paintPhoto(a, member.photo);
    return a;
  }

  /* ---------- navegação (trilho, canais, área principal) ---------- */

  var app = $('app');
  var nav = {
    railHome: $('rail-home'),
    railGroupItem: $('rail-group-item'),
    railGroup: $('rail-group'),
    railGroupInitials: $('rail-group-initials'),
    railAdd: $('rail-add'),
    sidebar: $('sidebar'),
    sidebarHomeTitle: $('sidebar-home-title'),
    groupHead: $('group-head'),
    groupChannels: $('group-channels'),
    rankingItem: $('ch-ranking-item'),
    sidebarCta: $('sidebar-cta'),
    sidebarAdd: $('sidebar-add'),
    head: $('channel-head'),
    title: $('channel-title'),
    topic: $('channel-topic'),
    btnSidebar: $('btn-sidebar'),
    btnMembers: $('btn-members'),
    members: $('members'),
    scrim: $('scrim'),
    main: $('conteudo')
  };
  var channels = {
    chat: $('ch-chat'),
    voice: $('ch-voice'),
    mmr: $('ch-mmr'),
    ranking: $('ch-ranking')
  };
  var views = {
    mmr: $('view-mmr'),
    chat: $('view-chat'),
    voice: $('view-voice'),
    ranking: $('view-ranking')
  };
  var GROUP_VIEWS = { chat: 1, voice: 1, ranking: 1 };
  var currentView = 'mmr';
  var lastGroupView = 'chat';
  var sidebarOpen = false;   // gaveta da barra lateral (< 700px)
  var membersOpen = false;   // lista de membros sobreposta (< 1100px)
  var membersHidden = false; // lista de membros escondida pelo usuário (>= 1100px)
  var mqWide = window.matchMedia ? window.matchMedia('(min-width: 1100px)') : null;
  var mqNarrow = window.matchMedia ? window.matchMedia('(max-width: 699.98px)') : null;

  function isWide() { return mqWide ? mqWide.matches : true; }
  function isNarrow() { return mqNarrow ? mqNarrow.matches : false; }

  function groupAllowed() {
    var a = authInfo();
    return !!(a && a.status === 'signed_in');
  }

  function viewTitle(name) {
    if (name === 'chat') return 'chat';
    if (name === 'voice') return 'Sala de voz';
    if (name === 'ranking') return 'Ranking dos fantasmas';
    return 'Meu MMR';
  }

  function viewTopic(name) {
    var gr = groupInfo();
    if (name === 'mmr') return 'Seu MMR partida a partida, até a meta';
    if (!gr) return '';
    if (name === 'voice') return 'Voz e tela compartilhada · ' + (gr.name || 'Grupo');
    return groupMeta(gr);
  }

  function selectView(name, opts) {
    opts = opts || {};
    if (GROUP_VIEWS[name] && !groupInfo()) name = 'mmr';
    var changed = currentView !== name;
    currentView = name;
    if (GROUP_VIEWS[name]) lastGroupView = name;
    Object.keys(views).forEach(function (k) { show(views[k], k === name); });
    Object.keys(channels).forEach(function (k) {
      if (k === name) channels[k].setAttribute('aria-current', 'page');
      else channels[k].removeAttribute('aria-current');
    });
    app.dataset.view = name;
    nav.head.dataset.view = name;
    nav.title.textContent = viewTitle(name);
    nav.topic.textContent = viewTopic(name);
    show(nav.topic, !!nav.topic.textContent);
    renderRail();
    renderMembersVisibility();
    if (opts.closeDrawer !== false) setSidebarOpen(false, false);
    if (name === 'chat' && changed) {
      chatState.forceScroll = true;
      scrollChatToEnd();
    }
    if (opts.focus === 'title') nav.title.focus();
    else if (opts.focus === 'input' && name === 'chat') c.input.focus();
  }

  function renderRail() {
    var inGroup = !!GROUP_VIEWS[currentView];
    setRailCurrent(nav.railHome, !inGroup);
    setRailCurrent(nav.railGroup, inGroup);
  }

  function setRailCurrent(btn, on) {
    var item = btn.closest('.rail-item');
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
    if (item) item.classList.toggle('is-current', on);
  }

  function renderNav() {
    var gr = groupInfo();
    show(nav.railGroupItem, !!gr);
    show(nav.groupHead, !!gr);
    show(nav.sidebarHomeTitle, !gr);
    show(nav.groupChannels, !!gr);
    show(nav.rankingItem, !!gr);
    show(nav.sidebarCta, !gr && groupAllowed());
    // controles de voz só fazem sentido com grupo
    show(voiceUi.userControls, !!gr);
    if (gr) {
      var gname = gr.name || 'Grupo';
      nav.railGroupInitials.textContent = initials(gname);
      nav.railGroup.setAttribute('aria-label', 'Grupo ' + gname);
      nav.railGroup.dataset.tip = gname;
      nav.railGroup.dataset.tone = String(toneFor(gr.id || gname));
    } else {
      closeGroupMenu(false);
    }
    selectView(currentView, { closeDrawer: false });
    renderVoiceChannel();
  }

  // Cliques nos canais e no trilho
  Object.keys(channels).forEach(function (k) {
    channels[k].addEventListener('click', function () {
      if (k === 'voice') {
        selectView('voice');
        joinVoice();
        return;
      }
      selectView(k, { focus: k === 'chat' && !isNarrow() ? 'input' : null });
    });
  });

  nav.railHome.addEventListener('click', function () { selectView('mmr'); });
  nav.railGroup.addEventListener('click', function () { selectView(lastGroupView); });
  nav.railAdd.addEventListener('click', function () { openGroupDialog(nav.railAdd); });
  nav.sidebarAdd.addEventListener('click', function () { openGroupDialog(nav.sidebarAdd); });

  // Setas para cima/baixo andam entre os canais visíveis
  nav.sidebar.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (!t || !t.classList || !t.classList.contains('channel')) return;
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    var list = Array.prototype.filter.call(nav.sidebar.querySelectorAll('.channel'), function (b) { return !b.closest('[hidden]'); });
    var i = list.indexOf(t);
    if (i < 0) return;
    ev.preventDefault();
    var next = ev.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus();
  });

  /* Gaveta da barra lateral (< 700px) e lista de membros (< 1100px) */

  function setSidebarOpen(open, focus) {
    open = !!open && isNarrow();
    if (sidebarOpen === open) return;
    sidebarOpen = open;
    app.dataset.sidebar = open ? 'open' : 'closed';
    nav.btnSidebar.setAttribute('aria-expanded', open ? 'true' : 'false');
    nav.btnSidebar.setAttribute('aria-label', open ? 'Fechar canais' : 'Abrir canais');
    renderScrim();
    if (open && focus) {
      var cur = nav.sidebar.querySelector('.channel[aria-current="page"]') || nav.sidebar.querySelector('.channel');
      if (cur) cur.focus();
    } else if (!open && focus) {
      nav.btnSidebar.focus();
    }
  }

  function membersAvailable() {
    return !!groupInfo() && !!GROUP_VIEWS[currentView];
  }

  function membersVisible() {
    if (!membersAvailable()) return false;
    return isWide() ? !membersHidden : membersOpen;
  }

  function renderMembersVisibility() {
    var avail = membersAvailable();
    if (!avail) membersOpen = false;
    var visible = membersVisible();
    show(nav.members, visible);
    show(nav.btnMembers, avail);
    nav.btnMembers.setAttribute('aria-pressed', visible ? 'true' : 'false');
    nav.btnMembers.setAttribute('aria-label', visible ? 'Esconder lista de membros' : 'Mostrar lista de membros');
    app.dataset.members = visible ? (isWide() ? 'docked' : 'overlay') : 'hidden';
    renderScrim();
  }

  function renderScrim() {
    var overlayMembers = membersOpen && !isWide() && membersAvailable();
    show(nav.scrim, sidebarOpen || overlayMembers);
    nav.main.inert = sidebarOpen;
  }

  nav.btnSidebar.addEventListener('click', function () { setSidebarOpen(!sidebarOpen, true); });

  nav.btnMembers.addEventListener('click', function () {
    if (isWide()) membersHidden = !membersHidden;
    else membersOpen = !membersOpen;
    renderMembersVisibility();
    if (!isWide() && membersOpen) {
      var first = nav.members.querySelector('.member');
      if (first) first.focus();
    }
  });

  nav.scrim.addEventListener('click', function () {
    if (sidebarOpen) setSidebarOpen(false, false);
    if (membersOpen) { membersOpen = false; renderMembersVisibility(); }
  });

  function onLayoutChange() {
    if (!isNarrow() && sidebarOpen) setSidebarOpen(false, false);
    renderMembersVisibility();
  }
  [mqWide, mqNarrow].forEach(function (mq) {
    if (!mq) return;
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onLayoutChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onLayoutChange);
  });

  /* ---------- grupo ---------- */

  var g = {
    dlgGroup: $('dlg-group'),
    none: $('group-none'),
    signinHint: $('group-signin-hint'),
    signinHintText: $('group-signin-hint-text'),
    already: $('group-already'),
    btnGroupSignin: $('btn-group-signin'),
    name: $('group-name'),
    menuBtn: $('group-menu-btn'),
    menu: $('group-menu'),
    error: $('group-error'),
    btnInvite: $('btn-invite'),
    btnLeave: $('btn-leave'),
    dlgInvite: $('dlg-invite'),
    inviteLoading: $('invite-loading'),
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
    removeSubmit: $('remove-submit'),
    membersVoiceSection: $('members-voice-section'),
    membersVoiceTitle: $('members-voice-title'),
    membersVoice: $('members-voice'),
    membersAllTitle: $('members-all-title'),
    membersAllSection: $('members-all-section'),
    membersList: $('members-list'),
    chatWelcomeText: $('chat-welcome-text'),
    dlgProfile: $('dlg-profile'),
    profileAvatar: $('profile-avatar'),
    profileInitials: $('profile-initials'),
    profileName: $('profile-name'),
    profileTags: $('profile-tags'),
    profileMmr: $('profile-mmr'),
    profileRemove: $('profile-remove')
  };
  var lastGroupId = null;
  var removeTarget = null;
  var removeReturnFocus = null;
  var profileTarget = null;
  var profileReturnFocus = null;
  var groupDialogReturn = null;

  function groupInfo() {
    var gr = view && view.group;
    return groupAllowed() && gr && typeof gr === 'object' ? gr : null;
  }

  function memberName(m) {
    return (m && typeof m.displayName === 'string' && m.displayName) ? m.displayName : 'Fantasma sem nome';
  }

  function groupMembers(gr) {
    return gr && Array.isArray(gr.members) ? gr.members : [];
  }

  function groupMeta(gr) {
    var n = groupMembers(gr).length;
    return n + ' de 10 ' + (n === 1 ? 'membro' : 'membros') + (gr.isOwner ? ' · você é o dono' : '');
  }

  function renderGroup() {
    var gr = groupInfo();
    var gid = gr ? gr.id : null;
    if (gid !== lastGroupId) {
      // trocou de grupo (ou saiu): limpa convite, mensagens e chat anterior
      lastGroupId = gid;
      show(g.inviteBox, false);
      setMessage(g.error, '');
      if (g.dlgInvite.open) g.dlgInvite.close();
      if (g.dlgProfile.open) g.dlgProfile.close();
      chatState.signature = '';
      chatState.lastId = null;
      chatState.forceScroll = true;
    }
    renderGroupDialog();
    var groupSettings = !!(socialAccount && gr && gr.isOwner);
    show($('btn-group-settings'), groupSettings);
    if (!groupSettings && $('dlg-group-settings').open) $('dlg-group-settings').close();
    paintPhoto($('rail-group'), gr && gr.photo);
    $('group-photo-initials').textContent = gr ? initials(gr.name) : '';
    paintPhoto($('group-photo-preview'), gr && gr.photo);
    if (!gr) {
      g.ranking.textContent = '';
      g.membersList.textContent = '';
      g.membersVoice.textContent = '';
      return;
    }

    var members = groupMembers(gr);
    if (members.length !== chatPhotos.size || members.some(function (m) {
      return !chatPhotos.has(m.userId) || chatPhotos.get(m.userId) !== m.photo;
    })) {
      chatPhotos = new Map(members.map(function (m) { return [m.userId, m.photo]; }));
      chatState.signature = '';
    }
    g.name.textContent = gr.name || 'Grupo';
    g.chatWelcomeText.textContent = 'Este é o começo do chat de ' + (gr.name || 'seu grupo') + '.';
    show(g.btnInvite, !!gr.isOwner);
    if (!gr.isOwner && g.dlgInvite.open) g.dlgInvite.close();
    renderRanking(gr, members);
    renderMembers();
    renderChat();
    if (g.dlgProfile.open && profileTarget) refreshProfile();
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

  function hasMmr(m) {
    return !!(m && m.mmr && typeof m.mmr.progress === 'number');
  }

  function mmrPct(mmr) {
    return Math.floor(Math.max(0, Math.min(1, mmr.progress)) * 100);
  }

  // Bloco de MMR (atual → meta, barra, estado, atualização): ranking e cartão de perfil
  function mmrBlock(m, parent) {
    var mmr = m.mmr;
    if (hasMmr(m)) {
      var pct = mmrPct(mmr);
      var line = el('p', 'rank-mmr');
      line.appendChild(el('strong', null, num(mmr.current)));
      line.appendChild(el('span', 'rank-arrow', ' → '));
      line.appendChild(document.createTextNode(num(mmr.goal) + ' MMR'));
      parent.appendChild(line);

      var bar = el('div', 'rank-progress');
      var track = el('div', 'mini-progress');
      track.setAttribute('aria-hidden', 'true');
      var fill = el('div', 'mini-progress-fill');
      fill.style.setProperty('--progress', String(pct));
      track.appendChild(fill);
      bar.appendChild(track);
      bar.appendChild(el('span', 'rank-pct', pct + '% da meta'));
      parent.appendChild(bar);

      var st = el('p', 'rank-status');
      var status = STATUS_LABEL[mmr.status] ? mmr.status : 'insufficient_data';
      st.dataset.status = status;
      st.appendChild(icon(status, 18, 'rank-icon'));
      st.appendChild(el('span', null, STATUS_LABEL[status]));
      parent.appendChild(st);

      var upd = toMs(mmr.updatedAt);
      if (upd != null) {
        var cap = el('p', 'caption rank-updated');
        cap.appendChild(document.createTextNode('Atualizado '));
        cap.appendChild(relTime(upd));
        parent.appendChild(cap);
      }
    } else {
      var hid = el('p', 'rank-status rank-hidden');
      hid.appendChild(icon('hidden', 18, 'rank-icon'));
      hid.appendChild(el('span', null, 'MMR escondido'));
      parent.appendChild(hid);
    }
  }

  function renderRanking(gr, members) {
    g.ranking.textContent = '';
    sortedMembers(members).forEach(function (m, idx) {
      var li = el('li', 'rank-item');
      if (m.isMe) li.classList.add('is-me');

      li.appendChild(el('span', 'rank-pos', (idx + 1) + 'º'));
      li.appendChild(avatar(memberName(m), m.userId, 'md'));

      var body = el('div', 'rank-body');
      var head = el('div', 'rank-head');
      head.appendChild(el('span', 'rank-name', memberName(m)));
      if (m.isMe) head.appendChild(el('span', 'tag tag-me', 'você'));
      if (m.isOwner) head.appendChild(el('span', 'tag', 'dono'));
      body.appendChild(head);
      mmrBlock(m, body);
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

  /* Lista de membros (coluna da direita) */

  function voiceParticipants() {
    var list = voiceState && Array.isArray(voiceState.participants) ? voiceState.participants : [];
    return (voiceState && (voiceState.connected || list.length)) ? list : [];
  }

  function memberRow(m, part) {
    var li = el('li');
    var b = el('button', 'member');
    b.type = 'button';
    b.setAttribute('aria-haspopup', 'dialog');
    var name = memberName(m);
    var av = avatar(name, m.userId, 'sm');
    if (part && part.speaking) av.classList.add('is-speaking');
    b.appendChild(av);

    var text = el('span', 'member-text');
    var top = el('span', 'member-top');
    top.appendChild(el('span', 'member-name', name));
    if (m.isOwner) {
      var crown = icon('crown', 14, 'member-crown');
      top.appendChild(crown);
    }
    text.appendChild(top);
    var sub = el('span', 'member-sub');
    if (hasMmr(m)) {
      sub.textContent = num(m.mmr.current) + ' MMR';
    } else {
      sub.textContent = 'MMR escondido';
      sub.classList.add('is-hidden');
    }
    text.appendChild(sub);
    b.appendChild(text);

    if (part && (part.deafened || part.muted)) {
      var flags = el('span', 'member-flags');
      flags.appendChild(icon(part.deafened ? 'deafened' : 'micOff', 16, 'member-flag'));
      b.appendChild(flags);
    }

    var label = name + (m.isMe ? ' (você)' : '') + (m.isOwner ? ', dono do grupo' : '') + ', ' + sub.textContent;
    if (part) label += part.deafened ? ', ensurdecido' : (part.muted ? ', mutado' : (part.speaking ? ', falando' : ''));
    b.setAttribute('aria-label', label + '. Abrir perfil');
    b.addEventListener('click', function () { openProfile(m, b); });
    li.appendChild(b);
    return li;
  }

  function renderMembers() {
    var gr = groupInfo();
    g.membersList.textContent = '';
    g.membersVoice.textContent = '';
    if (!gr) return;
    var members = groupMembers(gr);
    var parts = voiceParticipants();
    var byId = {};
    parts.forEach(function (p) { if (p && p.userId) byId[p.userId] = p; });

    var inVoice = [];
    var rest = [];
    members.forEach(function (m) { (byId[m.userId] ? inVoice : rest).push(m); });
    // quem está na voz mas não aparece nos membros (raro): mostra com o nome da sala
    var known = {};
    members.forEach(function (m) { known[m.userId] = true; });
    parts.forEach(function (p) {
      if (p && p.userId && !known[p.userId]) inVoice.push({ userId: p.userId, displayName: p.name, mmr: null });
    });

    var byName = function (a, b) {
      if (!!a.isOwner !== !!b.isOwner) return a.isOwner ? -1 : 1;
      return memberName(a).localeCompare(memberName(b), 'pt-BR');
    };
    inVoice.sort(byName).forEach(function (m) { g.membersVoice.appendChild(memberRow(m, byId[m.userId])); });
    rest.sort(byName).forEach(function (m) { g.membersList.appendChild(memberRow(m, null)); });

    show(g.membersVoiceSection, inVoice.length > 0);
    show(g.membersAllSection, rest.length > 0 || inVoice.length === 0);
    g.membersVoiceTitle.textContent = 'Na voz — ' + inVoice.length;
    g.membersAllTitle.textContent = 'Membros — ' + rest.length;
  }

  /* Cartão de perfil */

  function openProfile(m, returnTo) {
    profileTarget = m;
    profileReturnFocus = returnTo || null;
    refreshProfile();
    openDialog(g.dlgProfile);
    var closeBtn = g.dlgProfile.querySelector('.profile-close');
    if (closeBtn) closeBtn.focus();
  }

  function refreshProfile() {
    var gr = groupInfo();
    if (!profileTarget) return;
    var current = null;
    groupMembers(gr).forEach(function (m) { if (m.userId === profileTarget.userId) current = m; });
    if (!current) {
      if (g.dlgProfile.open) g.dlgProfile.close();
      return;
    }
    profileTarget = current;
    var name = memberName(current);
    g.profileName.textContent = name;
    paintPhoto(g.profileAvatar, current.photo);
    g.profileInitials.textContent = initials(name);
    g.profileAvatar.dataset.tone = String(toneFor(current.userId || name));
    g.profileTags.textContent = '';
    if (current.isMe) g.profileTags.appendChild(el('span', 'tag tag-me', 'você'));
    if (current.isOwner) {
      var t = el('span', 'tag tag-owner');
      t.appendChild(icon('crown', 12, 'member-crown'));
      t.appendChild(document.createTextNode('dono'));
      g.profileTags.appendChild(t);
    }
    show(g.profileTags, g.profileTags.childNodes.length > 0);
    g.profileMmr.textContent = '';
    g.profileMmr.appendChild(el('h3', 'profile-section', 'MMR'));
    mmrBlock(current, g.profileMmr);
    show(g.profileRemove, !!(gr && gr.isOwner && !current.isMe));
    g.profileRemove.setAttribute('aria-label', 'Remover ' + name + ' do grupo');
  }

  g.profileRemove.addEventListener('click', function () {
    var m = profileTarget;
    var back = profileReturnFocus;
    profileReturnFocus = null;
    g.dlgProfile.close();
    if (m) openRemove(m, back);
  });

  g.dlgProfile.addEventListener('close', function () {
    if (profileReturnFocus && document.body.contains(profileReturnFocus)) profileReturnFocus.focus();
    profileReturnFocus = null;
  });

  /* Menu do grupo (Convidar, Sair do grupo) */

  function menuItems() {
    return Array.prototype.filter.call(g.menu.querySelectorAll('[role="menuitem"]'), function (b) { return !b.hidden; });
  }

  function openGroupMenu(focusLast) {
    show(g.menu, true);
    g.menuBtn.setAttribute('aria-expanded', 'true');
    var items = menuItems();
    if (items.length) items[focusLast ? items.length - 1 : 0].focus();
  }

  function closeGroupMenu(returnFocus) {
    if (g.menu.hidden) return;
    show(g.menu, false);
    g.menuBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) g.menuBtn.focus();
  }

  g.menuBtn.addEventListener('click', function () {
    if (g.menu.hidden) openGroupMenu(false);
    else closeGroupMenu(true);
  });

  g.menuBtn.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      openGroupMenu(ev.key === 'ArrowUp');
    }
  });

  g.menu.addEventListener('keydown', function (ev) {
    var items = menuItems();
    var i = items.indexOf(document.activeElement);
    var next = null;
    if (ev.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (ev.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = items.length - 1;
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeGroupMenu(true); return; }
    else if (ev.key === 'Tab') { closeGroupMenu(false); return; }
    if (next === null) return;
    ev.preventDefault();
    items[next].focus();
  });

  document.addEventListener('click', function (ev) {
    if (g.menu.hidden) return;
    var t = ev.target;
    if (t && t.closest && (t.closest('#group-menu') || t.closest('#group-menu-btn'))) return;
    closeGroupMenu(false);
  });

  /* Diálogo de criar/entrar */

  function renderGroupDialog() {
    var a = authInfo();
    var allowed = groupAllowed();
    var inGroup = !!groupInfo();
    show(g.signinHint, !allowed);
    g.signinHintText.textContent = a && a.status === 'unconfigured' ? 'Contas ainda não configuradas' : 'Entre na sua conta para usar o grupo';
    show(g.btnGroupSignin, !!(a && a.status === 'signed_out'));
    show(g.already, allowed && inGroup);
    show(g.none, allowed && !inGroup);
  }

  function openGroupDialog(returnTo) {
    groupDialogReturn = returnTo || null;
    renderGroupDialog();
    openDialog(g.dlgGroup);
    if (!g.none.hidden) g.createName.focus();
    else if (!g.btnGroupSignin.hidden) g.btnGroupSignin.focus();
    else {
      var close = g.dlgGroup.querySelector('[data-close]');
      if (close) close.focus();
    }
  }

  g.dlgGroup.addEventListener('close', function () {
    if (groupDialogReturn && document.body.contains(groupDialogReturn) && !groupDialogReturn.closest('[hidden]')) groupDialogReturn.focus();
    groupDialogReturn = null;
  });

  g.btnGroupSignin.addEventListener('click', function () {
    groupDialogReturn = null;
    g.dlgGroup.close();
    openAuthDialog(ac.signin, ac.signin.email);
  });

  function afterGroupEntered() {
    groupDialogReturn = null;
    if (g.dlgGroup.open) g.dlgGroup.close();
    selectView('chat', { focus: 'title' });
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
        afterGroupEntered();
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
        afterGroupEntered();
      }
    });
  });

  // Convidar
  var inviteBusy = false;

  g.btnInvite.addEventListener('click', function () {
    closeGroupMenu(false);
    if (inviteBusy) return;
    setMessage(g.error, '');
    show(g.inviteBox, false);
    g.inviteLoading.textContent = 'Criando convite…';
    openDialog(g.dlgInvite);
    var close = g.dlgInvite.querySelector('[data-close]');
    if (close) close.focus();
    inviteBusy = true;
    call(function () { return bridge.createInvite(); }).then(function (res) {
      inviteBusy = false;
      g.inviteLoading.textContent = '';
      if (!res || !res.ok || typeof res.code !== 'string') {
        setMessage(g.error, (res && res.error) || 'Não deu para criar o convite. Tente de novo.');
        return;
      }
      g.inviteCode.textContent = res.code;
      g.inviteExpiry.textContent = res.expiresAt
        ? 'Validade do convite: ' + new Date(res.expiresAt).toLocaleString('pt-BR') + '.'
        : 'Código permanente. Pode ser usado quantas vezes precisar.';
      g.inviteStatus.textContent = '';
      show(g.inviteBox, true);
      if (g.dlgInvite.open) g.btnCopy.focus();
    });
  });

  g.dlgInvite.addEventListener('close', function () {
    if (!g.menuBtn.closest('[hidden]')) g.menuBtn.focus();
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
    closeGroupMenu(false);
    var gr = groupInfo();
    if (!gr) return;
    var others = (gr.members || []).filter(function (m) { return !m.isMe; }).length;
    var text;
    if (gr.isOwner && others > 0) {
      text = 'Você é o dono. Ao sair, a posse do grupo passa para o membro mais antigo. Você pode voltar com o código do grupo.';
    } else if (gr.isOwner) {
      text = 'Você é o único membro. Ao sair, o grupo e o chat são apagados.';
    } else {
      text = 'Você sai do ranking e do chat. Para voltar, use o código do grupo.';
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
    if (voiceReady() && typeof window.GhostVoice.leave === 'function') {
      try { window.GhostVoice.leave(); } catch (e) { /* ignora */ }
    }
    call(function () { return bridge.leaveGroup(); }).then(function (res) {
      g.leaveSubmit.disabled = false;
      var err = applyResult(res);
      if (err) {
        setMessage(g.leaveError, err);
      } else {
        g.dlgLeave.close();
        selectView('mmr', { focus: 'title' });
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
  var chatPhotos = new Map();
  var chatState = { signature: '', lastId: null, forceScroll: true, sending: false };
  var CHAT_MAX = 1000;
  var GROUP_GAP_MS = 5 * 60000;
  var timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
  var dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
  var longDayFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

  function chatTime(ms) {
    var d = new Date(ms);
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? timeFmt.format(d) : dayFmt.format(d) + ' ' + timeFmt.format(d);
  }

  function dayKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  function dayLabel(ms) {
    var today = new Date();
    var yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (dayKey(ms) === dayKey(today.getTime())) return 'Hoje';
    if (dayKey(ms) === dayKey(yesterday.getTime())) return 'Ontem';
    return longDayFmt.format(new Date(ms));
  }

  function atBottom() {
    return c.scroll.scrollHeight - c.scroll.scrollTop - c.scroll.clientHeight < 32;
  }

  function scrollChatToEnd() {
    c.scroll.scrollTop = c.scroll.scrollHeight;
  }

  function authorKey(m) {
    if (m.mine) return 'me';
    return m.userId ? 'u:' + m.userId : 'n:' + (m.displayName || '');
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
    var myName = accountLabel(authInfo());

    c.list.textContent = '';
    var prev = null; // { key, ms, day }
    msgs.forEach(function (m) {
      var mine = !!m.mine;
      var ms = toMs(m.createdAt);
      var day = ms != null ? dayKey(ms) : null;
      if (day && (!prev || prev.day !== day)) {
        var sep = el('li', 'day-divider');
        sep.appendChild(el('span', 'day-divider-text', dayLabel(ms)));
        c.list.appendChild(sep);
        prev = null;
      }
      var key = authorKey(m);
      var cont = !!(prev && prev.key === key && ms != null && prev.ms != null && ms - prev.ms >= 0 && ms - prev.ms <= GROUP_GAP_MS);
      var author = mine ? (m.displayName || myName || 'Você') : (m.displayName || 'Fantasma');

      var li = el('li', 'msg' + (mine ? ' mine' : '') + (cont ? ' is-cont' : ' is-first'));
      if (cont) {
        // sequência do mesmo autor: só o texto (autor e hora ficam para o leitor de tela)
        var hiddenMeta = el('span', 'visually-hidden', author + (ms != null ? ', ' + chatTime(ms) : '') + ': ');
        li.appendChild(hiddenMeta);
        if (ms != null) {
          var hover = el('time', 'msg-hover-time', timeFmt.format(new Date(ms)));
          hover.setAttribute('datetime', new Date(ms).toISOString());
          hover.setAttribute('aria-hidden', 'true');
          li.appendChild(hover);
        }
      } else {
        li.appendChild(avatar(author, m.userId || author, 'md'));
        var meta = el('p', 'msg-meta');
        meta.appendChild(el('span', 'msg-author', author));
        if (ms != null) {
          var t = el('time', 'msg-time', chatTime(ms));
          t.setAttribute('datetime', new Date(ms).toISOString());
          meta.appendChild(t);
        }
        li.appendChild(meta);
      }
      li.appendChild(el('p', 'msg-body', typeof m.body === 'string' ? m.body : ''));
      c.list.appendChild(li);
      prev = { key: key, ms: ms, day: day };
      if (!isFirstLoad && !mine && typeof m.id === 'number' && m.id > chatState.lastId) announce.push(m);
    });

    chatState.signature = sig;
    chatState.lastId = msgs.reduce(function (mx, m) { return typeof m.id === 'number' && m.id > mx ? m.id : mx; }, chatState.lastId || 0);

    if (stick) scrollChatToEnd();
    else c.scroll.scrollTop = prevTop;
    chatState.forceScroll = false;

    // anuncia só mensagens novas de outras pessoas, e só com o #chat aberto
    if (announce.length && currentView === 'chat') {
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

  // o campo cresce com o texto (até o limite do CSS)
  function autoGrow() {
    c.input.style.setProperty('--input-h', 'auto');
    c.input.style.setProperty('--input-h', Math.min(c.input.scrollHeight + 2, 200) + 'px');
  }

  c.input.addEventListener('input', function () {
    updateCounter();
    autoGrow();
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
        autoGrow();
        scrollChatToEnd();
      }
      c.input.focus();
    });
  });

  /* ---------- voz (voice.js: GhostVoice) ---------- */

  var voiceState = null;
  var voiceInitDone = false;
  var voiceUi = {
    channelNote: $('voice-channel-note'),
    channelState: $('voice-channel-state'),
    fallback: $('voice-fallback'),
    stage: $('voice-stage'),
    channelMembers: $('voice-channel-members'),
    connection: $('voice-connection'),
    userControls: $('voice-user-controls')
  };

  // A API nova (init/update/join) pode ainda não ter chegado: sem ela, a voz fica indisponível.
  function voiceApi() {
    var gv = window.GhostVoice;
    return gv && typeof gv.init === 'function' && typeof gv.update === 'function' && typeof gv.join === 'function' ? gv : null;
  }

  function voiceReady() { return voiceInitDone && !!voiceApi(); }

  function initVoice() {
    var gv = voiceApi();
    if (!gv) return;
    try {
      gv.init({
        bridge: bridge,
        paintPhoto: paintPhoto,
        els: {
          stage: voiceUi.stage,
          channelMembers: voiceUi.channelMembers,
          connection: voiceUi.connection,
          userControls: voiceUi.userControls
        },
        onState: onVoiceState
      });
      voiceInitDone = true;
    } catch (e) {
      voiceInitDone = false;
    }
  }

  function onVoiceState(state) {
    voiceState = state && typeof state === 'object' ? state : null;
    renderVoiceChannel();
    renderMembers();
  }

  function renderVoiceChannel() {
    var ready = voiceReady();
    var connected = !!(voiceState && voiceState.connected);
    var connecting = !!(voiceState && voiceState.connecting);
    show(voiceUi.channelNote, !ready);
    show(voiceUi.fallback, !ready);
    show(voiceUi.stage, ready);
    channels.voice.classList.toggle('is-connected', connected);
    channels.voice.classList.toggle('is-connecting', connecting && !connected);
    voiceUi.channelState.textContent = connected ? ', conectado' : (connecting ? ', conectando' : '');
    app.dataset.voice = connected ? 'connected' : 'off';
  }

  function joinVoice() {
    if (!voiceReady()) return;
    if (voiceState && (voiceState.connected || voiceState.connecting)) return;
    try { window.GhostVoice.join(); } catch (e) { /* voice.js mostra o erro no palco */ }
  }

  /* ---------- atalhos de teclado ---------- */

  document.addEventListener('keydown', function (ev) {
    // Ctrl+Shift+M (mutar) e Ctrl+Shift+D (ensurdecer), só conectado na voz
    if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey) {
      var k = String(ev.key || '').toLowerCase();
      if ((k === 'm' || k === 'd') && voiceReady() && voiceState && voiceState.connected) {
        ev.preventDefault();
        var gv = window.GhostVoice;
        try {
          if (k === 'm' && typeof gv.toggleMute === 'function') gv.toggleMute();
          if (k === 'd' && typeof gv.toggleDeafen === 'function') gv.toggleDeafen();
        } catch (e) { /* ignora */ }
        return;
      }
    }
    if (ev.key === 'Escape' && !ev.defaultPrevented) {
      if (document.querySelector('dialog[open]')) return;
      if (!g.menu.hidden) { closeGroupMenu(true); return; }
      if (membersOpen && !isWide()) {
        membersOpen = false;
        renderMembersVisibility();
        nav.btnMembers.focus();
        return;
      }
      if (sidebarOpen) setSidebarOpen(false, true);
    }
  });

  var selfProfile = null;
  var socialAccount = '';
  var friendTab = 'friend';
  var friendQuery = '';
  var friendRequest = 0;
  var profileRequest = 0;
  var privacySaving = false;
  var compact = $('appearance-compact');
  try { compact.checked = localStorage.getItem('gr:compact') === 'true'; } catch (_) { /* device storage unavailable */ }
  document.body.classList.toggle('compact', compact.checked);
  compact.addEventListener('change', function () {
    document.body.classList.toggle('compact', compact.checked);
    try { localStorage.setItem('gr:compact', String(compact.checked)); } catch (_) { /* keep for this session */ }
  });

  function social(action, value) {
    return call(function () { return bridge.social(action, value); });
  }

  function paintPhoto(node, photo) {
    var img = node.querySelector('.social-photo');
    if (typeof photo !== 'string' || photo.length > 65536 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(photo)) {
      if (img) img.remove();
      return;
    }
    if (!img) {
      img = el('img', 'social-photo');
      img.alt = '';
      node.appendChild(img);
    }
    if (img.getAttribute('src') !== photo) img.src = photo;
  }

  function displaySelf() {
    var photo = selfProfile && selfProfile.photo;
    paintPhoto(els.userAvatar, photo);
    $('account-photo-initials').textContent = initials(accountLabel(authInfo()));
    paintPhoto($('account-photo-preview'), photo);
    $('account-discoverable').disabled = !selfProfile || privacySaving;
    $('account-discoverable').checked = !!(selfProfile && selfProfile.discoverable);
  }

  async function readSelf() {
    var seq = ++profileRequest;
    var res = await social('list', null);
    if (seq !== profileRequest || !socialAccount) return;
    if (res.ok) selfProfile = (res.rows || []).find(function (r) { return r.state === 'self'; }) || null;
    else $('account-social-status').textContent = res.error || 'Não foi possível carregar o perfil.';
    displaySelf();
  }

  function socialSession(a) {
    var key = a && a.status === 'signed_in' && bridge && typeof bridge.social === 'function' ? a.email || 'signed-in' : '';
    show($('friends-item'), !!key);
    show($('social-settings'), !!key);
    if (key === socialAccount) return;
    socialAccount = key;
    profileRequest++;
    friendRequest++;
    privacySaving = false;
    selfProfile = null;
    displaySelf();
    $('account-social-status').textContent = '';
    $('friends-results').replaceChildren();
    if ($('dlg-friends').open) $('dlg-friends').close();
    if (key) readSelf();
  }

  function addFriendAction(container, label, action, row) {
    var button = el('button', 'btn btn-small', label);
    button.type = 'button';
    button.setAttribute('aria-label', label + ' · ' + (row.name || 'Jogador'));
    button.addEventListener('click', async function () {
      var seq = friendRequest;
      Array.from(container.children).forEach(function (b) { b.disabled = true; });
      var res = await social(action, row.id);
      if (seq !== friendRequest) return;
      if (res.ok) loadFriends();
      else {
        $('friends-status').textContent = res.error || 'Não foi possível atualizar a amizade.';
        Array.from(container.children).forEach(function (b) { b.disabled = false; });
      }
    });
    container.appendChild(button);
  }

  function friendRow(row) {
    var li = el('li', 'social-person');
    var name = row.name || 'Jogador';
    var badge = avatar(name, row.id, 'md');
    paintPhoto(badge, row.photo);
    li.appendChild(badge);
    var detail = el('div', 'friend-detail');
    detail.appendChild(el('strong', '', name));
    var labels = { friend: 'Amigo', incoming: 'Pedido recebido', outgoing: 'Pedido enviado' };
    if (labels[row.state]) detail.appendChild(el('small', 'caption', labels[row.state]));
    li.appendChild(detail);
    var actions = el('div', 'friend-actions');
    if (row.state === 'none') addFriendAction(actions, 'Adicionar', 'send', row);
    if (row.state === 'incoming') {
      addFriendAction(actions, 'Aceitar', 'accept', row);
      addFriendAction(actions, 'Recusar', 'remove', row);
    }
    if (row.state === 'outgoing') addFriendAction(actions, 'Cancelar pedido', 'remove', row);
    if (row.state === 'friend') addFriendAction(actions, 'Desfazer amizade', 'remove', row);
    li.appendChild(actions);
    return li;
  }

  async function loadFriends() {
    var seq = ++friendRequest;
    var results = $('friends-results');
    var status = $('friends-status');
    results.replaceChildren();
    if (friendTab === 'search' && !friendQuery) {
      status.textContent = 'Digite pelo menos duas letras do apelido.';
      return;
    }
    status.textContent = 'Buscando…';
    var search = friendTab === 'search';
    var res = await social(search ? 'search' : 'list', search ? friendQuery : null);
    if (seq !== friendRequest || !$('dlg-friends').open) return;
    if (!res.ok) { status.textContent = res.error || 'Não foi possível carregar as pessoas.'; return; }
    var rows = (res.rows || []).filter(function (row) {
      if (search) return row.state !== 'self';
      return friendTab === 'friend' ? row.state === 'friend' : ['incoming', 'outgoing'].includes(row.state);
    });
    rows.forEach(function (row) { results.appendChild(friendRow(row)); });
    status.textContent = rows.length ? '' : search ? 'Nenhuma pessoa encontrada com esse apelido.' :
      friendTab === 'pending' ? 'Você não tem pedidos pendentes.' : 'Você ainda não adicionou amigos.';
  }

  function selectFriendTab(tab) {
    friendTab = tab;
    show($('person-search'), tab === 'search');
    document.querySelectorAll('[data-friends]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.friends === tab));
    });
    if (tab === 'search') $('person-name').focus();
    loadFriends();
  }

  $('btn-friends').addEventListener('click', function () {
    friendQuery = '';
    $('person-name').value = '';
    openDialog($('dlg-friends'));
    selectFriendTab('friend');
  });
  document.querySelectorAll('[data-friends]').forEach(function (btn) {
    btn.addEventListener('click', function () { selectFriendTab(btn.dataset.friends); });
  });
  $('person-search').addEventListener('submit', function (ev) {
    ev.preventDefault();
    friendQuery = $('person-name').value.trim();
    if ([...friendQuery].length < 2) friendQuery = '';
    loadFriends();
  });
  $('dlg-friends').addEventListener('close', function () { friendRequest++; });

  $('account-discoverable').addEventListener('change', async function () {
    var key = socialAccount;
    var checked = this.checked;
    privacySaving = true;
    this.disabled = true;
    var res = await social('privacy', checked);
    if (key !== socialAccount) return;
    privacySaving = false;
    if (res.ok && selfProfile) selfProfile.discoverable = checked;
    $('account-social-status').textContent = res.ok ? 'Privacidade atualizada.' : res.error;
    displaySelf();
  });

  async function preparePhoto(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      throw new Error('Escolha uma imagem JPG, PNG ou WebP de até 8 MB.');
    }
    var bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch (_) { throw new Error('Não foi possível abrir a imagem. Escolha outro arquivo.'); }
    try {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 192;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#131726';
      ctx.fillRect(0, 0, 192, 192);
      var side = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 192, 192);
      return canvas.toDataURL('image/jpeg', 0.78);
    } finally { bitmap.close(); }
  }

  function photoControl(inputId, statusId, action) {
    var input = $(inputId);
    var clear = $(inputId + '-clear');
    async function save(file) {
      var key = socialAccount;
      var groupId = groupInfo() && groupInfo().id;
      var isCurrent = function () { return key === socialAccount && (action !== 'groupPhoto' || groupId === (groupInfo() && groupInfo().id)); };
      input.disabled = clear.disabled = true;
      $(statusId).textContent = 'Salvando foto…';
      try {
        var photo = file ? await preparePhoto(file) : null;
        if (!isCurrent()) return;
        var res = await social(action, photo);
        if (!isCurrent()) return;
        if (!res.ok) throw new Error(res.error || 'Não foi possível salvar a foto.');
        if (action === 'profilePhoto') await readSelf();
        if (groupInfo()) applyResult(await call(function () { return bridge.refreshGroup(); }));
        if (isCurrent()) $(statusId).textContent = photo ? 'Foto atualizada.' : 'Foto removida.';
      } catch (err) {
        if (isCurrent()) $(statusId).textContent = err.message || 'Não foi possível salvar a foto.';
      } finally {
        input.value = '';
        input.disabled = clear.disabled = false;
      }
    }
    input.addEventListener('change', function () { if (input.files[0]) save(input.files[0]); });
    clear.addEventListener('click', function () { save(null); });
  }

  photoControl('account-photo', 'account-social-status', 'profilePhoto');
  photoControl('group-photo', 'group-photo-status', 'groupPhoto');
  $('btn-group-settings').addEventListener('click', function () {
    closeGroupMenu(false);
    $('group-photo-status').textContent = '';
    openDialog($('dlg-group-settings'));
  });

  /* ---------- inicialização ---------- */

  function start() {
    if (!bridge) {
      els.boot.textContent = 'Não foi possível conectar ao aplicativo. Feche e abra o Ghost Rank de novo.';
      renderVoiceChannel();
      return;
    }

    initVoice();
    renderVoiceChannel();

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
