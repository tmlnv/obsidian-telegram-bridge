alter table public.bot_connections
  add column if not exists bot_token_ciphertext text,
  add column if not exists bot_token_nonce text;
