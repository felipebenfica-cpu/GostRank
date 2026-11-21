# Ghost Rank

Ghost Rank acompanha o MMR de Dota 2 com dados do OpenDota e permite encontrar amigos, formar grupos e conversar. O app tem uma versão para Windows em Electron e uma versão web.

## Como rodar

Requer Node.js 22 ou mais novo.

```bash
npm install
npm start
npm test
```

Para abrir as DevTools durante o desenvolvimento: `GHOST_RANK_DEV=1 npm start` (só funciona com o app não empacotado).

## Atualizar o site e o banco

O site `ghosttouch.netlify.app` usa a branch `etapa-2-grupo-voz`. O login e os grupos existentes funcionam com a migração 0002. A migração 0003 ativa os convites permanentes, as fotos e as amizades.

1. Abra o projeto `jdipignyikikagjvynve` no Supabase. Em **SQL Editor**, execute o arquivo [0003_social.sql](supabase/migrations/0003_social.sql). Em um banco novo, execute primeiro [0001_perfis.sql](supabase/migrations/0001_perfis.sql) e [0002_grupo.sql](supabase/migrations/0002_grupo.sql), nessa ordem.
2. Confira se `config.public.json` aponta para o mesmo projeto e contém a chave pública de cliente. As contas da versão web usam o login por e-mail do Supabase.
3. Execute `npm test` e `node scripts/build-netlify.js`. O Netlify publica a pasta `dist/` com a configuração de [netlify.toml](netlify.toml). A integração com GitHub publica as mudanças incorporadas à branch de produção.
4. Confira o fluxo com duas contas confirmadas em navegadores distintos. Crie um grupo com a primeira, copie o convite e entre com a segunda. Pesquise o apelido da outra conta, envie o pedido de amizade e aceite pelo outro navegador. Troque a foto do perfil e, na conta do dono, a foto do grupo. Reabra as telas nas duas contas para conferir as fotos.

A migração [0004_chat_mensagens.sql](supabase/migrations/0004_chat_mensagens.sql) habilita edição das próprias mensagens e registra o horário da mudança. Depois da 0003, a [0005_mensagens_diretas.sql](supabase/migrations/0005_mensagens_diretas.sql) permite que amigos confirmados conversem em **Amigos → Mensagem**. A busca no chat de grupo abrange as últimas 200 mensagens carregadas. Tema, tamanho da fonte e movimento são preferências do dispositivo em **Minha conta**.

A página `preview/index.html` usa uma simulação local para desenvolver a interface. Os convites e as contas dessa prévia existem só na demonstração. Para compartilhar o grupo com outra pessoa, ambos devem entrar em uma versão conectada ao mesmo projeto Supabase.

## Conferir a publicação e reverter uma versão

O merge em `etapa-2-grupo-voz` inicia duas entregas independentes. No Netlify, abra o deploy de produção de **ghosttouch** e confira o commit publicado. No GitHub Actions, acompanhe **Gerar .exe para Windows** para o mesmo commit. O executável portátil fica no [release da branch](https://github.com/felipebenfica-cpu/GostRank/releases/tag/teste-etapa-2-grupo-voz). O site e o executável podem terminar em horários diferentes.

Se precisar voltar à versão anterior do aplicativo, abra um PR que reverta o commit da atualização na branch de produção. Para um commit de merge, use `git revert -m 1 <sha-do-merge>` em uma branch nova. Teste o cliente anterior com a versão atual do banco antes de incorporar a reversão. Preserve as tabelas, fotos, pedidos de amizade e convites existentes. Se uma função SQL também precisar de correção, publique uma nova migração que preserve as assinaturas usadas pelos clientes web e Windows já distribuídos. Após o merge, confira os dois resultados de publicação novamente.

## Estrutura

```
src/
  core/      lógica pura (conta, validação, partidas, rastreador), sem Electron
  main/      processo principal: OpenDota, armazenamento, controlador, IPC, janela, protocolo, segurança
  preload/   ponte mínima (contextBridge) que expõe window.ghostRank
  renderer/  tela em HTML/CSS/JS puro, sem frameworks e sem acesso à rede
test/        testes com node:test
docs/plans/  plano da Etapa 0
```

## Segurança

- `contextIsolation`, `sandbox`, `nodeIntegration: false`, `webSecurity` e instância única.
- Tela servida por `app://ghost-rank/` com bloqueio de path traversal e CSP rígida (sem rede no renderer).
- Navegação, novas janelas e `<webview>` bloqueados; links externos só HTTPS para domínios conhecidos.
- Permissões do navegador negadas; DevTools só em desenvolvimento.
- IPC valida remetente e payloads no processo principal.
- Dados locais cifrados com `safeStorage` quando disponível; botão para apagar tudo.

Detalhes e como reportar falhas em [SECURITY.md](SECURITY.md).

## Rastreador de MMR e distribuição para Windows

- O rastreador usa o OpenDota. O perfil Dota precisa expor o histórico de partidas publicamente.
- Só partidas ranqueadas novas a partir do MMR inicial informado; as 20 anteriores entram só como vitória/derrota.
- Ganho fixo por partida (padrão 25, configurável de 1 a 100); o MMR real pode divergir, então há correção manual.
- Ainda sem assinatura de código, atualização automática assinada e Electron Fuses.
