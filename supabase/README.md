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
