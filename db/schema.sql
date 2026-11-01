CREATE TABLE processed_events (
  source      text NOT NULL,
  event_id    text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, event_id)
);
