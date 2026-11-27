# Recuperação de senha — como funciona e o que configurar no Supabase

## No aplicativo
1. **Esqueci minha senha** pede o link (`/auth/v1/recover`, com `redirect_to=https://lumenex.netlify.app/`).
   A resposta é a mesma exista a conta ou não; há intervalo de 60 s por e-mail na tela.
2. O link abre o site em **Criar nova senha**. O token é retirado da barra de endereço e fica só em memória.
3. A senha é trocada na mesma conta (mesmo ID: perfil, amigos, mensagens, servidores e MMR não mudam).
4. Todas as sessões são encerradas (`logout?scope=global`). Tokens de acesso já emitidos valem até expirar
   (por padrão, 1 hora).

Funciona com o modelo de e-mail padrão do Supabase e com o do LUMENEX (`email-recuperacao.html`).
O do LUMENEX só consome o link quando a senha é enviada, então antivírus que abrem links não o gastam.

## Configuração no painel (projeto `jdipignyikikagjvynve`) — PENDENTE
1. **Authentication > URL Configuration**
   - Site URL: `https://lumenex.netlify.app`, **sem barra no final** (o domínio antigo `ghosttouch.netlify.app` responde 404;
     se ainda estiver aqui, os links não funcionam e o domínio deve ser removido da lista).
   - Redirect URLs: `https://lumenex.netlify.app/`
2. **Authentication > Emails > SMTP Settings**: o serviço padrão do Supabase **só entrega para membros da
   equipe do projeto** e tem limite baixo por hora. Para os usuários receberem, configure um SMTP próprio.
   Opção sem custo e sem domínio próprio: um provedor com plano gratuito e remetente verificado por e-mail
   (por exemplo, Brevo; confira as condições atuais antes de criar a conta). Remetente: `LUMENEX`.
3. **Authentication > Emails > Templates > Reset password**
   - Assunto: `LUMENEX — redefinir sua senha`
   - Corpo: o conteúdo de `email-recuperacao.html`. Faça isto **depois** do passo 1.
4. **Authentication > Sign In / Providers > Email**: tamanho mínimo da senha 10; expiração do link 3600 s ou menos.
5. **Authentication > Rate Limits**: manter limites baixos. CAPTCHA (Turnstile) é um reforço possível, ainda
   não integrado: **não ligue** a opção no painel, ou o login para de funcionar.

## Teste real depois de configurar
Pedir o link com uma conta sua → abrir o e-mail → criar a senha → entrar com a nova → confirmar que a antiga
falha → abrir o mesmo link de novo (deve aparecer "inválido ou expirado").

## Reversão
No Netlify: **Deploys > deploy anterior > Publish deploy**. No Git: reverter o commit na branch de produção.
Não há mudança de banco nesta entrega.

## Ponto de restauração desta entrega (27/11/2026)
- Código em produção antes: commit `ef43cb68cb4ec1953229948e26b731abe100555c` (branch `restore/antes-frostivus`).
- Deploy Netlify anterior: `6b01e3812052471d148d1e8b`
  (https://6b01e3812052471d148d1e8b--lumenex.netlify.app).
- **Estado: ainda NÃO publicada.** Em 27/11/2026 o Netlify recusou o deploy `6b08f6fcc205ee7ce80203d8` com
"Skipped due to account credit usage exceeded". A produção continua no commit `ef43cb6`.

Para publicar quando houver créditos: deploy do código desta branch (`feat/recuperacao-senha-frostivus`) no
site `lumenex`. Mesclar em `etapa-2-grupo-voz` também gera um novo `.exe`, que os aplicativos de Windows
instalados baixam sozinhos; é uma decisão separada. Depois de publicar sem mesclar, um novo deploy a partir
de `etapa-2-grupo-voz` substitui o site pela versão antiga.
