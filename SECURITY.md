# Política de segurança

## Como reportar uma falha

Se você encontrou uma vulnerabilidade no Ghost Rank, **não abra uma issue pública**.
Use o recurso "Report a vulnerability" (aviso privado de segurança) na aba Security
do repositório no GitHub. Descreva o problema, os passos para reproduzir e o impacto.
Responderemos assim que possível e creditaremos quem reportou, se desejar.

## O que está coberto na Etapa 0

- Electron com `contextIsolation`, `sandbox`, `nodeIntegration: false` e `webSecurity`.
- Protocolo próprio `app://ghost-rank/` com bloqueio de path traversal e lista de extensões permitidas.
- CSP rígida (`default-src 'none'`, `connect-src 'none'`): a tela não acessa a rede.
- Navegação, novas janelas e `<webview>` bloqueados; links externos só em HTTPS e só para domínios conhecidos.
- Todas as permissões do navegador (câmera, microfone etc.) negadas.
- DevTools apenas em desenvolvimento (`GHOST_RANK_DEV=1` com app não empacotado).
- IPC com conferência do remetente e validação rigorosa de payloads no processo principal.
- Sem chaves de API no app; chamadas à OpenDota só por HTTPS, com fila e intervalo mínimo.
- Dados mínimos guardados localmente, cifrados com `safeStorage` quando disponível; botão "Apagar meus dados".
- CI com testes e `npm audit`.

## O que ainda falta

- Assinatura de código do instalador.
- Atualização automática assinada.
- Electron Fuses (desativar recursos não usados no binário).
