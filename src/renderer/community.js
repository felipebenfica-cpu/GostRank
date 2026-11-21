/* Recursos compartilhados pelo site e pelo aplicativo Windows. */
(function () {
  'use strict';
  const get = id => document.getElementById(id);
  const tags = { '**': 'strong', '__': 'u', '~~': 's', '*': 'em', '`': 'code', '```': 'pre', '||': 'button' };
  function append(container, text, depth = 0) {
    const pattern = /(\`\`\`|\*\*|__|~~|\|\||\`|\*)([\s\S]+?)\1/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      container.append(text.slice(cursor, match.index));
      const [, marker, body] = match;
      const node = document.createElement(tags[marker]);
      if (marker === '||') {
        node.type = 'button';
        node.className = 'btn btn-small';
        node.textContent = 'Mostrar spoiler';
        node.setAttribute('aria-expanded', 'false');
        node.addEventListener('click', () => {
          const open = node.getAttribute('aria-expanded') === 'false';
          node.textContent = open ? body : 'Mostrar spoiler';
          node.setAttribute('aria-expanded', String(open));
        });
      } else if (marker.includes('`') || depth >= 3) node.textContent = body;
      else append(node, body, depth + 1);
      container.append(node);
      cursor = match.index + match[0].length;
    }
    container.append(text.slice(cursor));
  }
  window.GhostText = { append };

  const defaults = { theme: 'dark', size: 'normal', motion: 'system' };
  const controls = { theme: get('local-theme'), size: get('local-size'), motion: get('local-motion') };
  const media = window.matchMedia?.('(prefers-color-scheme: light)');
  function apply() {
    const root = document.documentElement;
    const theme = controls.theme.value;
    root.dataset.palette = theme === 'system' ? (media?.matches ? 'light' : 'dark') : theme;
    root.dataset.chatSize = controls.size.value;
    root.dataset.motion = controls.motion.value;
  }
  for (const [key, select] of Object.entries(controls)) {
    let value = defaults[key];
    try { value = localStorage.getItem('gr:appearance:' + key) || value; } catch {}
    select.value = [...select.options].some(o => o.value === value) ? value : defaults[key];
    select.addEventListener('change', () => {
      try { localStorage.setItem('gr:appearance:' + key, select.value); } catch {}
      apply();
    });
  }
  apply();
  media?.addEventListener('change', apply);

  const dialog = get('dm-dialog'), log = get('dm-list'), status = get('dm-status');
  const input = get('dm-input'), previous = get('dm-previous');
  let peer = null, session = 0, sequence = 0, interval, name = '', latest = [], sendBusy = false;
  function paint(rows) {
    const end = log.scrollHeight - log.scrollTop - log.clientHeight < 10;
    log.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('li'), who = document.createElement('strong');
      who.textContent = row.mine ? 'Você' : name;
      const body = document.createElement('div');
      body.className = 'msg-body';
      append(body, row.body);
      item.append(who, body);
      log.append(item);
    }
    if (end) log.scrollTop = log.scrollHeight;
  }
  async function sync(mode) {
    const active = session, request = ++sequence, draft = input.value;
    const payload = { peer };
    if (mode === 'older') payload.before = latest[0]?.id;
    if (mode === 'send') payload.body = draft;
    if (mode === 'send') { sendBusy = true; get('dm-send').disabled = true; }
    try {
      const res = await window.ghostRank.social(mode === 'send' ? 'dmSend' : 'dmRead', payload);
      if (session !== active || sequence !== request) return;
      if (!res.ok) {
        latest = []; paint(latest); previous.hidden = true;
        status.textContent = res.error || 'Não foi possível carregar a conversa.';
        return;
      }
      const rows = res.rows.slice().reverse();
      if (mode === 'send' && input.value === draft) input.value = '';
      if (mode === 'older') {
        latest = rows.concat(latest);
        previous.hidden = rows.length < 50;
      } else {
        const older = rows.length ? latest.filter(r => r.id < rows[0].id) : [];
        previous.hidden = older.length ? previous.hidden : rows.length < 50;
        latest = older.concat(rows);
      }
      status.textContent = latest.length ? '' : 'Comece a conversa.';
      paint(latest);
    } catch {
      if (session === active) status.textContent = 'A conexão falhou. Tente novamente.';
    } finally {
      if (session === active && mode === 'send') { sendBusy = false; get('dm-send').disabled = false; }
    }
  }
  window.GhostDM = {
    close() { if (dialog.open) dialog.close(); },
    open(row) {
      peer = row.id; name = row.name || 'Jogador'; session++;
      latest = []; input.value = ''; log.replaceChildren(); previous.hidden = true;
      sendBusy = false; get('dm-send').disabled = false;
      get('dm-title').textContent = 'Conversa com ' + name;
      status.textContent = 'Carregando…'; dialog.showModal(); input.focus();
      sync('read'); clearInterval(interval);
      interval = setInterval(() => { if (!document.hidden && !sendBusy && !previous.disabled) sync('read'); }, 8000);
    }
  };
  dialog.addEventListener('close', () => {
    clearInterval(interval); session++; peer = null; latest = []; log.replaceChildren(); input.value = '';
    previous.disabled = false;
  });
  previous.addEventListener('click', async () => {
    if (sendBusy) return;
    previous.disabled = true;
    await sync('older');
    previous.disabled = false;
  });
  get('dm-form').addEventListener('submit', ev => {
    ev.preventDefault();
    if (!sendBusy && !previous.disabled && input.value.trim()) sync('send');
  });
})();
