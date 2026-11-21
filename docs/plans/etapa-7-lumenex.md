# Etapa 7 — LUMENEX (contrato entre os subagentes)

Pedido do Felipe (21/11): marca LUMENEX, fotos e banners de até 40 MB, avatar/banner animados com recorte, 8 molduras, 8 efeitos de perfil, central "Personalização do Perfil", arrastar e soltar salas e participantes de voz só para ADM, tema Meia-Noite (AMOLED). Tudo gratuito: sem loja, moeda, assinatura. Personalização só no perfil/cartão — nada de tema automático do app por avatar/personagem.
Regras que continuam: as do contrato da Etapa 6 (docs/plans/etapa-6-discord-completo.md): CSP sem inline, sem innerHTML com dado externo, sem frameworks, acessibilidade, prefers-reduced-motion, segredos nunca no código, pt-BR.

Estado real verificado: o banco de produção JÁ tem a 0006 aplicada (channels, relationships existem). Login com Google NÃO está configurado (só e-mail) — não implementar Google. Netlify: site `ghosttouch` publica a branch `etapa-2-grupo-voz` (https://ghosttouch.netlify.app). Não há arte oficial LUMENEX no repositório.

## 1. Marca
- Tudo que a pessoa vê: "LUMENEX" (título da janela/aba, login, carregamento, menus, notificações, mensagens, erros, manifest PWA, metadados og:). Buscar Ghost/GhostRank/Ghost Rank/GostRank/GOSTHRANK/"fantasma" de marca (o mascote fantasma vira o símbolo L).
- NÃO mudar: nome do repositório, domínio Netlify, `package.json` `name`, `appId`, tabelas/colunas/RPCs, URLs públicas — inclusive o nome do arquivo do .exe no Release (`artifactName` continua `GhostRank-${version}.exe`, porque o link de download já foi compartilhado). Usernames gerados `fantasmaNNNNNN` ficam (são dados).
- `productName` vira "LUMENEX", mas a pasta de dados do Electron NÃO pode mudar (sessão e preferências salvas): `app.setPath('userData', <appData>/Ghost Rank)` antes do ready (frente MAIN).
- Paleta: preto, dourado, vermelho. Acento principal dourado (`--accent` ~ #D4A72C com texto escuro por cima para contraste AA), perigo/alerta vermelho (#E5383B), base escura. Cores de avatar e estados de presença continuam distinguíveis.
- Arte oficial ausente → símbolo PROVISÓRIO: um "L" geométrico dourado simples em SVG (`src/renderer/brand/lumenex-mark.svg`) + wordmark em texto. Marcar como provisório no relatório e em `src/renderer/brand/README.md`. Ícones: favicon.svg, PNG 192/512 para o manifest, `build/icon.png` 512 para o .exe (frente MAIN gera a partir do SVG da frente SHELL — se o SVG ainda não existir quando precisar, crie em `build/` o seu próprio a partir da mesma descrição e avise).

## 2. Banco (frente DB — `supabase/migrations/0007_lumenex.sql`, idempotente, sem apagar nada)
profiles (+): `banner_path text`, `avatar_thumb_path text`, `avatar_animated boolean default false`, `banner_animated boolean default false`, `avatar_crop jsonb` (`{x:0..100, y:0..100, zoom:1..3}` — ponto focal em % e zoom), `banner_pos smallint 0..100 default 50` (posição vertical %), `avatar_frame text null` ∈ gold|fire|lightning|arcane|shadow|ice|red|particles, `profile_effect text null` ∈ burst|flames|sparks|magic|mist|crystal|waves|pulse, `appearance_theme text null` ∈ light|dark|midnight. Checks em todas. Leitura segue a política atual de profiles.
Storage `avatars`: `file_size_limit = 41943040` (40 MB exatos aceitos), mime image/png, image/jpeg, image/gif, image/webp. Caminhos do usuário: `<uid>/avatar/<uuid>.<ext>`, `<uid>/avatar/<uuid>.thumb.webp`, `<uid>/banner/<uuid>.<ext>`, `<uid>/banner/<uuid>.thumb.webp`; só o dono grava/apaga em `<uid>/`. Ícone de servidor continua `g_<gid>/` (limite do ícone pode seguir 2 MB no app).
RPCs (security definer, search_path '', só authenticated, rate limit onde fizer sentido):
- `set_profile_media(p_kind text /*avatar|banner*/, p_path text, p_thumb_path text, p_animated boolean)` — caminhos têm que começar com `<auth.uid()>/<kind>/`; null em p_path remove (e limpa thumb/animated). Devolve nada.
- `update_profile_look(p_frame text, p_effect text, p_avatar_crop jsonb, p_banner_pos int)` — null limpa frame/effect; valida tudo.
- `reset_profile_look()` — frame/effect null, crop null, banner_pos 50 (não apaga imagens).
- `set_appearance_theme(p_theme text)`.
- `reorder_channels(p_group uuid, p_channels jsonb /*[{id, categoryId|null, position}]*/, p_categories jsonb default null /*[{id, position}]*/)` — admin+ (dono ou admin), todos os ids do mesmo servidor, posições inteiras ≥0, atômico. Erros not_admin, invalid_layout.
- `move_voice_member(p_group uuid, p_user uuid, p_channel uuid)` — admin+; alvo é membro; canal é de voz do mesmo servidor; admin não move o dono (dono move qualquer um). Avisa o alvo por `realtime.send` no tópico privado `me:<p_user>` (evento `voice_move`, payload `{serverId, channelId, by}`) — mesmo mecanismo dos avisos da 0006. Erros not_admin, not_member, invalid_channel, cannot_target.
Testes Postgres reais (padrão do discord.postgres.test.js): 0001→…→0006→0007 duas vezes; RLS: ninguém grava perfil/caminho alheio; membro comum recebe not_admin em reorder/move; 40 MB aceito e 40 MB+1 recusado pelo limite do bucket (checar a configuração do bucket); mime fora da lista recusado.
README do supabase: passo único "rode 0007_lumenex.sql".

## 3. Ponte (frente MAIN implementa em services/ipc/preload; a web herda; frente SHELL simula no mock)
- `uploadAvatar({name, mime, data:ArrayBuffer, thumb:{mime:'image/webp', data:ArrayBuffer}, animated:boolean})` → view. Limite 40 MB (≤ 41943040 bytes; um byte a mais = erro "A imagem passa de 40 MB."), thumb ≤ 512 KB. Valida bytes reais (assinatura PNG/JPEG/GIF/WebP; GIF/WebP animado detectado pelos bytes — o campo `animated` do renderer é conferido). Envio com **upload resumível TUS** do Supabase (`/storage/v1/upload/resumable`, blocos de 6 MB) para ter progresso e retomar após queda (3 tentativas por bloco); arquivos ≤ 6 MB podem ir em uma requisição. Depois chama `set_profile_media` e apaga o arquivo antigo.
- `uploadBanner({...mesmo formato})`, `removeAvatar()`, `removeBanner()`.
- `updateProfileLook({frame?, effect?, avatarCrop?, bannerPos?})`, `resetProfileLook()`.
- `reorderChannels({serverId, channels:[{id, categoryId, position}], categories?:[{id, position}]})` → view (otimista: reordena na view na hora e desfaz se der erro).
- `moveVoiceMember({serverId, userId, channelId})`.
- Tema na conta: ao mudar `prefs.appearance.theme`, o main também chama `set_appearance_theme`; ao entrar, se o tema local nunca foi escolhido neste aparelho, usa o da conta.
- Sem a 0007 no banco: tudo novo responde "Atualize o banco (0007)." e o resto funciona.
View (acréscimos):
```
UserLite += { avatarThumbUrl|null, bannerUrl|null, bannerThumbUrl|null, animatedAvatar, animatedBanner,
              avatarCrop:{x,y,zoom}|null, bannerPos (0..100), frame|null, effect|null }
view.me   += os mesmos campos
view.uploads = { avatar: null | { status:'uploading'|'processing'|'error'|'done', progress:0..1, error|null }, banner: idem }
view.voiceMove = null | { nonce, serverId, channelId, by }   // um pedido de mudança de sala feito por um ADM para você; nonce muda a cada pedido
```
Listas e chat usam `avatarThumbUrl` (estático); o original animado só carrega no cartão de perfil, na prévia, e ao passar o mouse.

## 4. Interface
### Frente SHELL (index.html, app.js, shell.js, ui.js, styles.css, novo `theme-boot.js`, `src/renderer/brand/**`, `manifest.webmanifest`, preview/index.html, preview/mock-bridge.js, scripts/build-preview.js, scripts/build-netlify.js, netlify.toml, test/shell/preview.test.js, test/web/**)
- Marca em toda a casca; manifest PWA (nome LUMENEX, ícones, theme_color preto), meta og:/description, favicon, título.
- Temas: Claro, Escuro, **Meia-Noite (AMOLED)** com `#000000` fundo, `#0A0A0A` superfície, `#121212` elevada, texto claro, detalhes dourados discretos; contraste AA. **Sem flash**: `theme-boot.js` (arquivo externo, carregado no `<head>` antes do CSS ser aplicado) lê `localStorage['lumenex-theme']` e põe `data-theme` no `<html>`; `app.js` grava essa chave sempre que a view muda o tema. `<html>` com fundo do tema escuro por padrão no CSS.
- **Arrastar e soltar (só ADM = role owner|admin)**: na barra lateral do servidor, arrastar canais (dentro da categoria e entre categorias, e categorias inteiras) e arrastar participantes de um canal de voz para outro. Pointer Events (mouse) + toque prolongado (450 ms) e arraste no celular. Indicador suave da posição de destino (linha dourada / destaque do canal alvo). Solta → `reorderChannels` / `moveVoiceMember`. Esc cancela. Sem setas, sem botões de mover. Membro comum: nada é arrastável (sem `draggable`, sem cursor de arrastar), clicar continua entrando. Acessível: para teclado, o ADM tem no menu de contexto do canal "Mover para…" (lista de posições/categorias) — isso NÃO é seta nem botão extra na barra.
- Avatares da casca (trilho, lista de membros, DMs, amigos, painel do usuário, cartão de perfil) via `GhostLook.avatar(...)` quando existir; cartão de perfil com banner, moldura e efeito via GhostLook.
- Mock: campos novos em todos os usuários (alguns com moldura/efeito/banner animado gerado por data URL), `uploads` com progresso simulado, `voiceMove`, reorder/move funcionando; cenários novos `?s=look` (configurações na aba Personalização), `?s=midnight`, `?s=admin_drag`.
### Frente LOOK (novos `src/renderer/profile-look.js` + `profile-look.css`; e `settings.js` + `settings.css`)
```
GhostLook.avatar(user, { size: 16..128, animate: 'never'|'hover'|'always', frame: true|false, status?: 'online'|... }) → HTMLElement
   // usa avatarThumbUrl em listas; troca para avatarUrl animado no hover/foco quando animate='hover'; aplica avatarCrop via CSS (object-position + scale), preservando a animação; moldura sobreposta (não substitui a foto)
GhostLook.banner(user, { height }) → HTMLElement       // aplica bannerPos
GhostLook.mountCardEffect(cardEl, user) → { destroy() } // efeito dentro do cartão: pointer-events:none, z-index abaixo dos botões, duração controlada (toca ao abrir, ~2,5 s, alguns em laço leve e baixo), pausa fora da tela (IntersectionObserver + document.hidden), desliga com prefers-reduced-motion (mostra versão estática), máx 1 efeito ativo por vez
GhostLook.FRAMES / GhostLook.EFFECTS  // [{id, label pt-BR}]
GhostLook.renderEditor(container, { bridge, getView }) → { destroy() }   // a aba de personalização
```
- 8 molduras (Energia dourada, Fogo e brasas, Relâmpagos, Magia arcana, Sombras, Gelo, Energia vermelha, Partículas luminosas) e 8 efeitos (Explosão de luz, Chamas ascendentes, Raios elétricos, Partículas mágicas, Névoa sombria, Fragmentos de cristal, Ondas de energia, Pulso luminoso) feitos com CSS/SVG/canvas leves, sem imagens externas, sem libs. Em tamanhos pequenos (≤32 px) a moldura vira só um anel estático para não pesar.
- Editor "Configurações → **Personalização do Perfil**": avatar (escolher arquivo até 40 MB, prévia antes de salvar, recorte/reposicionamento por arrastar a imagem dentro do círculo + controle de zoom, sem recodificar — salva `avatarCrop`), banner (até 40 MB, prévia, arrastar para ajustar `bannerPos`), grade de molduras (com "Nenhuma"), grade de efeitos (com "Nenhum" e botão "Ver efeito"), prévia ao vivo do cartão com moldura e efeito animados, **Salvar / Cancelar / Restaurar aparência padrão**, barra de progresso do upload (`view.uploads`), erros claros (tamanho, formato, falha de conexão com "Tentar de novo"), excluir/substituir avatar e banner. A miniatura é gerada no renderer: primeiro quadro desenhado num canvas 128×128 (avatar) / 480×120 (banner) com o recorte aplicado → `image/webp` ≤ 512 KB. Detecta animação pelos bytes (GIF com >1 quadro; WebP com chunk ANIM) para mandar `animated`.
- settings.js: nova aba "Personalização do Perfil" (o editor acima); Perfil continua com nome/sobre/status; Aparência com "Claro / Escuro / Meia-Noite (AMOLED)" e amostras; textos "até 40 MB"; aba Canais do servidor: remover as setas de subir/descer — no lugar, a lista é reordenável por arrastar e soltar só para ADM (mesma interação da barra lateral) e "Mover para…" no menu para teclado; marca LUMENEX.
### Frente VOZ+CHAT (`voice.js`, `voice.css`, `chat.js`, `chat.css`, `preview/fake-livekit.js`)
- `view.voiceMove` com nonce novo → se já estiver conectado no servidor, troca para o canal pedido (sai e entra; tenta manter mic/câmera/transmissão como estavam; toca o som; aviso "Um administrador moveu você para <canal>"); erro de entrada → volta ao estado desconectado com mensagem. Ignora nonce repetido.
- Avatares na chamada e no chat via `GhostLook.avatar` (chat: `animate:'hover'`, sem moldura em tamanhos pequenos; chamada: com moldura). Marca LUMENEX nos textos.
### Frente MAIN (`src/main/**`, `src/preload/**`, `src/core/**`, `src/web/**`, `package.json`/lock, `build/**`, `test/**` exceto test/db, test/shell/preview.test.js, test/web)
- Seção 3 inteira + marca nos textos do main (notificações, erros, janela, tray se houver) + `productName` LUMENEX com a pasta de dados antiga preservada + `build/icon.png` provisório + testes: validação de 2 MB, 10 MB, 25 MB, 40 MB (aceitos) e 40 MB+1 (recusado), GIF/WebP animados detectados, assinatura falsa recusada, TUS com fetch falso (blocos, progresso, retomada após falha), reorder/move sem permissão recusados na validação, otimismo e desfazer do reorder, tema da conta.

## 5. Testes e entrega
`node --test "test/**/*.test.js"` 100% verde. Capturas headless de cada frente. Não fazer commit — o coordenador integra, revisa, publica (push → Netlify + .exe) e confere o deploy.
