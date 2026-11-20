# Ghost Rank — Plano da Etapa 0 (MVP do rastreador)

Fonte: documento de produto do Ghost Rank, seções "Etapa 0", "Base técnica" e "Segurança".

## Decisões (confirmadas com o Felipe em 2026-11-20)

- Plataforma: Windows, app Electron (Electron 45.x). Celular fica para a etapa 2.
- Dados: só OpenDota (sem chave). Stratz entra quando houver servidor, porque o token não pode ficar no app.
- Histórico: só partidas ranqueadas novas, a partir do momento em que o MMR inicial é informado.
  As últimas 20 ranqueadas anteriores são guardadas apenas como vitória/derrota, para calcular o winrate recente.
- Ganho padrão: 25 MMR por partida, configurável (1 a 100). Mudança no ganho vale só para partidas futuras.
- Sem login nesta etapa: os dados ficam só no computador da pessoa.

## Critério de pronta (do documento)

1. Uma partida ranqueada nova aparece na lista em poucos minutos e o MMR atualiza.
2. A correção manual do MMR funciona.
3. Com winrate recente de 50% ou menos, o app avisa que a meta não chega.

## Arquitetura

```
src/
  core/        lógica pura, sem Electron, 100% testável com node:test
  main/        processo principal: OpenDota, armazenamento, controlador, IPC, janela
  preload/     ponte mínima (contextBridge) entre a tela e o processo principal
  renderer/    tela em HTML/CSS/JS puro, sem frameworks, sem acesso à rede
test/          testes com node:test (rodam sem instalar nada)
```

Tudo em CommonJS (`require`), exceto o renderer, que usa `<script type="module">`.
Sem dependências de produção. Única devDependency: `electron`.

## Contratos entre módulos

### src/core/accountId.js
`parseAccountId(input: string) -> { ok: true, accountId: number } | { ok: false, error: string }`
- Aceita: ID de 32 bits (1 a 4294967295), SteamID64 (`7656119…`, 17 dígitos; 32 bits = id64 − 76561197960265728, usando BigInt),
  e URLs `steamcommunity.com/profiles/<id64>`, `opendota.com/players/<id32>`, `dotabuff.com/players/<id32>`, `stratz.com/players/<id32>`.
- Recusa URL `steamcommunity.com/id/<apelido>` com mensagem explicando que precisa do número.
- Mensagens de erro em português. Entrada com mais de 200 caracteres é recusada.

### src/core/validate.js
- `validateMmr(value) -> { ok, value?, error? }` inteiro de 0 a 20000.
- `validateGain(value) -> { ok, value?, error? }` inteiro de 1 a 100.
- `validateGoal(value) -> mesmo formato de validateMmr`.
- Aceitam número ou string numérica; recusam NaN, decimais, notação estranha.

### src/core/matches.js
- `RANKED_LOBBY_TYPE = 7`
- `isRanked(raw) -> boolean` (lobby_type === 7)
- `didWin(raw) -> boolean` (player_slot < 128 é Radiant; vitória se igual a radiant_win)
- `normalizeMatch(raw) -> { matchId: number, heroId: number, startTime: number, duration: number, win: boolean, partySize: number|null } | null`
  (null se faltar campo obrigatório ou tipo errado; nunca lança)

### src/core/tracker.js (funções puras; nunca mutam a entrada)
Estado (`TrackerState`, versão 1):
```js
{
  version: 1,
  accountId: number,
  personaName: string | null,
  startMmr: number,
  goalMmr: number,
  gainPerMatch: number,
  startedAt: number,            // unix segundos
  baselineCutoff: number,       // startTime da ranqueada mais recente antes do início (ou startedAt se não houver)
  baselineResults: boolean[],   // até 20, mais recente primeiro
  events: Array<
    | { type: 'match', matchId, heroId, startTime, duration, win, delta }
    | { type: 'correction', mmr, at }
  >                              // ordem cronológica
}
```
- `createTracker({ accountId, personaName, startMmr, goalMmr, gainPerMatch, recentMatches, now }) -> TrackerState`
- `ingestMatches(state, rawMatches) -> { state, added: MatchEvent[] }`
  só ranqueadas, normalizadas, com `startTime > baselineCutoff`, sem duplicar `matchId`; adiciona em ordem de `startTime`;
  `delta = win ? +gainPerMatch : -gainPerMatch` (ganho vigente no momento da ingestão).
- `applyCorrection(state, mmr, now) -> TrackerState` (evento de correção com MMR absoluto)
- `updateSettings(state, { goalMmr?, gainPerMatch? }) -> TrackerState`
- `currentMmr(state) -> number` (dobra os eventos: correção define valor absoluto, partida soma delta)
- `summarize(state) -> Summary`:
```js
{
  currentMmr, goalMmr, gainPerMatch,
  remaining,                    // goalMmr - currentMmr
  lastMatch: { matchId, heroId, startTime, win, delta } | null,
  recentWinrate: number | null, // 0..1, últimas até 20: partidas rastreadas (mais novas) + baselineResults
  sampleSize: number,
  matchesNeeded: number | null, // ceil(remaining / (gain * (2w - 1))) quando w > 0.5 e remaining > 0
  status: 'goal_reached' | 'on_track' | 'unreachable' | 'insufficient_data',
                                // insufficient_data quando sampleSize < 5
  matches: Array<{ matchId, heroId, startTime, duration, win, delta, mmrAfter }>  // mais nova primeiro
}
```

### src/main/opendota.js
`createOpenDotaClient({ fetchImpl = globalThis.fetch, baseUrl = 'https://api.opendota.com/api', timeoutMs = 10000, minIntervalMs = 1100, now })`
- `getPlayer(accountId) -> { personaName: string|null, found: boolean }` (GET /players/{id})
- `getRecentMatches(accountId, limit = 20) -> raw[]` (GET /players/{id}/matches?limit=&lobby_type=7; filtra de novo no core)
- `getHeroes() -> { [heroId]: localizedName }` (GET /constants/heroes)
- Só aceita `baseUrl` https; accountId inteiro validado; fila com intervalo mínimo entre chamadas; timeout com AbortController;
  `OpenDotaError` com `code`: 'rate_limited' (429), 'not_found', 'http_error', 'timeout', 'network', 'bad_response'.
- Valida o formato da resposta (array/objeto) antes de devolver. Nunca registra dados pessoais em log.

### src/main/store.js
`createStore({ filePath, encryptor })` — encryptor opcional `{ isAvailable(): boolean, encrypt(str): Buffer, decrypt(Buffer): string }` (safeStorage do Electron).
- `load() -> object | null`, `save(obj)`, `clear()`.
- Escrita atômica (arquivo temporário + rename), permissão 0o600.
- Com encryptor disponível: grava cabeçalho `GR1E` + bytes cifrados; senão JSON puro com cabeçalho `GR1P\n`.
- Arquivo corrompido: renomeia para `<nome>.corrupt-<timestamp>` e devolve null.
- Tamanho máximo lido: 5 MB.

### src/main/controller.js
`createController({ client, store, heroesStore?, now = () => Date.now(), syncIntervalMs = 180000, manualCooldownMs = 30000, onUpdate })`
- `getView() -> View`
- `setup({ accountInput, startMmr, goalMmr, gainPerMatch }) -> View` (valida tudo com core; busca jogador e partidas; cria estado; salva)
- `sync({ manual }) -> View` (respeita cooldown manual; erros viram `sync.error` em português, não exceção)
- `correctMmr({ mmr }) -> View`
- `updateSettings({ goalMmr, gainPerMatch }) -> View`
- `reset() -> View` (apaga dados)
- `start()` / `stop()` (polling periódico; chama `onUpdate(view)` quando algo muda)
Erros de validação: lança `UserInputError` com mensagem em português (o IPC devolve `{ ok: false, error }`).

`View`:
```js
{
  configured: boolean,
  profile: { accountId, personaName } | null,
  summary: Summary | null,
  heroes: { [heroId]: string },
  sync: { status: 'idle' | 'syncing' | 'error', lastSyncAt: number|null, nextSyncAt: number|null, error: string|null, manualAvailableAt: number|null }
}
```

### IPC (src/main/ipc.js + src/preload/preload.js)
Canais `invoke` (todos devolvem `{ ok: true, view } | { ok: false, error }`):
`gr:getView`, `gr:setup`, `gr:sync`, `gr:correctMmr`, `gr:updateSettings`, `gr:reset` (exige `{ confirm: true }`).
Evento do main para a tela: `gr:update` com `view`.
- Todo handler confere o remetente (`event.senderFrame.url` começa com `app://ghost-rank/`) e aceita só objetos simples com as chaves esperadas.

Preload expõe `window.ghostRank`:
`getView()`, `setup(data)`, `sync()`, `correctMmr(mmr)`, `updateSettings(data)`, `reset()`, `onUpdate(cb) -> unsubscribe`.

## Segurança aplicada na Etapa 0 (do documento)

- Electron (seção 6): `contextIsolation`, `sandbox`, `nodeIntegration: false`, `webSecurity`, `app.enableSandbox()`;
  protocolo próprio `app://ghost-rank/` com bloqueio de path traversal; CSP rígida (`default-src 'none'`, sem rede no renderer);
  navegação e novas janelas bloqueadas; links externos só https e só domínios conhecidos, abertos no navegador;
  permissões (câmera, microfone etc.) negadas; `<webview>` bloqueado; DevTools só em desenvolvimento; instância única.
- API (seção 5): só HTTPS; toda entrada validada no processo principal; nenhuma chave no app; logs sem dados pessoais.
- Dados (seção 8): coletar o mínimo (Account ID, apelido público, MMR, partidas); arquivo local cifrado com safeStorage;
  botão "Apagar meus dados".
- Abuso (seção 10): fila e intervalo mínimo nas chamadas ao OpenDota, polling a cada 3 min, atualização manual com espera de 30 s.
- Testes (seção 11): testes automáticos de core, cliente, armazenamento e controlador; CI com `npm test` e `npm audit`.
- Pendentes para etapas seguintes: assinatura de código do instalador, atualização automática assinada, Electron Fuses.

## Divisão em tarefas paralelas

| Tarefa | Arquivos | Depende de |
| --- | --- | --- |
| A. Core | src/core/*, test/core/* | contratos |
| B. Serviços do main | src/main/opendota.js, store.js, controller.js, test/main/* | contratos de A |
| C. Casca Electron | src/main/main.js, protocol.js, ipc.js, security.js, src/preload/preload.js, package.json, .github/, .gitignore, SECURITY.md, README.md | contratos |
| D. Tela | src/renderer/*, preview/* | contrato de View e window.ghostRank |

Depois: integração, `npm test`, prévia da tela no Chrome com API simulada, revisão de design com /impeccable, commits.
