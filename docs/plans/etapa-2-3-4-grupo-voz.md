# Etapas 1B, 2, 3 e 4 — Steam, grupo, MMR do grupo, chat e voz

Ramo: `etapa-2-grupo-voz` (a partir de `etapa-1-contas`).
Decisões do Felipe: Etapa 4 em versão simples (um grupo por pessoa, uma sala de voz fixa, chat de texto, sem cargos além de dono); LiveKit Cloud com chaves passadas depois.
Limites deste ambiente: sem rede no shell (sem `npm install`). Código que depende do LiveKit é escrito com injeção e testado com dublês; o Felipe roda `npm install` no Windows.

## Regras de sempre
- Nenhuma dependência nova de produção, exceto `livekit-client` (só no renderer, servido localmente; nunca CDN).
- Nunca registrar e-mail, senha, token, código de convite ou texto de chat em log.
- Toda entrada da tela é validada no `ipc.js` (remetente `app://ghost-rank/`, objeto simples, chaves permitidas, tipos e tamanhos).
- Identidade do usuário sempre vem do token (Supabase `auth.uid()` / `sub`), nunca da tela.
- Renderer: sem inline, sem innerHTML, só `textContent`/`createElement`.
- Mensagens ao usuário em português do Brasil.

## Banco (migração `0002_grupo.sql`)
Tabelas (todas com RLS ligada, `revoke all` de anon/public, grants mínimos a authenticated):
- `groups(id uuid pk default gen_random_uuid(), name text check 2..32 sem controle/<>, owner_id uuid not null references auth.users on delete cascade, created_at)`.
- `group_members(group_id uuid references groups on delete cascade, user_id uuid references auth.users on delete cascade, joined_at, primary key(group_id,user_id), unique(user_id))` → uma pessoa só pode estar em um grupo. Máximo 10 membros (verificado na função de entrada).
- `group_invites(code text pk, group_id uuid references groups on delete cascade, created_by uuid, expires_at timestamptz, uses int default 0, max_uses int default 5)`. Código: 10 caracteres de alfabeto sem ambíguos (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`), gerado com `gen_random_bytes`. Validade 7 dias. Nenhum select direto (só via função).
- `mmr_snapshots(user_id uuid pk references auth.users on delete cascade, current_mmr int check 0..20000, goal_mmr int check 0..20000, start_mmr int check 0..20000, wins int >=0, losses int >=0, status text check in ('goal_reached','on_track','unreachable','insufficient_data'), updated_at timestamptz default now())`.
- `messages(id bigint generated always as identity pk, group_id uuid references groups on delete cascade, user_id uuid references auth.users on delete cascade, body text check char_length 1..1000, created_at timestamptz default now())`, índice `(group_id, id)`.
- `steam_link_states(state text pk, user_id uuid references auth.users on delete cascade, expires_at timestamptz)` — só a Edge Function (service role) usa; sem grants a authenticated/anon.

Função auxiliar `public.my_group_id()` (security definer, stable, search_path '') → group_id do `auth.uid()` ou null.

Políticas:
- `groups`: select se `id = my_group_id()`.
- `group_members`: select se `group_id = my_group_id()`. Sem insert/update/delete direto.
- `profiles`: nova política select para colegas de grupo: `id in (select user_id from group_members where group_id = my_group_id())` (só colunas já concedidas). Mantém a política do dono.
- `mmr_snapshots`: dono faz select/insert/update da própria linha (`user_id = auth.uid()`); colegas fazem select se estão no mesmo grupo E o perfil do dono do snapshot tem `mmr_visibility in ('group','friends')`. Delete só o dono.
- `messages`: select se `group_id = my_group_id()`; insert se `user_id = auth.uid()` e `group_id = my_group_id()`; delete se `user_id = auth.uid()`. Sem update. Gatilho `before insert` que recusa mais de 10 mensagens em 10 s do mesmo usuário (erro `rate_limited`).

Funções RPC (security definer, `set search_path = ''`, EXECUTE só authenticated, revoke public/anon):
- `create_group(p_name text) returns uuid` — erro se já está em grupo; cria grupo e membro dono.
- `create_invite() returns table(code text, expires_at timestamptz)` — só o dono.
- `join_group(p_code text) returns uuid` — valida código (existe, não expirou, `uses < max_uses`), erro se já está em grupo ou grupo cheio (10); incrementa uses. Mensagem de erro igual para código inexistente/expirado/esgotado (`invalid_invite`).
- `leave_group() returns void` — se o dono sai: passa a posse ao membro mais antigo; se ninguém sobrar, apaga o grupo.
- `remove_member(p_user_id uuid) returns void` — só o dono, não pode remover a si mesmo.

`delete_my_account` continua valendo (cascatas limpam tudo). Erros das funções usam `raise exception using errcode = 'P0001', message = '<codigo>'` com códigos: `already_in_group`, `not_in_group`, `not_owner`, `invalid_invite`, `group_full`, `invalid_name`, `rate_limited`.

## Edge Functions (Deno, `supabase/functions/`)
Lógica pura em `supabase/functions/_shared/*.js` (ES modules sem dependência, WebCrypto; roda em Deno e em Node 22 para testes via `import()`).

### `livekit-token`
- `POST` com `Authorization: Bearer <access_token do usuário>`. Valida o usuário chamando `GET {SUPABASE_URL}/auth/v1/user` com o token (não decodifica sem verificar).
- Consulta com service role o `group_id` do usuário e o `display_name`. Sem grupo → 403 `{error:'not_in_group'}`.
- Emite JWT LiveKit (HS256, `_shared/livekit_token.js`: `createLiveKitToken({apiKey, apiSecret, identity, name, room, ttlSeconds=3600, now})`) com `video: {room: 'grupo-'+group_id, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false}`, `sub=identity=user id`, `iss=apiKey`, `nbf`, `exp`.
- Responde `{url: LIVEKIT_URL, token}`. Segredos: `LIVEKIT_URL` (deve começar com `wss://`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Faltando → 503 `{error:'voice_unconfigured'}`.
- CORS não é necessário (chamada vem do processo principal), mas responder só `POST`/`OPTIONS`.

### `steam-link` (vincular conta Steam — Etapa 1B)
- `POST /steam-link/start` com Bearer do usuário → cria `state` aleatório (32 bytes base64url, validade 10 min) em `steam_link_states` e devolve `{url}` para `https://steamcommunity.com/openid/login` com `openid.mode=checkid_setup`, `openid.ns=http://specs.openid.net/auth/2.0`, `openid.identity`/`claimed_id = http://specs.openid.net/auth/2.0/identifier_select`, `openid.return_to = {FUNCTION_URL}/callback?state=...`, `openid.realm = {FUNCTION_URL}`.
- `GET /steam-link/callback` → valida com `_shared/steam_openid.js`: `openid.mode=id_res`, `op_endpoint` exato, `return_to` igual ao esperado (mesmo state), `claimed_id` casando `^https://steamcommunity\.com/openid/id/(7656119\d{10})$`, e confirma com `check_authentication` (POST para o Steam com os mesmos campos e `openid.mode=check_authentication`, resposta contém `is_valid:true`). Consome o state (uso único, não expirado), grava `profiles.steam_account_id` = SteamID64 − 76561197960265728 para o usuário do state. Conflito (Steam já vinculada a outra conta) → página de erro. Responde HTML mínimo em português ("Steam vinculada. Pode voltar ao Ghost Rank.") com CSP `default-src 'none'`.
- Funções puras testáveis: `buildSteamLoginUrl`, `verifyAssertionParams`, `steamId64ToAccountId`, `parseCheckAuthResponse`.

`supabase/README.md` ganha: como aplicar 0002, como publicar as funções (pelo painel "Edge Functions → Deploy new function" colando o código, ou pela CLI `supabase functions deploy livekit-token --no-verify-jwt` — a função valida o token ela mesma; `steam-link` precisa de `--no-verify-jwt` porque o callback vem do navegador) e como cadastrar segredos (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`).

## Processo principal
Novos módulos (fetch injetável, timeout, mesmas regras do `profile.js`; usam `getAccessToken` do session manager; erros viram `UserInputError` com texto em português):
- `src/main/group.js` `createGroupClient({fetchImpl, supabaseUrl, anonKey, getAccessToken, getUserId})`:
  `load() -> Group|null` (lê grupo, membros com `profiles(display_name)` e `mmr_snapshots` visíveis), `create(name)`, `invite() -> {code, expiresAt}`, `join(code)`, `leave()`, `remove(userId)`, `publishSnapshot(summary)` (upsert em `mmr_snapshots` via `Prefer: resolution=merge-duplicates`).
- `src/main/chat.js` `createChatClient({...})`: `fetchSince(groupId, afterId, limit=50)`, `send(groupId, body)`. Sondagem a cada 4 s só com sessão, grupo e janela focada (main controla com `setInterval` + eventos `focus`/`blur`); mantém no máximo 200 mensagens em memória.
- `src/main/voice.js` `createVoiceClient({fetchImpl, supabaseUrl, anonKey, getAccessToken})`: `getToken() -> {url, token}` chamando `{supabaseUrl}/functions/v1/livekit-token`; valida `url` começa com `wss://` e host termina em `.livekit.cloud` (ou lista em config `livekitHosts`), token é JWT de 3 partes.
- `src/main/steam.js`: `startLink() -> url` (valida que começa com `https://steamcommunity.com/openid/login?`) e abre com `shell.openExternal`; `steamcommunity.com` entra na allowlist.
- `controller.js`: View ganha `group`, `chat`, `voice` (abaixo); após `sync`/`setup`/`correctMmr` com sessão e grupo, chama `group.publishSnapshot(summary)` sem bloquear a tela (falha só registra código de erro genérico).
- `security.js`: permissões liberadas só para frames com origem `app://ghost-rank`: `media` (somente áudio: microfone) e `display-capture`; o resto continua negado. `session.setDisplayMediaRequestHandler` usa `desktopCapturer.getSources({types:['screen','window']})`; no Windows `audio: 'loopback'` (áudio do jogo/sistema), nos outros sistemas sem áudio. Primeira versão: entrega a fonte escolhida pela tela (o renderer manda o `sourceId` via IPC `gr:voice:pickSource` antes de chamar `getDisplayMedia`; o handler usa a última escolha válida, expirando em 10 s) e `gr:voice:listSources` devolve `[{id, name, kind, thumbnail(dataURL jpeg pequeno)}]`.
- `protocol.js`: CSP `connect-src` passa a `wss://*.livekit.cloud https://*.livekit.cloud`; `media-src 'self' blob: mediastream:`; nova rota `app://ghost-rank/vendor/livekit-client.umd.js` servindo `node_modules/livekit-client/dist/livekit-client.umd.js` se existir (404 se não), sem outras rotas para `node_modules`.
- `package.json`: `dependencies: { "livekit-client": "^2" }` (o Felipe roda `npm install`).

IPC novos (todos com validação):
| canal | payload | resposta |
|---|---|---|
| `gr:group:create` | `{name}` (2–32) | View |
| `gr:group:join` | `{code}` (10 chars do alfabeto, maiúsculas após trim) | View |
| `gr:group:leave` | `{confirm:true}` | View |
| `gr:group:invite` | `{}` | `{ok, code, expiresAt}` |
| `gr:group:remove` | `{userId}` (uuid) | View |
| `gr:group:refresh` | `{}` | View |
| `gr:chat:send` | `{body}` (1–1000 após trim) | View |
| `gr:voice:token` | `{}` | `{ok, url, token}` |
| `gr:voice:listSources` | `{}` | `{ok, sources}` |
| `gr:voice:pickSource` | `{sourceId}` (string ≤ 200, deve estar na última lista) | `{ok}` |
| `gr:steam:link` | `{}` | `{ok}` |

`preload.js` expõe: `createGroup(name)`, `joinGroup(code)`, `leaveGroup()`, `createInvite()`, `removeMember(userId)`, `refreshGroup()`, `sendMessage(body)`, `voiceToken()`, `listScreenSources()`, `pickScreenSource(sourceId)`, `linkSteam()`.

View:
```
group: null | { id, name, isOwner,
  members: [{ userId, displayName, isMe, isOwner,
    mmr: null | { current, goal, start, wins, losses, status, progress (0..1, (current-start)/(goal-start) limitado), updatedAt } }] }
chat: { messages: [{ id, userId, displayName, body, createdAt (ms), mine }], status: 'idle'|'error' }
voice: { available: boolean }   // false sem conta, sem grupo ou sem livekit vendor
auth: (+ steamLinked: boolean)
```
Ranking dos fantasmas = membros com `mmr` ordenados por `progress` desc (calculado na tela).

## Tela
- Abas no topo do conteúdo: "Meu MMR" (atual) e "Grupo" (desabilitada com dica quando sem conta).
- Grupo sem grupo: criar grupo (nome) ou entrar com código.
- Grupo com grupo: cabeçalho (nome, botão convidar → mostra código com copiar e validade, sair do grupo com confirmação); coluna 1 "Ranking dos fantasmas" (posição, apelido, MMR atual → meta, barra de progresso honesta, estado com ícone+texto; "MMR escondido" quando null); coluna 2 "Sala de voz" (entrar/sair, mutar microfone, compartilhar tela com áudio, lista de quem está na sala com indicador de fala por ícone+texto, área do vídeo da tela compartilhada) e "Chat" (lista com rolagem, campo + Enviar, aria-live polite só para novas mensagens alheias).
- Voz em `src/renderer/voice.js` (script clássico IIFE, carregado depois de `vendor/livekit-client.umd.js`; se `window.LivekitClient` não existir, mostra "Voz indisponível: rode npm install"). Usa `Room`, `RoomEvent`, `room.localParticipant.setMicrophoneEnabled`, e para tela: `listScreenSources` → diálogo de escolha com miniaturas → `pickScreenSource(id)` → `setScreenShareEnabled(true, {audio: true})`. Anexa faixas remotas com `track.attach()` em elementos criados por JS. Sai da sala ao fechar/aba trocar não (continua), ao sair da conta sim.
- Steam: em "Minha conta", botão "Vincular Steam" (ou "Steam vinculada").
- Prévia: `mock-bridge.js` simula grupo/chat; `preview/fake-livekit.js` simula `LivekitClient` mínimo para ver a sala; cenários `?s=group`, `?s=no_group`, `?s=voice`.

## Tarefas paralelas (donos de arquivos, sem sobreposição)
- **A. Banco + Edge Functions:** `supabase/migrations/0002_grupo.sql`, `supabase/functions/**`, `supabase/README.md`, `test/db/grupo*.test.js`, `test/functions/*.test.js`.
- **B. Main:** `src/main/{group,chat,voice,steam}.js`, `src/main/{ipc,controller,main,security,protocol,account}.js`, `src/preload/preload.js`, `package.json`, `test/main/**`, `test/auth/**`, `test/group/**`, `test/shell/preload.test.js`.
- **C. Tela:** `src/renderer/**`, `preview/**`, `scripts/build-preview.js`, `test/shell/preview.test.js`.
