'use strict';

// Página isolada: nenhum SDK, analytics, imagem ou redirecionador externo recebe o link.
(() => {
  const base = 'https://jdipignyikikagjvynve.supabase.co/auth/v1';
  const key = 'sb_publishable_'; // substituído pelo build com a chave pública do projeto
  const isReset = location.pathname === '/reset-password';
  const title = document.getElementById('title');
  const status = document.getElementById('status');
  const verify = document.getElementById('verify');
  const form = document.getElementById('password-form');
  const save = document.getElementById('save');
  title.textContent = isReset ? 'Redefinir senha' : 'Confirmar e-mail';

  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const tokenHash = fragment.get('token_hash') || query.get('token_hash');
  const kind = isReset ? 'recovery' : 'signup';
  const incomingType = fragment.get('type') || query.get('type');
  const error = fragment.get('error_code') || query.get('error_code') || fragment.get('error') || query.get('error');
  let accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  // Remover inclusive tokens e códigos de erro da barra de endereços antes da primeira requisição.
  history.replaceState(null, '', location.pathname);

  const invalid = () => { status.textContent = 'Link inválido ou expirado. Solicite um novo e-mail no LUMENEX.'; };
  const headers = (token) => ({ apikey: key, Authorization: 'Bearer ' + (token || key), 'Content-Type': 'application/json' });
  async function api(path, body, token) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST', headers: headers(token),
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) throw Error('invalid_link');
    return response.json();
  }
  async function validateSession() {
    if (!accessToken || !refreshToken || fragment.get('type') !== kind) { invalid(); return; }
    try {
      await api('/user', undefined, accessToken);
      if (isReset) { form.hidden = false; status.textContent = 'Crie uma nova senha com pelo menos 10 caracteres.'; }
      else { status.textContent = 'E-mail confirmado. Você já pode entrar no LUMENEX.'; accessToken = null; }
    } catch { accessToken = null; invalid(); }
  }

  if (error) invalid();
  else if (tokenHash && incomingType === kind && !accessToken) {
    status.textContent = isReset ? 'Clique para abrir a redefinição de senha.' : 'Clique para confirmar seu e-mail.';
    verify.hidden = false;
    verify.addEventListener('click', async () => {
      verify.disabled = true;
      status.textContent = 'Verificando…';
      try {
        const data = await api('/verify', { token_hash: tokenHash, type: kind });
        accessToken = data.access_token;
        if (!accessToken) throw Error('invalid_link');
        if (isReset) { form.hidden = false; status.textContent = 'Crie uma nova senha com pelo menos 10 caracteres.'; }
        else { status.textContent = 'E-mail confirmado. Você já pode entrar no LUMENEX.'; accessToken = null; }
        verify.hidden = true;
      } catch { invalid(); verify.disabled = false; }
    });
  } else if (accessToken) validateSession();
  else invalid();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!accessToken) { invalid(); return; }
    const password = document.getElementById('password').value;
    if (password.length < 10 || password !== document.getElementById('password-again').value) {
      status.textContent = 'As senhas precisam ser iguais e ter pelo menos 10 caracteres.';
      return;
    }
    save.disabled = true;
    status.textContent = 'Salvando nova senha…';
    try {
      const response = await fetch(base + '/user', {
        method: 'PUT', headers: headers(accessToken), body: JSON.stringify({ password }),
        redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) throw Error('update_failed');
      // Descartar a sessão de recuperação; o login normal é feito na página inicial.
      await fetch(base + '/logout?scope=local', { method: 'POST', headers: headers(accessToken), redirect: 'error' }).catch(() => {});
      accessToken = null;
      form.reset();
      form.hidden = true;
      status.textContent = 'Senha alterada. Volte para entrar com a nova senha.';
    } catch { status.textContent = 'Não foi possível salvar. Solicite um novo link e tente novamente.'; save.disabled = false; }
  });
})();
