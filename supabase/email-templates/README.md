# Configuração de produção do LUMENEX

Projeto: `jdipignyikikagjvynve`. Em Authentication → URL Configuration:

- Site URL: `https://lumenex.netlify.app`
- Redirect URLs exatas: `https://lumenex.netlify.app/reset-password`, `https://lumenex.netlify.app/confirm-email` e `https://lumenex.netlify.app/`.
- Acrescentar os callbacks do Google existentes, se houver; preservar as demais entradas válidas até verificar os consumidores.
- Remover `http://localhost:3000` e curingas de localhost apenas da configuração de produção, após confirmar que não são usados por outro cliente.

Em Authentication → Email Templates, instalar `recovery.html` em Reset Password e `confirmation.html` em Confirm Signup. Não usar o link direto `{{ .ConfirmationURL }}`: verificadores automáticos de e-mail podem consumi-lo antes da pessoa. Os templates direcionam para páginas próprias e só validam o `token_hash` após o clique em Continuar. Desativar reescrita de links e click tracking no provedor de e-mail, se houver.

Os templates não são publicados pelo deploy do Netlify: precisam ser atualizados no projeto Supabase. Depois, solicitar um link novo e verificar os e-mails reais antes de considerar a correção concluída. Não reutilizar links antigos.
