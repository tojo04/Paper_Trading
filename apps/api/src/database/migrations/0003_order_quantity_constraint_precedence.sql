ALTER TABLE orders
  DROP CONSTRAINT orders_status_quantity_consistent;

ALTER TABLE orders
  ADD CONSTRAINT orders_status_quantity_consistent CHECK (
    status NOT IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED')
    OR (status IN ('PENDING', 'OPEN', 'REJECTED') AND filled_quantity = 0)
    OR (status = 'PARTIALLY_FILLED' AND filled_quantity > 0 AND filled_quantity < quantity)
    OR (status = 'FILLED' AND filled_quantity = quantity)
    OR (status = 'CANCELLED' AND filled_quantity < quantity)
  );

