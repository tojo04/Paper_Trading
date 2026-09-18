ALTER TABLE orders
  DROP CONSTRAINT orders_matcher_status_has_sequence;

ALTER TABLE orders
  ADD CONSTRAINT orders_matcher_status_has_sequence CHECK (
    status NOT IN ('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED')
    OR engine_sequence IS NOT NULL
  );

