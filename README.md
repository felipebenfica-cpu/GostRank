# Ghost Rank

App de desktop (Electron, Windows) que rastreia o seu MMR de Dota 2 a partir das partidas ranqueadas
públicas do [OpenDota](https://www.opendota.com) e avisa se, no ritmo atual, a sua meta de MMR vai chegar.

## Como rodar

Requer Node.js 22 ou mais novo.

```bash
npm install
npm start
npm test
```

Para abrir as DevTools durante o desenvolvimento: `GHOST_RANK_DEV=1 npm start` (só funciona com o app não empacotado).

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

## Limites do MVP (Etapa 0)

- Só Windows e só OpenDota (sem chave); o perfil Dota precisa expor o histórico de partidas publicamente.
- Só partidas ranqueadas novas a partir do MMR inicial informado; as 20 anteriores entram só como vitória/derrota.
- Ganho fixo por partida (padrão 25, configurável de 1 a 100); o MMR real pode divergir, então há correção manual.
- Sem login: os dados ficam só neste computador.
- Ainda sem assinatura de código, atualização automática assinada e Electron Fuses.
