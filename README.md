# GostRank

# 🔒 ??? (PERSONAGEM NÃO DESBLOQUEADO) *Personagem Preto

<div align="center">
  <!-- Silhueta escura estilo Street Fighter / Mortal Kombat -->
  <img src="https://s2-techtudo.glbimg.com/QCqzwbtx--xiimPYYxGPIRIJuic=/0x0:695x440/1000x0/smart/filters:strip_icc()/i.s3.glbimg.com/v1/AUTH_08fbf48bc0524877943fe86e43087e7a/internal_photos/bs/2021/O/j/eAHbTNTz64z5eq6Aw8Ng/2014-04-30-mortal-kombat-2-fliperama-jade-noob-saibot-smoke.jpg" width="220" alt="Silhueta Bloqueada" style="filter: brightness(0);" />
  <br>
  <em>"Um novo desafiante aguarda nas sombras da fila ranqueada..."</em>
</div>

---

## 📊 Status de Desbloqueio (MMR & Contribuição)

Este perfil representa um **Hero Slot Bloqueado** destinado exclusivamente ao monitoramento de **MMR (Matchmaking Rating)** e **contribuições de código/dados** para o ecossistema Dota 2.

| Atributo | Status Atual |
| :--- | :--- |
| **Identidade** | `REDACTED / SILHOUETTE` |
| **Função (Role)** | `Contribuidor de MMR / Suporte de Dados` |
| **MMR Atual** | `[ ████░░░░░░ ] 40% para o próximo Rank` |
| **Status na Pool** | 🔒 **Bloqueado** (Apenas ganho de pontos ativo) |

---

## 🕹️ Mecânica do Personagem

Assim como os personagens ocultos dos fliperamas clássicos de *Street Fighter*:
* **Aparência:** Silhueta totalmente preta (`#000000`) com olhos/aura ocultos até que a meta de MMR seja atingida.
* **Objetivo Único:** Não possui habilidades cosméticas ou lore ativa; sua única função no repositório é **registrar vitórias, derrotas e variações de MMR** através de commits.
* **Condição de Desbloqueio:** Atingir a meta de **Immortal / Top Contribuidor** ou completar `100` commits de análise de partidas.

---

## 📈 Log de Contribuição de MMR

```text
[SISTEMA]: Aguardando dados da última partida ranqueada...
> Modo: Ranked All Pick
> Impacto: +25 MMR (Contribuição registrada)
> Estado do Herói: PERMANECE NAS SOMBRAS
```

---

# Sumário de Mudanças - Importação de Partidas e MMR Melhorada (Dota 2)

## Arquivos Criados

### 1. `lib/view/import_matches_preview_dialog.dart`
**Novo arquivo** - Helper para preview e validação de importação de histórico ranqueado

**Funcionalidades**:
- Validação automática de cabeçalho (campos obrigatórios da partida)
- Dialog com preview dos primeiros 3 registros (Hero, KDA e variação de MMR)
- Normalização de nomes de heróis e IDs de partida
- Suporte a CSV (exportado do OpenDota, Stratz ou planilha manual)

**Métodos principais**:
- `validarCabecalho()` - Valida campos obrigatórios (`Match ID` e `Variacao MMR`)
- `mostrarPreview()` - Mostra dialog de preview com o impacto no desbloqueio do personagem
- `_buildPreviewRecord()` - Constrói widget de registro da partida

### 2. `IMPORT_MATCHES_GUIDE.md`
**Novo arquivo** - Documentação completa da funcionalidade de importação de MMR

**Conteúdo**:
- Guia de uso passo-a-passo
- Formato esperado de arquivo CSV
- Regras de cálculo de MMR e progresso da silhueta
- Troubleshooting (ex: partidas *Not Scored* ou *Turbo*)
- Roadmap futuro

### 3. `exemplo_importacao_partidas_dota2.csv`
**Novo arquivo** - Template de exemplo para jogadores

**Conteúdo**:
- 3 registros de exemplo com dados realistas de partidas ranqueadas
- Todos os campos suportados (`match_id`, `heroi`, `variacao_mmr`, `kda`, `patch`)
- Espaço para entender o formato antes do upload

## Arquivos Modificados

### 1. `lib/view/dev_tools_view.dart`

**Adições**:
- Import do novo helper: `import 'import_matches_preview_dialog.dart';`
- Novo método: `importarPlanilhaPartidas()`

**Funcionalidades**:
- Parse de arquivo CSV de histórico
- Validação de cabeçalho usando helper
- Mostrar preview dialog com projeção de MMR
- Executar importação completa e atualizar estado do personagem bloqueado
- Mostrar resultado final

**Linha aprox**: ~570-680

### 2. `lib/core/utils/app_strings.dart`

**Strings adicionadas**:
```dart
// Validação e Preview
static String get validacaoArquivoPartidas
static String get cabecalhoValido
static String get camposObrigatorios
static String get camposOpcionais
static String get camposNaoMapeados
static String get formatoEsperadoCsv
static String get previewPartidas
static String get avisosFila
static String get errosValidacao
static String get procedeImportacaoMmr

// Detalhes
static String get campos
static String get tipo
static String get descricao
static String get obrigatorio
static String get opcional
static String get matchIdDesc
static String get variacaoMmrDesc
static String get heroiJogadoDesc
static String get previewRegistroPartida
static String get totalPartidasValidas
static String get totalPartidasIgnoradas

// Botões
static String get sim
static String get nao
```

---

## Fluxo de Uso

Jogador clica "Importar Histórico"
↓
Seleciona arquivo CSV de partidas
↓
Sistema faz parse e valida cabeçalho
↓
Se erro → Mostrar mensagem e retornar
↓
Se OK → Mostrar preview dialog (saldo de MMR)
↓
Jogador revisa e clica "Importar"
↓
Sistema normaliza dados (Match ID, Herói, +/- MMR)
↓
Sistema salva no Firestore e atualiza barra da Silhueta
↓
Mostrar resultado: X partidas importadas, Y ignoradas, Z erros

---

## Validações Implementadas

### Cabeçalho
✅ Verifica `Match ID` (obrigatório)
✅ Verifica `Variacao MMR` (obrigatório)
✅ Aceita variações (`ID Partida`, `MMR`, `Pontos`, `Hero`, etc.)

### Dados
✅ Valida `Match ID` (mínimo 10 dígitos numéricos)
✅ Normaliza: Remove caracteres não-numéricos do ID
✅ Valida variação de MMR (ex: `+25`, `-25`, `+40` Double Down)
✅ Ignora partidas sem variação de MMR válida (ex: *Turbo* ou *Abandono pré-First Blood*)

### Preview
✅ Mostra campos encontrados
✅ Mostra primeiras 3 partidas
✅ Indica total de partidas válidas e saldo líquido de MMR
✅ Permite cancelar antes de alterar o progresso do personagem

---

## Normalizações Automáticas

- **Match ID**: Remove prefixos/espaços, valida mínimo 10 dígitos
- **Nome do Herói**: Padroniza apelidos comuns (ex: `SF` → `Shadow Fiend`, `PA` → `Phantom Assassin`)
- **Campos**: Normaliza para comparação (acentos, espaços, caixa alta/baixa)
- **Vazios**: Remove `null`/`empty` do mapa final antes de persistir

---

## Tratamento de Erros

1. **Arquivo inválido**: Mensagem clara indicando falha de leitura
2. **Cabeçalho incompleto**: Indica qual coluna obrigatória está faltando
3. **Partida duplicada**: Ignora `Match ID` já registrado para evitar MMR duplicado
4. **Importação falha**: Mostra resultado detalhado por linha

---

## Próximas Etapas (Opcional)

Para melhorias futuras:

1. [ ] Adicionar suporte a importação direta via JSON da API do OpenDota
2. [ ] Permitir mapeamento customizado de colunas do Dotabuff
3. [ ] Preview visual da mudança de medalha (ex: *Legend* → *Ancient*)
4. [ ] Detecção automática de partidas com *Rank Double Down Token*
5. [ ] Exportação automática do card `.md` atualizada para o GitHub após importação
6. [ ] Download de template CSV pré-formatado

---

## Teste Rápido

1. Use o arquivo `exemplo_importacao_partidas_dota2.csv`
2. Clique em "Importar Histórico" nos Dev Tools
3. Revise o preview de ganho/perda de MMR
4. Clique "Importar"
5. Verifique o novo saldo na silhueta do personagem bloqueado

---

## Notas Técnicas

- Helper é *stateless* e reutilizável
- Sem dependências externas novas
- Compatível com Flutter mobile e Web
- Usa `AppStrings` para internacionalização (PT-BR / EN)
- Validação prévia evita corrupção do histórico de MMR

---

**Versão**: 1.0
**Status**: Pronto para uso

<div align="center">
  <sub>Gerado por Kez para o rastreamento de progresso • Estilo Arcade Classic</sub>
</div>

# 🔒 DEVS

<div align="center">
  <!-- Silhueta escura estilo Street Fighter / Mortal Kombat -->
  <img src="https://www.dota2.com/hero/kez?l=brazilian" width="220" alt="Silhueta Bloqueada" style="filter: brightness(0);" />
  <br>
 <img src="https://www.dota2.com/hero/keeperofthelight?l=brazilian" width="220" alt="Silhueta Bloqueada" style="filter: brightness(0);" />
  <em>"Um novo desafiante aguarda nas sombras da fila ranqueada..."</em>
</div>