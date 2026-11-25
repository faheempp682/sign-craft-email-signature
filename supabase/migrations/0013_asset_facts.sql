-- Facts measured when an image is uploaded (GIF frame count, whether frame 1 is complete, flashing rate, dark artwork
-- on transparent logos...), kept with the asset so the compatibility checker can still use them when a saved signature
-- is reopened later. Optional: rows made before this migration simply have none.
--
-- (Numbered 0013 on purpose: 0009 to 0012 are reserved for the team features being built alongside.)

alter table public.assets
  add column facts jsonb
  check (facts is null or (jsonb_typeof(facts) = 'object' and pg_column_size(facts) <= 2048));
