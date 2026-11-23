-- ============================================================================
-- BEEF FRESH - SUPABASE WEB SCHEMA (REST API / PostgREST)
-- Jalankan SQL ini di Supabase SQL Editor untuk mengaktifkan penyimpanan cloud
-- untuk dataset eksperimen, riwayat klasifikasi, benchmark, dan antrean ESP32.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.datasets (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  target_train INTEGER NOT NULL DEFAULT 144,
  target_test INTEGER NOT NULL DEFAULT 36,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.samples (
  id BIGSERIAL PRIMARY KEY,
  dataset_id BIGINT REFERENCES public.datasets(id) ON DELETE SET NULL,
  split VARCHAR(8) NOT NULL CHECK (split IN ('train', 'test')),
  label VARCHAR(24) NOT NULL CHECK (label IN ('segar', 'mulai_membusuk', 'busuk')),
  r REAL NOT NULL,
  g REAL NOT NULL,
  b REAL NOT NULL,
  raw_r INTEGER,
  raw_g INTEGER,
  raw_b INTEGER,
  raw_c INTEGER,
  lux REAL,
  color_temp REAL,
  source VARCHAR(16) NOT NULL DEFAULT 'device',
  device_id VARCHAR(64),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS samples_split_label_idx ON public.samples (split, label);

CREATE TABLE IF NOT EXISTS public.device_commands (
  id BIGSERIAL PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL,
  type VARCHAR(16) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(12) NOT NULL DEFAULT 'pending',
  result JSONB,
  error TEXT,
  simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  picked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS device_commands_status_idx ON public.device_commands (status, id);

CREATE TABLE IF NOT EXISTS public.classifications (
  id BIGSERIAL PRIMARY KEY,
  command_id INTEGER,
  device_id VARCHAR(64),
  r REAL NOT NULL,
  g REAL NOT NULL,
  b REAL NOT NULL,
  r_norm REAL,
  g_norm REAL,
  b_norm REAL,
  raw_r INTEGER,
  raw_g INTEGER,
  raw_b INTEGER,
  raw_c INTEGER,
  scaling VARCHAR(12) NOT NULL,
  k INTEGER NOT NULL,
  predicted VARCHAR(24) NOT NULL,
  votes JSONB,
  confidence REAL,
  nearest REAL,
  exec_us REAL,
  scale_us REAL,
  knn_us REAL,
  mem_bytes INTEGER,
  model_bytes INTEGER,
  free_heap INTEGER,
  train_count INTEGER,
  actual VARCHAR(24),
  source VARCHAR(16) NOT NULL DEFAULT 'device',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.benchmarks (
  id BIGSERIAL PRIMARY KEY,
  command_id INTEGER,
  device_id VARCHAR(64),
  scaling VARCHAR(12) NOT NULL,
  k INTEGER NOT NULL,
  repeat INTEGER NOT NULL DEFAULT 1,
  samples INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  avg_us REAL NOT NULL,
  min_us REAL,
  max_us REAL,
  scale_us REAL,
  knn_us REAL,
  mem_bytes INTEGER,
  model_bytes INTEGER,
  free_heap INTEGER,
  cpu_mhz INTEGER,
  train_count INTEGER,
  source VARCHAR(16) NOT NULL DEFAULT 'device',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.devices (
  id VARCHAR(64) PRIMARY KEY,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip VARCHAR(64),
  rssi INTEGER,
  free_heap INTEGER,
  firmware VARCHAR(32),
  model_version INTEGER,
  train_count INTEGER,
  sensor_ok BOOLEAN,
  oled_ok BOOLEAN,
  uptime_s INTEGER
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL
);

-- RLS & izin akses anon untuk perangkat IoT dan dashboard lokal
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['datasets', 'samples', 'device_commands', 'classifications', 'benchmarks', 'devices', 'app_settings']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow anon full access on %I" ON public.%I', tbl, tbl);
    EXECUTE format('CREATE POLICY "Allow anon full access on %I" ON public.%I FOR ALL USING (true) WITH CHECK (true)', tbl, tbl);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated, service_role', tbl);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
