# Sistema de Ponto

Aplicacao Next.js preparada para Vercel + Supabase.

## Rodar localmente

1. Instale as dependencias:

```bash
npm.cmd install
```

2. Crie um projeto gratuito no Supabase.

3. Rode o SQL em `supabase/schema.sql` no SQL Editor do Supabase.

4. Copie `.env.example` para `.env.local` e preencha:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

5. Crie o primeiro usuario administrador no Supabase Auth.

6. Depois que o usuario existir, rode:

```sql
update public.profiles
set role = 'admin'
where email = 'email-do-admin@empresa.com';
```

7. Rode o app:

```bash
npm.cmd run dev
```

## Publicar na Vercel

Configure as mesmas variaveis de ambiente na Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

O funcionario registra apenas o proprio ponto. O administrador cadastra usuarios, edita registros, imprime folhas mensais e fecha o mes.

Ao fechar o mes, o sistema salva um snapshot em `month_closings` e remove os registros ativos de `time_records`.
