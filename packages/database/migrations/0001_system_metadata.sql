CREATE TABLE IF NOT EXISTS system_metadata (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_metadata (key, value)
VALUES ('schema', '{"version":1}'::jsonb)
ON CONFLICT (key) DO NOTHING;
