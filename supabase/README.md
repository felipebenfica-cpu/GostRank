# Banco de dados do Ghost Rank (Supabase)

Este guia e para quem nao e da area tecnica. Voce vai fazer isso uma unica vez.

## 1. Aplicar o arquivo do banco

1. Entre em https://supabase.com/dashboard e abra o projeto `jdipignyikikagjvynve`.
2. No menu da esquerda, clique em **SQL Editor**.
3. Clique em **New query** (nova consulta).
4. Abra o arquivo `supabase/migrations/0001_perfis.sql` deste repositorio, copie **todo** o conteudo e cole na janela do SQL Editor.
5. Clique no botao verde **Run** (executar).
6. Deve aparecer "Success. No rows returned". Se aparecer erro em vermelho, nao mexa em mais nada e envie o texto do erro para quem cuida do projeto.

Se precisar rodar de novo, tudo bem: o arquivo foi feito para poder ser executado mais de uma vez.

## 2. Conferir se deu certo

1. **Table Editor** -> tabela **profiles**: ela deve existir e mostrar um cadeado indicando que a protecao RLS (Row Level Security) esta **ligada**. Sem esse cadeado, qualquer pessoa poderia ver dados de outras.
2. **Authentication -> Providers -> Email**: a opcao **Confirm email** deve estar **LIGADA**.
3. **Authentication -> URL Configuration**: confira o campo **Site URL** e a lista **Redirect URLs**. Use apenas enderecos que voce controla; nao deixe enderecos desconhecidos na lista.

## 3. Ajustes recomendados em Authentication

- **Confirmacao de e-mail obrigatoria** (Confirm email ligado): ninguem entra sem confirmar o e-mail.
- **Tamanho minimo de senha: 10** (em Authentication -> Sign In / Providers -> Email, ou em Policies, conforme a versao do painel). O app tambem exige 10 ou mais.
- **Protecao contra senhas vazadas** (Leaked password protection): se estiver disponivel, ligue. Depende do plano do Supabase e **nao foi verificado** se o plano deste projeto permite.
- **Limites de taxa (Rate Limits)**: mantenha os valores padrao. Eles freiam tentativas em massa de login e envio de e-mails.

## O que o arquivo faz

- Cria a tabela `profiles` (apelido, privacidade do MMR e, no futuro, a conta Steam).
- Cada pessoa so ve e altera o proprio perfil, e so pode alterar o apelido e a privacidade do MMR.
- Cria o perfil automaticamente quando alguem se cadastra (apelido inicial = parte do e-mail antes do @, ate 24 letras).
- Cria a funcao `delete_my_account()`, que permite a pessoa apagar a propria conta (e o perfil junto).
- Visitantes sem login (`anon`) nao tem acesso a tabela.

---

# Etapas 2, 3 e 4: grupo, chat, voz e Steam

Faca estes passos **depois** do `0001_perfis.sql`, uma unica vez.

## 4. Aplicar o arquivo do grupo (0002)

1. No painel do Supabase, abra **SQL Editor** -> **New query**.
2. Abra o arquivo `supabase/migrations/0002_grupo.sql`, copie **todo** o conteudo e cole na janela.
3. Clique em **Run**. Deve aparecer "Success. No rows returned".
4. Em **Table Editor**, confira que existem as tabelas `groups`, `group_members`, `group_invites`, `mmr_snapshots`, `messages` e `steam_link_states`, todas com o cadeado de RLS **ligado**.

Pode rodar de novo sem problema. Se aparecer erro em vermelho, nao mexa em mais nada e envie o texto do erro.

### O que o 0002 faz antes da atualização social

- Cada pessoa pode estar em **um** grupo so, com no maximo **10** membros. O grupo tem um dono.
- So o dono cria convites. O codigo tem 10 letras/numeros (sem letras que confundem, como O/0 e I/1), vale **7 dias** e serve para ate **5** pessoas.
- Codigo errado, vencido ou ja usado ate o limite da a **mesma** mensagem de erro (para ninguem ficar adivinhando).
- Quando o dono sai, o membro mais antigo vira dono. Quando o ultimo sai, o grupo e apagado.
- Membros veem o grupo, os colegas, o apelido deles e as mensagens do chat. Quem esta fora nao ve nada.
- O resumo do MMR de alguem so aparece para os colegas se a privacidade dessa pessoa for "grupo" ou "amigos". Com "ninguem", fica escondido.
- Chat: no maximo 10 mensagens a cada 10 segundos por pessoa. Mensagens nao podem ser editadas; cada um apaga so as suas.
- Apagar a conta apaga tudo da pessoa (perfil, mensagens, resumo de MMR). Se ela era dona de um grupo, a posse passa para o membro mais antigo.

### Atualização de convites, amigos e fotos (0003)

Depois de aplicar o 0002, execute [0003_social.sql](migrations/0003_social.sql) no SQL Editor do mesmo projeto. A atualização permite reutilizar o código de convite sem prazo nem limite de usos. A capacidade do grupo continua em dez membros. A busca por apelido, os pedidos de amizade, a privacidade da descoberta e as fotos de perfil e grupo usam o mesmo banco no app e no site.

## 5. Publicar as funcoes do servidor (Edge Functions)

Sao duas: `livekit-token` (entrega a chave da sala de voz) e `steam-link` (vincula a conta Steam).

### Pelo painel (sem instalar nada)

O editor do painel trabalha melhor com **um arquivo so**. Por isso o repositorio ja traz cada funcao pronta num unico arquivo, com tudo embutido:

- `supabase/functions/livekit-token/bundle.ts`
- `supabase/functions/steam-link/bundle.ts`

Para cada uma das duas funcoes:

1. No menu da esquerda, clique em **Edge Functions**.
2. Clique em **Deploy a new function** e escolha **Via Editor**.
3. No nome da funcao, digite exatamente `livekit-token` (ou `steam-link` na segunda vez).
4. Apague o codigo de exemplo que aparece no editor (arquivo `index.ts`).
5. Abra o `bundle.ts` correspondente deste repositorio, copie **todo** o conteudo e cole no lugar.
6. Clique em **Deploy function** e espere terminar.
7. Abra a funcao publicada, va em **Details** (ou **Settings**) e **DESLIGUE** a opcao **Verify JWT** (as vezes chamada "Enforce JWT verification"). Clique em salvar.
   - Isso e necessario: a `livekit-token` confere o login ela mesma, e o retorno da Steam para a `steam-link` vem do navegador, sem login.

Nao cole os arquivos `index.ts` direto no painel: eles importam arquivos da pasta `_shared`, que o painel nao teria. Os `bundle.ts` ja tem esses arquivos dentro.

Se alguem mudar `index.ts` ou algo em `_shared`, gere os `bundle.ts` de novo com:

```
node supabase/functions/build-bundles.js
```

(Os testes avisam se os `bundle.ts` estiverem desatualizados.)

### Pela linha de comando (opcional, para quem usa a CLI do Supabase)

```
supabase functions deploy livekit-token --no-verify-jwt
supabase functions deploy steam-link --no-verify-jwt
```

A CLI leva a pasta `_shared` junto automaticamente, entao ela usa os `index.ts`.

## 6. Cadastrar os segredos da voz (LiveKit)

As chaves do LiveKit ficam **somente** no Supabase. **Nunca** coloque essas chaves no app, no `config.json` ou em mensagens.

1. No painel do Supabase, va em **Edge Functions** -> **Secrets** (em alguns paineis: **Project Settings** -> **Edge Functions**).
2. Adicione tres segredos (botao **Add new secret**):

| Nome | Valor |
|---|---|
| `LIVEKIT_URL` | o endereco do projeto no LiveKit Cloud, comecando com `wss://` (ex.: `wss://seu-projeto.livekit.cloud`) |
| `LIVEKIT_API_KEY` | a "API Key" do LiveKit |
| `LIVEKIT_API_SECRET` | o "API Secret" do LiveKit |

3. Salve. Nao precisa publicar as funcoes de novo.

Enquanto esses segredos nao existirem, a voz responde "voz nao configurada" e o resto do app continua funcionando.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` ja vem prontos nas funcoes; nao cadastre nem copie essas chaves para lugar nenhum. A chave `service_role` e usada so dentro das funcoes e nunca e devolvida ao app.

### Pagina de retorno da Steam

Depois de entrar na Steam, o navegador mostra uma mensagem curta (por exemplo, "Steam vinculada. Pode voltar ao Ghost Rank."). O Supabase so permite paginas HTML em projetos com **dominio proprio**; sem isso, a funcao responde em texto simples, o que funciona do mesmo jeito. Se um dia o projeto tiver dominio proprio, da para cadastrar o segredo opcional `STEAM_LINK_HTML` = `true` para a resposta sair em HTML.

# Etapa 6: modelo completo do Discord (0003)

Amigos, varios servidores, canais, cargos, DMs, reacoes, anexos, convites ilimitados e tempo real.
O app antigo (.exe da Etapa 5) continua funcionando depois desta atualizacao.

## 7. Aplicar o arquivo 0003

1. No painel do Supabase, abra **SQL Editor** > **New query**.
2. Abra o arquivo `supabase/migrations/0003_discord.sql`, copie **tudo** e cole.
3. Clique em **Run**. Tem que aparecer "Success. No rows returned".
4. Pode rodar de novo sem problema (o arquivo e idempotente).

Isso ja liga o Realtime (tempo real) e cria os buckets `avatars` e `attachments` no Storage.
Nao precisa mexer em mais nada no painel para isso.

Conferir: em **Table Editor** devem aparecer `channels`, `relationships`, `dm_channels` e
`message_reactions`; em **Storage**, os buckets `avatars` (publico) e `attachments` (privado).
O seu grupo antigo vira um servidor com o canal `#geral` e a sala de voz `Geral`.

## 8. Republicar as duas funcoes

As funcoes mudaram (salas por canal de voz, chamada em DM e liberacao para a versao web).
Para cada uma, `livekit-token` e `steam-link`:

1. **Edge Functions** > abra a funcao > **Code**.
2. Apague tudo e cole o conteudo do `bundle.ts` dela
   (`supabase/functions/livekit-token/bundle.ts` e `supabase/functions/steam-link/bundle.ts`).
3. Clique em **Deploy**.
4. Em **Details**, confira que **Verify JWT** continua **desligado**.

Os segredos do LiveKit ja cadastrados continuam valendo; nao precisa cadastrar de novo.

### O que o 0003 faz

- Nome de usuario unico (`@usuario`) para todo mundo, gerado a partir do apelido; pode ser trocado.
- Amigos: pedidos, aceitar, recusar, remover e bloquear; busca de pessoas pelo nome de usuario.
- Varios servidores por pessoa (ate 50), ate 100 pessoas por servidor; cargos dono, admin e membro;
  expulsar, banir, apelido no servidor, transferir posse.
- Categorias e canais de texto e de voz.
- Convite permanente por padrao: **nunca expira e nao tem limite de usos**. Da para criar convites
  com validade (30 min a 7 dias) e limite (1 a 100 usos), e revogar.
- Mensagens: DMs, respostas, edicao, reacoes, anexos (ate 8 MB), mencoes, fixadas, nao lidas e busca.
- Tempo real com canais privados: so membros do servidor, participantes da DM e amigos recebem os eventos.
