# Ghost Rank — Plano da Etapa 1 (contas e cadastro)

Fonte: documento de produto, seções "Etapa 1", "Segurança" 1, 2 e 8.

## Decisões

- Projeto Supabase: `jdipignyikikagjvynve` (URL `https://jdipignyikikagjvynve.supabase.co`). A chave pública (anon/publishable) vem do usuário e fica em arquivo local ignorado pelo git.
- Toda chamada de rede de conta acontece no **processo principal**, por `fetch` direto nas rotas REST do Supabase (GoTrue e PostgREST). Sem dependência nova. A tela continua sem rede (CSP `connect-src 'none'`).
- Sessão guardada cifrada (safeStorage) em arquivo separado `ghost-rank-session.dat`.
- Entrega em duas partes. **1A (esta):** e-mail com confirmação, recuperação de senha, perfil, privacidade do MMR, apagar conta. **1B (depois):** login pela Steam, que exige uma função no servidor (Edge Function) para validar o OpenID. Não entra aqui.
- A chave `service_role` nunca entra no repositório nem no app.

## Contratos

### Configuração — src/main/config.js
`loadConfig({ env = process.env, fs, dir }) -> { supabaseUrl, anonKey } | null`
Lê `GHOST_RANK_SUPABASE_URL` / `GHOST_RANK_SUPABASE_ANON_KEY` ou o arquivo `config.local.json` na raiz do projeto (ignorado pelo git). Recusa URL que não seja `https://*.supabase.co`. Sem config -> `null` e o app mostra "contas indisponíveis" sem quebrar o rastreador. Existe `config.example.json` com a URL e chave vazia.

### Core — src/core/credentials.js
`validateEmail(s) -> {ok,value?,error?}` (minúsculas, aparado, até 254 caracteres, formato simples).
`validatePassword(s) -> {ok,error?}` mínimo 10 caracteres, máximo 72, recusa só repetição (`aaaaaaaaaa`) e as 20 senhas mais comuns da lista embutida; mensagens em português.
`validateDisplayName(s) -> {ok,value?,error?}` 2 a 24 caracteres, sem caracteres de controle nem `<` `>`.
`MMR_VISIBILITY = ['friends','group','nobody']`, `validateVisibility(v)`.

### Main — src/main/auth.js
`createAuthClient({ fetchImpl, supabaseUrl, anonKey, now, timeoutMs = 10000 })`
- `signUp({email,password})` -> `{ needsConfirmation: true }` (POST /auth/v1/signup). Resposta igual exista a conta ou não.
- `signIn({email,password})` -> `Session` (POST /auth/v1/token?grant_type=password)
- `refresh(refreshToken)` -> `Session` (grant_type=refresh_token)
- `recover({email})` -> `{ ok:true }` (POST /auth/v1/recover); sempre sucesso na tela.
- `signOut(accessToken)` (POST /auth/v1/logout?scope=local)
- `Session = { accessToken, refreshToken, expiresAt /*segundos*/, user: { id, email, emailConfirmed } }`
- `AuthError` com `code` ('invalid_credentials','email_not_confirmed','weak_password','rate_limited','network','timeout','bad_response','unconfigured') e mensagem em português. Mesma mensagem para "conta não existe" e "senha errada".
- Cabeçalhos `apikey` e `Authorization: Bearer <anonKey>` nas rotas públicas; token do usuário nas rotas autenticadas. Nunca registra e-mail, senha nem token em log.

### Main — src/main/session.js
`createSessionManager({ store, auth, now })` com `store` no formato do store.js.
`get() -> Session|null` (renova sozinho quando faltar menos de 60 s; falha de renovação por rede mantém a sessão, por recusa a apaga),
`set(session)`, `clear()`.

### Main — src/main/profile.js
`createProfileClient({ fetchImpl, supabaseUrl, anonKey, getAccessToken })`
- `get() -> { displayName, mmrVisibility, steamAccountId|null }` (GET /rest/v1/profiles?select=...&id=eq.<uid>)
- `update({ displayName?, mmrVisibility? })` (PATCH /rest/v1/profiles?id=eq.<uid>)
- `deleteAccount()` (POST /rest/v1/rpc/delete_my_account)
Valida entrada com o core antes de enviar; `id` vem do token (campo `sub`), nunca da tela.

### Banco — supabase/migrations/0001_perfis.sql
Tabela `public.profiles (id uuid pk references auth.users on delete cascade, display_name text, mmr_visibility text default 'friends' check in (...), steam_account_id bigint unique null, created_at, updated_at)`.
RLS ligada. Políticas: `select` do próprio perfil; `update` do próprio perfil só das colunas `display_name` e `mmr_visibility` (steam_account_id só por função do servidor); sem `insert` nem `delete` direto.
Gatilho que cria o perfil no cadastro. Função `delete_my_account()` (`security definer`, `search_path` fixo, só para `authenticated`, apaga `auth.users` do próprio `auth.uid()`).
`revoke all` do que não for necessário para `anon`.

### IPC e tela
Canais novos: `gr:auth:signUp`, `gr:auth:signIn`, `gr:auth:signOut`, `gr:auth:recover`, `gr:profile:update`, `gr:account:delete` (exige `{confirm:true}`). Todos devolvem `{ok:true,view}|{ok:false,error}`.
`View` ganha `auth: { status: 'unconfigured'|'signed_out'|'signed_in', email: string|null, displayName: string|null, mmrVisibility: 'friends'|'group'|'nobody'|null }`.
`window.ghostRank` ganha: `signUp({email,password})`, `signIn({email,password})`, `signOut()`, `recover({email})`, `updateProfile({displayName?,mmrVisibility?})`, `deleteAccount()`.
Tela: o rastreador continua funcionando sem conta. Uma área "Conta" no topo leva a: entrar, criar conta (com aviso "confirme seu e-mail"), recuperar senha, perfil (apelido, privacidade do MMR) e apagar conta (diálogo de confirmação).

## Tarefas paralelas

| Tarefa | Arquivos |
| --- | --- |
| A. Banco | supabase/migrations/0001_perfis.sql, supabase/README.md, test/db/*.test.js (análise estática do SQL) |
| B. Main | src/core/credentials.js, src/main/{config,auth,session,profile}.js, config.example.json, .gitignore, ipc.js, preload.js, main.js, test/auth/*, test/shell/* |
| C. Tela | src/renderer/*, preview/mock-bridge.js, preview/index.html (via scripts/build-preview.js) |
