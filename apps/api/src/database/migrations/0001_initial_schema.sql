CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (
    email = lower(btrim(email))
    AND char_length(email) BETWEEN 3 AND 320
    AND position('@' IN email) > 1
  ),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_password_hash_not_empty CHECK (char_length(password_hash) > 0),
  CONSTRAINT users_timestamps_ordered CHECK (updated_at >= created_at)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sessions_refresh_token_hash_unique UNIQUE (refresh_token_hash),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT sessions_revocation_after_creation CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  ),
  CONSTRAINT sessions_last_used_after_creation CHECK (last_used_at >= created_at)
);

CREATE INDEX sessions_user_active_idx
  ON sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_key TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'NSE',
  trading_symbol TEXT NOT NULL,
  display_name TEXT NOT NULL,
  isin TEXT NOT NULL,
  tick_size_paise BIGINT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  managed_by_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT instruments_instrument_key_unique UNIQUE (instrument_key),
  CONSTRAINT instruments_exchange_symbol_unique UNIQUE (exchange, trading_symbol),
  CONSTRAINT instruments_isin_unique UNIQUE (isin),
  CONSTRAINT instruments_nse_cash_only CHECK (exchange = 'NSE'),
  CONSTRAINT instruments_key_matches_isin CHECK (instrument_key = 'NSE_EQ|' || isin),
  CONSTRAINT instruments_symbol_format CHECK (trading_symbol ~ '^[A-Z0-9&-]+$'),
  CONSTRAINT instruments_name_not_empty CHECK (char_length(btrim(display_name)) > 0),
  CONSTRAINT instruments_isin_format CHECK (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  CONSTRAINT instruments_tick_size_positive CHECK (tick_size_paise > 0),
  CONSTRAINT instruments_timestamps_ordered CHECK (updated_at >= created_at)
);

CREATE INDEX instruments_enabled_symbol_idx
  ON instruments (enabled, trading_symbol);

CREATE TABLE watchlist_items (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument_id UUID NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, instrument_id)
);

CREATE TABLE wallets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  available_cash_paise BIGINT NOT NULL,
  reserved_cash_paise BIGINT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallets_available_cash_nonnegative CHECK (available_cash_paise >= 0),
  CONSTRAINT wallets_reserved_cash_nonnegative CHECK (reserved_cash_paise >= 0),
  CONSTRAINT wallets_version_nonnegative CHECK (version >= 0),
  CONSTRAINT wallets_timestamps_ordered CHECK (updated_at >= created_at)
);

CREATE TABLE wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES wallets(user_id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL,
  available_cash_delta_paise BIGINT NOT NULL,
  reserved_cash_delta_paise BIGINT NOT NULL,
  available_cash_after_paise BIGINT NOT NULL,
  reserved_cash_after_paise BIGINT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallet_ledger_entry_type_valid CHECK (
    entry_type IN (
      'OPENING_CREDIT',
      'BUY_RESERVATION',
      'BUY_RESERVATION_RELEASE',
      'TRADE_DEBIT',
      'TRADE_CREDIT',
      'ADJUSTMENT'
    )
  ),
  CONSTRAINT wallet_ledger_has_mutation CHECK (
    available_cash_delta_paise <> 0 OR reserved_cash_delta_paise <> 0
  ),
  CONSTRAINT wallet_ledger_available_after_nonnegative CHECK (
    available_cash_after_paise >= 0
  ),
  CONSTRAINT wallet_ledger_reserved_after_nonnegative CHECK (
    reserved_cash_after_paise >= 0
  ),
  CONSTRAINT wallet_ledger_reference_type_not_empty CHECK (
    char_length(btrim(reference_type)) > 0
  ),
  CONSTRAINT wallet_ledger_idempotency_key_not_empty CHECK (
    char_length(btrim(idempotency_key)) > 0
  ),
  CONSTRAINT wallet_ledger_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX wallet_ledger_user_created_idx
  ON wallet_ledger (user_id, created_at DESC, id DESC);

CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  instrument_id UUID NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
  quantity BIGINT NOT NULL DEFAULT 0,
  reserved_quantity BIGINT NOT NULL DEFAULT 0,
  average_cost_paise BIGINT NOT NULL DEFAULT 0,
  realized_pnl_paise BIGINT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT positions_user_instrument_unique UNIQUE (user_id, instrument_id),
  CONSTRAINT positions_quantity_nonnegative CHECK (quantity >= 0),
  CONSTRAINT positions_reserved_quantity_valid CHECK (
    reserved_quantity >= 0 AND reserved_quantity <= quantity
  ),
  CONSTRAINT positions_average_cost_valid CHECK (
    (quantity = 0 AND average_cost_paise = 0)
    OR (quantity > 0 AND average_cost_paise > 0)
  ),
  CONSTRAINT positions_version_nonnegative CHECK (version >= 0),
  CONSTRAINT positions_timestamps_ordered CHECK (updated_at >= created_at)
);

CREATE INDEX positions_user_idx ON positions (user_id, instrument_id);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_order_id UUID,
  engine_sequence BIGINT,
  user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  instrument_id UUID NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
  participant_type TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  limit_price_paise BIGINT,
  quantity BIGINT NOT NULL,
  filled_quantity BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  rejection_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT orders_user_client_order_unique UNIQUE (user_id, client_order_id),
  CONSTRAINT orders_engine_sequence_unique UNIQUE (engine_sequence),
  CONSTRAINT orders_engine_sequence_positive CHECK (
    engine_sequence IS NULL OR engine_sequence > 0
  ),
  CONSTRAINT orders_participant_type_valid CHECK (participant_type IN ('USER', 'SYSTEM')),
  CONSTRAINT orders_participant_identity_valid CHECK (
    (participant_type = 'USER' AND user_id IS NOT NULL AND client_order_id IS NOT NULL)
    OR (participant_type = 'SYSTEM' AND user_id IS NULL AND client_order_id IS NULL)
  ),
  CONSTRAINT orders_side_valid CHECK (side IN ('BUY', 'SELL')),
  CONSTRAINT orders_order_type_valid CHECK (order_type IN ('MARKET', 'LIMIT')),
  CONSTRAINT orders_limit_price_valid CHECK (
    (order_type = 'LIMIT' AND limit_price_paise IS NOT NULL AND limit_price_paise > 0)
    OR (order_type = 'MARKET' AND limit_price_paise IS NULL)
  ),
  CONSTRAINT orders_quantity_positive CHECK (quantity > 0),
  CONSTRAINT orders_filled_quantity_valid CHECK (
    filled_quantity >= 0 AND filled_quantity <= quantity
  ),
  CONSTRAINT orders_status_valid CHECK (
    status IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED')
  ),
  CONSTRAINT orders_status_quantity_consistent CHECK (
    (status IN ('PENDING', 'OPEN', 'REJECTED') AND filled_quantity = 0)
    OR (status = 'PARTIALLY_FILLED' AND filled_quantity > 0 AND filled_quantity < quantity)
    OR (status = 'FILLED' AND filled_quantity = quantity)
    OR (status = 'CANCELLED' AND filled_quantity < quantity)
  ),
  CONSTRAINT orders_matcher_status_has_sequence CHECK (
    status IN ('PENDING', 'REJECTED') OR engine_sequence IS NOT NULL
  ),
  CONSTRAINT orders_rejection_code_consistent CHECK (
    (status = 'REJECTED' AND rejection_code IS NOT NULL AND char_length(rejection_code) > 0)
    OR (status <> 'REJECTED' AND rejection_code IS NULL)
  ),
  CONSTRAINT orders_cancelled_at_consistent CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
    OR (status <> 'CANCELLED' AND cancelled_at IS NULL)
  ),
  CONSTRAINT orders_timestamps_ordered CHECK (
    updated_at >= created_at
    AND (cancelled_at IS NULL OR cancelled_at >= created_at)
  )
);

CREATE INDEX orders_user_status_created_idx
  ON orders (user_id, status, created_at DESC, id DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX orders_book_recovery_idx
  ON orders (instrument_id, status, engine_sequence)
  WHERE order_type = 'LIMIT' AND status IN ('OPEN', 'PARTIALLY_FILLED');

CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
  buy_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  sell_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  maker_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  taker_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  quantity BIGINT NOT NULL,
  price_paise BIGINT NOT NULL,
  engine_sequence BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trades_engine_sequence_unique UNIQUE (engine_sequence),
  CONSTRAINT trades_distinct_sides CHECK (buy_order_id <> sell_order_id),
  CONSTRAINT trades_distinct_roles CHECK (maker_order_id <> taker_order_id),
  CONSTRAINT trades_roles_are_orders CHECK (
    (maker_order_id = buy_order_id AND taker_order_id = sell_order_id)
    OR (maker_order_id = sell_order_id AND taker_order_id = buy_order_id)
  ),
  CONSTRAINT trades_quantity_positive CHECK (quantity > 0),
  CONSTRAINT trades_price_positive CHECK (price_paise > 0),
  CONSTRAINT trades_engine_sequence_positive CHECK (engine_sequence > 0)
);

CREATE INDEX trades_buy_order_created_idx
  ON trades (buy_order_id, created_at DESC, id DESC);

CREATE INDEX trades_sell_order_created_idx
  ON trades (sell_order_id, created_at DESC, id DESC);

CREATE TABLE paper_account_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE,
  starting_cash_paise BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT paper_account_config_single_row CHECK (singleton),
  CONSTRAINT paper_account_config_starting_cash_positive CHECK (starting_cash_paise > 0)
);

