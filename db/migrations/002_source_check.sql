-- processed_events.source holds what lead-intake's "Record request" writes: the literal
-- 'wordpress-lead'. No other workflow, script, or stack test writes a different value.
-- Guarded on pg_constraint, so a second run adds nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'processed_events'::regclass AND conname = 'processed_events_source_check'
  ) THEN
    ALTER TABLE processed_events ADD CONSTRAINT processed_events_source_check CHECK (source IN ('wordpress-lead'));
  END IF;
END
$$;
