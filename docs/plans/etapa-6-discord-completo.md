# Etapa 6 — Ghost Rank no modelo completo do Discord

Este é o CONTRATO entre os subagentes. Quem muda o contrato avisa no relatório final; ninguém muda arquivo de outra frente.
Identidade visual própria do Ghost Rank (fantasma, cores atuais). Copiamos o MODELO DE USO do Discord, não a marca/trade dress.
Tudo em português do Brasil. Sem frameworks. CSP sem inline (nada de `style=""`, `onclick=""`, `<script>` inline). Sem `innerHTML` com dado externo (use textContent / createElement). Acessibilidade: foco visível, teclado, aria-live onde muda sozinho, prefers-reduced-motion.

Regras de segurança que continuam: nunca pedir/usar service_role nem LiveKit secret no app; chave anon pode; nada de chave no código; `config.local.json` e `.env` no .gitignore.
O projeto Supabase real (ref `jdipignyikikagjvynve`) NÃO está acessível pelas ferramentas: a migração é colada pelo Felipe no SQL Editor; as Edge Functions são publicadas colando `bundle.ts`.

## 0. Escopo desta etapa

1. **Amigos** (pedido direto do Felipe): nome de usuário único pesquisável, enviar/aceitar/recusar/cancelar pedido, remover, bloquear. Tela "Amigos" com abas: Online · Todos · Pendentes · Bloqueados · **Adicionar amigo** (campo de busca com resultados ao vivo + botão adicionar).
2. **Convites ilimitados** (pedido direto): por padrão o convite **nunca expira e não tem limite de usos**; opções Discord: expira em 30 min / 1 h / 6 h / 12 h / 1 dia / 7 dias / nunca; usos: sem limite / 1 / 5 / 10 / 25 / 50 / 100. Prévia do convite antes de entrar (nome, ícone, nº de membros). Se a pessoa já é membro, entrar só abre o servidor (sem erro).
3. **Vários servidores** por pessoa (o "grupo" vira "servidor" na interface; tabelas continuam `groups`/`group_members`). Até 100 membros por servidor, até 50 servidores por pessoa.
4. **Canais**: categorias, canais de texto e de voz; criar/renomear/apagar/reordenar (admin+); tópico do canal.
5. **Cargos simples**: dono, admin, membro. Expulsar, banir/desbanir, transferir posse, apelido no servidor.
6. **Mensagens diretas (DM)** 1:1 com chamada de voz/vídeo na DM.
7. **Chat completo**: tempo real (Supabase Realtime), editar, apagar, responder, reações com seletor de emoji, @menções (autocompletar, destaque, contagem), markdown básico (**negrito**, *itálico*, __sublinhado__, ~~riscado~~, `código`, ```bloco```, ||spoiler||, > citação), links clicáveis (abrem no navegador externo), anexos (imagem com prévia + arquivo até 8 MB, colar/arrastar), "digitando…", marcador "NOVAS" de não lidas, carregar antigas ao rolar, fixar mensagens + painel de fixadas, busca no canal/DM.
8. **Presença**: online / ausente / não perturbe / invisível, status personalizado, avatar (cor ou imagem enviada), "sobre mim". Ausente automático após 10 min parado.
9. **Voz**: vários canais de voz (sala LiveKit por canal), quem está em cada canal visível na barra lateral para todos do servidor, apertar-para-falar, sensibilidade com medidor, escolha de microfone/saída, supressão de ruído/eco, câmera (vídeo), chamada em DM, sons de entrar/sair/mutar (gerados com WebAudio, sem arquivo).
10. **Notificações**: notificação de área de trabalho para menção e DM (janela sem foco), badges de não lidas/menções nos ícones dos servidores e na Home, silenciar canal/servidor/DM.
11. **Configurações estilo Discord** (tela cheia, menu à esquerda, Esc fecha): Minha conta · Perfil · Privacidade · Voz e vídeo · Notificações · Aparência (tema escuro/meia-noite/claro, tamanho da fonte, modo compacto) · Atalhos · Sair. Configurações do servidor: Visão geral · Canais · Membros/Cargos · Convites · Banimentos · Excluir servidor.
12. **Versão web real** (onda 2): o link do Netlify vira o app de verdade no navegador.

Fora desta etapa (listar para o Felipe depois): tópicos/threads, fóruns, palco, bots/webhooks, eventos, soundboard, stickers, descoberta de servidores, permissões granulares por canal.

## 1. Banco (frente DB — `supabase/migrations/0003_discord.sql`)

Migração aditiva, roda de novo sem erro, preserva dados atuais (grupo existente vira servidor com `#geral` e `Geral`; mensagens antigas vão para `#geral`; dono vira `role='owner'`).

### profiles (+ colunas)
`username text unique` (`^[a-z0-9_.]{2,32}$`, minúsculo, preenchido para quem já existe a partir do display_name + sufixo numérico se colidir; `handle_new_user` também gera), `avatar_color smallint 0..7 default`, `avatar_path text null` (bucket `avatars`), `about text ≤190`, `custom_status text ≤128`, `status text in ('online','idle','dnd','invisible') default 'online'`, `display_name` passa a aceitar 1..32.
Leitura do perfil (colunas públicas: id, username, display_name, avatar_color, avatar_path, about, custom_status, status, mmr_visibility): si mesmo, amigos, quem divide servidor, quem tem DM com você, quem te mandou/recebeu pedido. `steam_account_id` só o próprio.

### relationships
`relationships(user_id, other_id, kind in ('friend','pending_out','pending_in','blocked'), created_at, pk(user_id,other_id))` — uma linha por direção, só mexida por RPC. Select: `user_id = auth.uid()`.

### groups (+), group_members (+), group_bans
groups: `icon_color smallint`, `icon_path text null`. group_members: remove `unique(user_id)`; `role text in ('owner','admin','member')`, `nickname text ≤32 null`. `group_bans(group_id, user_id, banned_by, created_at)`.
Função auxiliar `public.is_member(gid uuid) returns boolean`, `public.member_role(gid uuid) returns text` (security definer, search_path '').

### channel_categories, channels
`channel_categories(id uuid pk, group_id, name 1..32, position int)`; `channels(id uuid pk, group_id, category_id null → on delete set null, kind in ('text','voice'), name, topic ≤1024 null, position int, created_at)`. Nome de canal de texto normalizado: minúsculo, espaços→`-`, `^[\p{L}\p{N}_-]{1,32}$`; voz 1..32 livre sem `<>`/controle. `create_group` cria categoria "Canais de texto" com `geral` e "Canais de voz" com `Geral`.

### dm_channels
`dm_channels(id uuid pk, user_a, user_b, created_at, last_message_at)` com `user_a < user_b` e unique(user_a,user_b). Lido pelos 2 participantes.

### messages (+)
`channel_id uuid null`, `dm_id uuid null` (exatamente um preenchido; `group_id` continua preenchido para canal, null para DM), `reply_to bigint null → on delete set null`, `edited_at timestamptz null`, `attachments jsonb not null default '[]'` (≤4 itens `{path,name,size,mime,width?,height?}`), `mentions uuid[] not null default '{}'`, `pinned boolean default false`. Corpo 0..2000 (vazio só com anexo). Update: autor muda só `body`/`mentions` (trigger põe `edited_at`). Delete: autor, ou admin/dono do servidor. Rate limit existente continua.
`message_reactions(message_id, user_id, emoji text 1..32, created_at, pk(message_id,user_id,emoji))`; inserir/apagar a própria se pode ler a mensagem; máx 20 emojis distintos por mensagem.
`read_states(user_id, target text ('c:<uuid>'|'d:<uuid>'), last_read_id bigint, updated_at, pk(user_id,target))` só o próprio.

### group_invites (mudar)
`expires_at` aceita null (= nunca), `max_uses` aceita null (= ilimitado) e até 100. `created_by` qualquer membro.

### RPCs (todas `security definer`, `set search_path = ''`, grant só `authenticated`; erros com `raise exception using errcode='P0001', message='<codigo>'`)
Social:
- `search_users(p_query text) → table(id, username, display_name, avatar_color, avatar_path, relation text)` — prefixo de username ou display_name (ilike, escapar `%_`), mín 2 caracteres, máx 20, exclui você e quem te bloqueou. `relation` ∈ friend|pending_in|pending_out|blocked|none. Rate limit 30/min.
- `send_friend_request(p_username text) → text` ('sent' ou 'accepted' se a outra pessoa já tinha pedido). Erros: user_not_found, cannot_add_self, already_friends, request_exists, blocked, rate_limited (20/h).
- `accept_friend_request(p_user uuid)`, `decline_friend_request(p_user uuid)` (recusa recebido OU cancela enviado), `remove_friend(p_user uuid)`, `block_user(p_user uuid)`, `unblock_user(p_user uuid)`.
- `open_dm(p_user uuid) → uuid` — exige amizade ou servidor em comum e ninguém bloqueado (erro `dm_not_allowed`).
Servidores:
- `create_group(p_name text, p_icon_color int default 0) → uuid` (erros invalid_name, too_many_servers).
- `preview_invite(p_code text) → table(group_id, name, icon_color, icon_path, member_count, already_member boolean)` (erro invalid_invite).
- `join_group(p_code text) → uuid` (já membro: devolve o id sem erro; erros invalid_invite, banned, group_full, too_many_servers).
- `create_invite(p_group uuid, p_max_age_seconds int default null, p_max_uses int default null) → table(code, expires_at, max_uses, uses)` — com os dois null devolve o convite permanente já existente do servidor se houver (código estável), senão cria.
- `list_invites(p_group)` (admin+) → code, created_by, expires_at, max_uses, uses; `revoke_invite(p_code)` (admin+ ou criador).
- `leave_group(p_group)` (dono sozinho → apaga; dono com outros → passa para o admin mais antigo, senão membro mais antigo), `delete_group(p_group)` (dono), `update_group(p_group, p_name, p_icon_color)` (admin+), `set_group_icon(p_group, p_path)` (admin+; null remove).
- `set_member_role(p_group, p_user, p_role)` (dono; role admin|member), `transfer_ownership(p_group, p_user)` (dono), `kick_member(p_group, p_user)` (admin+; admin não expulsa admin/dono), `ban_member(p_group, p_user)` / `unban_member(p_group, p_user)` / `list_bans(p_group)` (admin+), `set_nickname(p_group, p_nickname)` (próprio; null limpa).
- Erros: not_member, not_owner, not_admin, invalid_user, invalid_name, cannot_target.
Canais (admin+): `create_category(p_group, p_name) → uuid`, `update_category(p_id, p_name, p_position)`, `delete_category(p_id)`, `create_channel(p_group, p_kind, p_name, p_category uuid) → uuid`, `update_channel(p_id, p_name, p_topic, p_category, p_position)`, `delete_channel(p_id)` (não apaga o último canal de texto: erro last_text_channel).
Mensagens: `pin_message(p_id bigint, p_pinned boolean)` (admin+ no servidor; qualquer participante na DM; máx 50 fixadas por canal), `unread_summary() → table(target text, last_message_id bigint, unread int, mentions int)` (canais dos seus servidores e suas DMs; unread limitado a 99), `mark_read(p_target text, p_last_id bigint)`, `search_messages(p_target text, p_query text) → setof messages` (máx 25, ilike escapado, mais novas primeiro).
Rate limit genérico: tabela `rate_events` + função interna `public.rate_check(p_kind text, p_max int, p_seconds int)`.

### Realtime
Publicação `supabase_realtime` inclui: messages, message_reactions, relationships, group_members, channels, channel_categories, dm_channels, groups (postgres_changes respeita RLS). `replica identity full` em messages e message_reactions (para DELETE trazer as colunas).
Canais privados de broadcast/presence com política em `realtime.messages` (`realtime.topic()`):
- `server:<group_id>` — membros. Presence (payload `{voice: channelId|null, muted, deafened, streaming, video, status}`) e broadcast `typing` `{target, userId}`.
- `user:<user_id>` — o próprio, amigos e quem divide servidor (presence de status `{status}` do dono do tópico; só o dono do tópico pode `track`).
- `dm:<dm_id>` — os 2 participantes. Presence de chamada `{voice: true, muted, deafened, streaming, video}` e broadcast `typing`.

### Storage
Bucket `avatars` (público para leitura, 2 MB, image/png|jpeg|webp|gif). Caminho `<user_id>/<uuid>.<ext>` (só o dono grava/apaga) e `g_<group_id>/<uuid>.<ext>` para ícone do servidor (admin+ grava).
Bucket `attachments` (privado, 8 MB). Caminho `g_<group_id>/<channel_id>/<uuid>/<nome>` ou `d_<dm_id>/<uuid>/<nome>`; ler: membro/participante; gravar: membro/participante e pasta `<uuid>` livre; apagar: quem enviou (owner).

### Edge Functions (frente DB também)
`livekit-token`: corpo `{channelId}` (canal de voz → confere com service role que é membro do servidor; sala `vc_<channelId>`) ou `{dmId}` (participante; sala `dm_<dmId>`). Corpo vazio `{}` continua funcionando (primeiro canal de voz do primeiro servidor — compatibilidade). Concede `canPublishData: true`. **CORS** em todas as funções (OPTIONS + `Access-Control-Allow-Origin: *`, headers `authorization, apikey, content-type, x-client-info`) para a versão web. Regenerar `bundle.ts` com `build-bundles.js`. Erros: not_member (403), voice_unconfigured (503).
Atualizar `supabase/README.md` com o passo a passo de colar 0003 e republicar as funções.

## 2. Ponte `window.ghostRank` (frente MAIN implementa; frente R1 simula em `preview/mock-bridge.js`)

Resultados como hoje: ações de estado devolvem `{ok:true, view}`; consultas devolvem `{ok:true, ...dados}`; erro `{ok:false, error:'mensagem pt-BR'}`. Mensagens de erro amigáveis para cada código do banco.
Todos os métodos antigos continuam existindo (aliases): `createGroup(name)`→createServer, `joinGroup(code)`→joinServer, `leaveGroup()`→sai do servidor selecionado, `createInvite()`→convite permanente do servidor selecionado, `removeMember(id)`→kick no selecionado, `refreshGroup()`, `sendMessage(body:string)`, `voiceToken()`.

Navegação: `select({mode:'home', tab?:'friends'|'mmr'})` · `select({mode:'server', serverId, channelId?})` · `select({mode:'dm', dmId})` → view.
Social: `searchUsers(query)` → `{ok, users:[UserLite & {relation}]}` · `sendFriendRequest(username)` → view (+`result:'sent'|'accepted'`) · `acceptFriend(userId)` · `declineFriend(userId)` · `removeFriend(userId)` · `blockUser(userId)` · `unblockUser(userId)` · `openDm(userId)` → view já com a DM selecionada · `setStatus('online'|'idle'|'dnd'|'invisible')` · `setCustomStatus(text|null)` · `updateProfile({displayName?, username?, about?, avatarColor?, mmrVisibility?})` · `uploadAvatar({name, mime, data:ArrayBuffer})` · `removeAvatar()`.
Servidores: `createServer({name, iconColor?})` (seleciona o novo) · `previewInvite(code)` → `{ok, invite:{serverId,name,iconColor,iconUrl,memberCount,alreadyMember}}` · `joinServer(code)` (seleciona) · `leaveServer(serverId)` · `deleteServer(serverId)` · `updateServer({serverId, name?, iconColor?})` · `uploadServerIcon({serverId, name, mime, data})` · `createInvite({serverId, maxAgeSeconds:null|1800|3600|21600|43200|86400|604800, maxUses:null|1|5|10|25|50|100})` → `{ok, invite:{code, expiresAt|null, maxUses|null, uses}}` · `listInvites(serverId)` → `{ok, invites:[...]}` · `revokeInvite(code)` · `setMemberRole({serverId,userId,role})` · `transferOwnership({serverId,userId})` · `kickMember({serverId,userId})` · `banMember({serverId,userId})` · `unbanMember({serverId,userId})` · `listBans(serverId)` → `{ok, bans:[UserLite & {bannedAt}]}` · `setNickname({serverId, nickname|null})`.
Canais: `createCategory({serverId,name})` · `updateCategory({categoryId,name?,position?})` · `deleteCategory(categoryId)` · `createChannel({serverId, kind:'text'|'voice', name, categoryId|null})` · `updateChannel({channelId, name?, topic?, categoryId?, position?})` · `deleteChannel(channelId)`.
Mensagens (no alvo selecionado): `sendMessage({body, replyTo?:id, attachments?:[{name,mime,data:ArrayBuffer}]})` (string ainda aceita) · `editMessage({id, body})` · `deleteMessage(id)` · `toggleReaction({id, emoji})` · `pinMessage({id, pinned})` · `listPinned()` → `{ok, items}` · `loadOlder()` → view · `markRead()` · `searchMessages(query)` → `{ok, items}` · `setTyping()` (main limita a 1 envio a cada 3 s) · `openExternal(url)` (só http/https; abre no navegador).
Preferências locais: `updatePrefs(partial)` → view (merge profundo, validado) · `muteTarget({target:'c:<id>'|'d:<id>'|'s:<id>', muted})`.
Voz: `voiceToken({channelId}|{dmId}|undefined)` → `{ok,url,token}` · `setVoiceState({channelId?:id|null, dmId?:id|null, muted, deafened, streaming, video})` (main publica na presence) · `listScreenSources()` / `pickScreenSource(id)` (como hoje).
Eventos: `onUpdate(cb)` (como hoje) e `onNotificationClick(cb)` (recebe `{mode, serverId?, channelId?, dmId?}`; o main já seleciona antes).

### Formato da view (acréscimos; campos antigos continuam: configured, profile, summary, heroes, auth, group, chat, voice, sync)
```
UserLite = { id, username, displayName, avatarColor (0..7), avatarUrl|null }
view.me = UserLite & { about, customStatus, status }            // null deslogado
view.prefs = {
  notifications: { desktop: true, sounds: true, mentionsOnly: false },
  muted: ['c:..','d:..','s:..'],
  voice: { inputDeviceId: 'default', outputDeviceId: 'default', mode: 'vad'|'ptt', pttKey: 'KeyV',
           sensitivity: -50 (dB -100..0), autoSensitivity: true, noiseSuppression: true, echoCancellation: true,
           inputVolume: 100, outputVolume: 100, cameraDeviceId: 'default' },
  appearance: { theme: 'dark'|'midnight'|'light', fontScale: 100 (80..130), compact: false },
}
view.presence = { [userId]: 'online'|'idle'|'dnd'|'offline' }   // invisível aparece como offline para os outros
view.friends = [ UserLite & { relation:'friend'|'pending_in'|'pending_out'|'blocked', customStatus, since } ]
view.dms = [ { id, user: UserLite, lastMessageAt, unread, mentions, muted } ]   // mais recente primeiro
view.servers = [ { id, name, iconColor, iconUrl|null, role, unread: bool, mentions: int, muted: bool } ]
view.selection = { mode:'home'|'server'|'dm', tab?, serverId?, channelId?, dmId? }
view.server = null | {   // servidor selecionado
  id, name, iconColor, iconUrl, role, ownerId,
  categories: [ { id, name, position } ],
  channels: [ { id, kind:'text'|'voice', name, topic, categoryId|null, position, unread: bool, mentions: int, muted } ],
  members: [ UserLite & { role, nickname|null, mmr|null (mesmo formato de hoje), customStatus } ],
}
view.voiceStates = { [channelId or 'dm:'+dmId]: [ { userId, muted, deafened, streaming, video } ] }
view.messages = null | {
  target: 'c:<id>'|'d:<id>', status: 'loading'|'ready'|'error', error|null, hasMore: bool,
  firstUnreadId: id|null,                     // para o divisor "NOVAS"
  typing: [userId],                           // sem você, some após 6 s
  items: [ { id, authorId, body, createdAt, editedAt|null, pending?: true, failed?: true,
             replyTo: null | { id, authorId, body (≤120 chars), missing?: true },
             attachments: [ { url, name, size, mime, width?, height?, isImage } ],
             reactions: [ { emoji, count, me } ], pinned, mentionsMe, mentions: [userId] } ],   // antiga → nova, máx 200
}
view.users = { [userId]: UserLite & { customStatus } }   // cache de todos os usuários citados na view (autores, amigos, membros)
```
`view.group`/`view.chat` antigos: o main continua preenchendo a partir do servidor/canal selecionado (para os testes antigos).

## 3. Interface (frentes R1, R2, R3, V)

Estrutura (Discord): trilho de servidores (Home com o fantasma + badge de pendências/DMs não lidas, lista de servidores com pílula de não lido/selecionado e badge vermelho de menções, "+" criar/entrar com prévia do convite) → barra lateral (Home: busca rápida "Encontrar ou começar uma conversa", Amigos, Meu MMR, lista de DMs; Servidor: cabeçalho com menu do servidor [Convidar pessoas, Configurações do servidor, Criar canal, Criar categoria, Editar perfil no servidor (apelido), Silenciar, Sair], item "🏆 Ranking", categorias recolhíveis com canais, membros da voz embaixo de cada canal de voz com ícones mutado/ensurdecido/AO VIVO/câmera) → painel de voz conectada + painel do usuário (avatar com bolinha de status → menu de status; mic, fone, engrenagem) → área principal (cabeçalho com nome/tópico, botões fixadas, membros, busca; ou página Amigos; ou chamada) → lista de membros agrupada por cargo + "Online"/"Offline".
Cartão de perfil (popout) ao clicar em nome/avatar: banner na cor, avatar, status, nome, @username, apelido, sobre mim, MMR, cargos, botões Mensagem / Adicionar amigo / pendente.
Menus de contexto (clique direito e Shift+F10/tecla menu): mensagem (Responder, Reagir, Editar, Fixar, Copiar texto, Copiar link?, Apagar), usuário (Perfil, Mensagem, Chamar, Apelido, Adicionar/Remover amigo, Bloquear, Expulsar, Banir, Cargo), canal (Marcar como lido, Silenciar, Editar, Apagar, Copiar ID), servidor (Marcar como lido, Silenciar, Convidar, Configurações, Sair).
Atalhos: Ctrl+K busca rápida (servidores, canais, DMs, amigos), Alt+↑/↓ canal anterior/próximo, Alt+Shift+↑/↓ não lido, Esc marca como lido / fecha, Ctrl+Shift+M mutar, Ctrl+Shift+D ensurdecer, Ctrl+/ lista de atalhos, ↑ no campo vazio edita a última mensagem.
Temas via `data-theme` no `<html>` + `--font-scale` e `data-compact` (R1 aplica a partir de `view.prefs.appearance`; todos usam as variáveis CSS de `styles.css`).

### Dono de cada arquivo (ninguém mexe no arquivo de outro)
- **R1 (casca + navegação + amigos + simulação)**: `src/renderer/index.html`, `src/renderer/app.js` (pode dividir em `src/renderer/home.js`, `src/renderer/ui.js` etc.), `src/renderer/styles.css`, `preview/index.html`, `preview/mock-bridge.js`, `scripts/build-preview.js`, `scripts/build-netlify.js`, `test/shell/preview.test.js`. R1 carrega os scripts/CSS das outras frentes e cria os pontos de montagem.
- **R2 (chat)**: `src/renderer/chat.js`, `src/renderer/chat.css`, `src/renderer/emoji-data.js`.
- **R3 (configurações)**: `src/renderer/settings.js`, `src/renderer/settings.css`.
- **V (voz)**: `src/renderer/voice.js`, `src/renderer/voice.css`, `preview/fake-livekit.js`.
- **MAIN**: `src/main/**`, `src/preload/**`, `src/core/**`, `package.json`/`package-lock.json`, `test/**` exceto `test/db`, `test/functions`, `test/shell/preview.test.js`.
- **DB**: `supabase/**`, `test/db/**`, `test/functions/**`.

### APIs entre módulos do renderer (todos globais em `window`, carregados antes de `app.js`)
```
GhostChat.init({ bridge, root /* <section> vazio */, getView, openProfile(userId, anchorEl), openContextMenu(items, x, y) })
GhostChat.update(view)          // renderiza view.messages para o alvo atual (+ cabeçalho NÃO: o cabeçalho é do R1)
GhostChat.focusComposer(); GhostChat.togglePinned(anchorEl); GhostChat.openSearch(query?)

GhostSettings.init({ bridge, getView, onClose() })
GhostSettings.openUser(tab?: 'account'|'profile'|'privacy'|'voice'|'notifications'|'appearance'|'keybinds')
GhostSettings.openServer(serverId, tab?: 'overview'|'channels'|'members'|'invites'|'bans'|'delete')
GhostSettings.update(view); GhostSettings.isOpen()
  // aba "Voz e vídeo" chama GhostVoice.renderSettings(containerEl) e GhostVoice.destroySettings()

GhostVoice.init({ bridge, els:{ stage, connection, userControls }, getView, onState(state), onOpenSettings() })
GhostVoice.update(view)
GhostVoice.join({ channelId } | { dmId }); GhostVoice.leave(); GhostVoice.toggleMute(); GhostVoice.toggleDeafen()
GhostVoice.toggleVideo(); GhostVoice.getState()   // { status:'idle'|'connecting'|'connected', channelId, dmId, muted, deafened, streaming, video, speaking:[userId] }
GhostVoice.renderSettings(containerEl); GhostVoice.destroySettings()
GhostVoice.playSound('join'|'leave'|'mute'|'unmute'|'message')   // R1 usa 'message' para notificação com som

GhostUI (R1, em app.js ou ui.js): openContextMenu(items:[{label, danger?, disabled?, action(), separator?}], x, y, returnFocusEl),
  openProfile(userId, anchorEl), confirm({title, body, confirmLabel, danger}) → Promise<boolean>, toast(text), avatarEl(user, size), statusDot(status)
```
O renderer sempre mostra os dados de `view`; nunca guarda estado de servidor por conta própria (só UI efêmera: rascunhos, rolagem, painéis abertos).
Imagens remotas (avatar/anexo) são `https://<projeto>.supabase.co/storage/...`: o main já entrega URL assinada/pública; a CSP do app libera só essa origem em `img-src` (frente MAIN mexe em `protocol.js`).

## 4. Testes e verificação
`node --test "test/**/*.test.js"` precisa passar (hoje 323). Cada frente adiciona testes do que fez. Prévia: `preview/index.html?s=<cenário>` com cenários novos (R1): `home` (amigos com pedidos pendentes, DMs), `server` (servidor com várias categorias/canais, menções não lidas, pessoas na voz), `dm` (DM aberta), `settings` (abre configurações), `server_settings`, `invite` (diálogo de entrar com prévia), além dos antigos. Cada frente confere o próprio trabalho com capturas (Chromium headless/playwright se disponível) e relata.
Não fazer `git commit` — quem integra é o coordenador.
