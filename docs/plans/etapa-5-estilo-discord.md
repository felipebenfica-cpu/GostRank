# Etapa 5 — Interface no modelo de uso do Discord (identidade visual do Ghost Rank)

Objetivo: o mesmo modelo de organização e funcionamento que os amigos já conhecem do Discord, com a identidade própria do Ghost Rank (tokens atuais de cor/tipo, fantasma, sem logo, cores ou nomes do Discord).

## Estrutura da janela (app.js / index.html / styles.css — tarefa A)
Quatro colunas em tela larga (>= 1100px):
1. **Trilho** (72px): ícone do Ghost Rank no topo (vai para "Meu MMR"), separador, ícone redondo do grupo (iniciais do nome; com indicador de seleção à esquerda como pílula), botão "+" (criar/entrar em grupo, abre os formulários atuais num <dialog>).
2. **Barra lateral** (240px): cabeçalho com nome do grupo e menu (Convidar, Sair do grupo); seção "Texto" com canal `# chat`; seção "Voz" com canal `🔊 Sala de voz` (ícone SVG de alto-falante, sem emoji) — clicar entra na voz; abaixo do canal, a lista de quem está na voz (container `#voice-channel-members`, preenchido por voice.js); seção "Ghost Rank" com `Meu MMR` e `Ranking dos fantasmas`. No rodapé: **painel de conexão de voz** (container `#voice-connection`, preenchido por voice.js; só aparece conectado) e **painel do usuário** (avatar com iniciais, apelido, status "online"; botões microfone, ensurdecer — container `#voice-user-controls` preenchido por voice.js — e engrenagem que abre "Minha conta").
3. **Área principal**: cabeçalho com nome do canal atual; conteúdo conforme a seleção: chat (mensagens agrupadas como no Discord: avatar + nome + hora na primeira de uma sequência do mesmo autor em até 5 min, as seguintes só o texto; separador de dia; campo "Conversar em #chat" fixo embaixo), palco de voz (container `#voice-stage`, preenchido por voice.js), Meu MMR (tela atual do rastreador, intacta), Ranking (lista atual).
4. **Lista de membros** (240px; some < 1100px e vira botão no cabeçalho): seções "Na voz — N" e "Membros — N", cada um com avatar de iniciais, apelido, coroa para o dono e o **MMR atual** pequeno (ou "MMR escondido"); clique abre um cartão de perfil (popover/dialog) com MMR atual → meta, barra de progresso e estado.
Sem conta ou sem grupo: trilho + tela "Meu MMR" e, ao clicar no grupo/"+", os formulários de criar/entrar. < 700px: trilho + uma coluna com botão de menu para a barra lateral.

Atalhos: Ctrl+Shift+M (mutar), Ctrl+Shift+D (ensurdecer) quando conectado.

## Voz (voice.js e novo voice.css — tarefa B)
API (substitui a atual):
```
GhostVoice.init({ bridge, els: { stage, channelMembers, connection, userControls }, onState(state) })
GhostVoice.update(view)       // recebe a View a cada mudança
GhostVoice.join()             // entra na sala (chamado pelo clique no canal de voz)
GhostVoice.leave()
GhostVoice.toggleMute(); GhostVoice.toggleDeafen()
state = { connected, connecting, muted, deafened, sharing, participants: [{ userId, name, speaking, muted, deafened, sharing }] }
```
- **Canal na barra lateral** (`channelMembers`): lista de quem está na voz com avatar de iniciais, contorno verde quando fala, ícones mutado/ensurdecido e selo "AO VIVO" para quem transmite.
- **Painel de conexão** (`connection`): "Voz conectada" + "Sala de voz / <grupo>", indicador de qualidade (ping via `room.engine` se houver, senão omitido), botões "Compartilhar tela" (abre o seletor de qualidade + fontes) e "Desconectar" (vermelho, ícone de telefone).
- **Controles do usuário** (`userControls`): microfone (riscado quando mutado, vermelho) e fone (ensurdecer: muta todos os áudios remotos e também o próprio microfone, como no Discord; ao sair do ensurdecer, o microfone volta ao estado anterior).
- **Palco** (`stage`): grade de cartões (16:9) para cada participante: avatar grande de iniciais no centro, nome no canto inferior esquerdo, ícones mutado/ensurdecido, contorno verde ao falar. Quem transmite ganha cartão de transmissão com selo "AO VIVO" e, para os outros, **prévia + botão "Assistir transmissão"** — o vídeo só é assinado ao clicar (`publication.setSubscribed(true)`; antes, `setSubscribed(false)` assim que a publicação de tela aparece). Assistindo: **modo foco** (a transmissão ocupa o palco, os demais viram uma faixa de miniaturas embaixo; clicar numa miniatura troca o foco), botões no hover/foco: **Tela cheia**, **Picture-in-picture** (`video.requestPictureInPicture`, se disponível), **Volume da transmissão** (slider para a faixa de áudio da tela), **Parar de assistir**. Duplo clique = tela cheia. Barra fixa embaixo do palco com os mesmos controles do usuário + compartilhar + desconectar.
- **Volume por pessoa**: botão "…"/clique direito no cartão abre menu: slider de volume 0–200% (`participant.setVolume(v)`), "Mutar para mim". Guardar em memória por userId.
- **Seletor ao compartilhar** (<dialog>): abas "Telas" e "Janelas" com miniaturas (`listScreenSources`), e escolha de qualidade: Resolução 720p / 1080p / Fonte (nativa, até 2560x1440) e Taxa 30 / 60 quadros. Padrão: 1080p 30. Bitrate: 720p 3 Mbps, 1080p 6 Mbps, Fonte 10 Mbps; 60 fps multiplica por 1,5. Manter a recaída sem áudio e o detalhe técnico do erro já existentes. Quem transmite vê a própria prévia pequena com "Parar transmissão".
- Sons de entrar/sair (Web Audio, tons curtos gerados por código, sem arquivos), respeitando ensurdecido.
- Room: `adaptiveStream:false, dynacast:true`; tela assinada com `setVideoQuality(HIGH)`.
- Sem lista de espectadores (precisa de canal de dados; fica para depois).

## Regras de sempre
CSP sem inline, sem innerHTML/eval, textContent/createElement, ícones SVG por código, acessibilidade (roles, aria-pressed, aria-label nos botões só de ícone, foco visível, teclado, aria-live para entrar/sair/transmissão), prefers-reduced-motion, sem rede na prévia. test/shell/preview.test.js deve continuar passando (inclua voice.css nas checagens se fizer sentido). Prévia: cenários atuais continuam; `?s=voice&join=1` deve mostrar o palco com transmissão e foco.
