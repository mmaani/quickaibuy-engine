UPDATE products_raw
SET supplier_key = lower(trim(supplier_key))
WHERE supplier_key IS NOT NULL
  AND supplier_key <> lower(trim(supplier_key));
