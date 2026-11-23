-- ============================================================================
-- BEEF FRESH - SUPABASE DATABASE SCHEMA
-- Arsitektur Sistem Penelitian: Klasifikasi Kesegaran Daging Sapi (KNN K=3)
-- Dataset: 144 Data Latih (80%) & 36 Data Uji (20%) = 180 Sampel
-- Kelas: Segar (0), Mulai Membusuk (1), Busuk (2)
-- ============================================================================

-- 1. Tabel Dataset Penelitian (144 Data Latih & 36 Data Uji)
CREATE TABLE IF NOT EXISTS public.beef_dataset (
    id BIGSERIAL PRIMARY KEY,
    sample_code TEXT UNIQUE NOT NULL,
    split_type TEXT NOT NULL CHECK (split_type IN ('train', 'test')),
    label TEXT NOT NULL CHECK (label IN ('Segar', 'Mulai Membusuk', 'Busuk')),
    class_id SMALLINT NOT NULL CHECK (class_id IN (0, 1, 2)),
    r_raw DOUBLE PRECISION NOT NULL,
    g_raw DOUBLE PRECISION NOT NULL,
    b_raw DOUBLE PRECISION NOT NULL,
    c_raw DOUBLE PRECISION DEFAULT 0,
    lux DOUBLE PRECISION DEFAULT 0,
    color_temp DOUBLE PRECISION DEFAULT 0,
    r_norm DOUBLE PRECISION NOT NULL,
    g_norm DOUBLE PRECISION NOT NULL,
    b_norm DOUBLE PRECISION NOT NULL,
    source TEXT NOT NULL DEFAULT 'sensor',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabel Riwayat Pengukuran & Klasifikasi Real-Time dari ESP32
CREATE TABLE IF NOT EXISTS public.beef_measurements (
    id BIGSERIAL PRIMARY KEY,
    r_raw DOUBLE PRECISION NOT NULL,
    g_raw DOUBLE PRECISION NOT NULL,
    b_raw DOUBLE PRECISION NOT NULL,
    c_raw DOUBLE PRECISION DEFAULT 0,
    lux DOUBLE PRECISION DEFAULT 0,
    color_temp DOUBLE PRECISION DEFAULT 0,
    r_norm DOUBLE PRECISION NOT NULL,
    g_norm DOUBLE PRECISION NOT NULL,
    b_norm DOUBLE PRECISION NOT NULL,
    predicted_label TEXT NOT NULL,
    predicted_raw_label TEXT NOT NULL,
    k_value SMALLINT NOT NULL DEFAULT 3,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    nearest_neighbors JSONB DEFAULT '[]'::jsonb,
    exec_time_sensor_us DOUBLE PRECISION DEFAULT 0,
    exec_time_scaling_us DOUBLE PRECISION DEFAULT 0,
    exec_time_knn_scaled_us DOUBLE PRECISION DEFAULT 0,
    exec_time_knn_raw_us DOUBLE PRECISION DEFAULT 0,
    exec_time_total_us DOUBLE PRECISION DEFAULT 0,
    mem_dataset_bytes INTEGER DEFAULT 0,
    mem_knn_work_bytes INTEGER DEFAULT 0,
    mem_free_heap_bytes INTEGER DEFAULT 0,
    mem_used_heap_bytes INTEGER DEFAULT 0,
    trigger_source TEXT NOT NULL DEFAULT 'website',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabel Hasil Evaluasi Feature Scaling Min-Max (0-1) vs Tanpa Scaling (KNN K=3)
CREATE TABLE IF NOT EXISTS public.beef_evaluations (
    id BIGSERIAL PRIMARY KEY,
    k_value SMALLINT NOT NULL DEFAULT 3,
    train_count INTEGER NOT NULL DEFAULT 144,
    test_count INTEGER NOT NULL DEFAULT 36,
    acc_without_scaling DOUBLE PRECISION NOT NULL,
    acc_with_minmax DOUBLE PRECISION NOT NULL,
    esp32_exec_scaling_us DOUBLE PRECISION NOT NULL,
    esp32_exec_knn_scaled_us DOUBLE PRECISION NOT NULL,
    esp32_exec_knn_raw_us DOUBLE PRECISION NOT NULL,
    esp32_batch_36_scaled_us DOUBLE PRECISION NOT NULL,
    esp32_batch_36_raw_us DOUBLE PRECISION NOT NULL,
    esp32_mem_dataset_scaled_bytes INTEGER NOT NULL,
    esp32_mem_dataset_raw_bytes INTEGER NOT NULL,
    esp32_mem_knn_stack_bytes INTEGER NOT NULL,
    esp32_free_heap_bytes INTEGER NOT NULL,
    min_max_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    metrics_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabel Antrean Perintah (Trigger dari Website ke ESP32 via Wi-Fi / Bridge)
CREATE TABLE IF NOT EXISTS public.device_commands (
    id BIGSERIAL PRIMARY KEY,
    command TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    payload JSONB DEFAULT '{}'::jsonb,
    result JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Aktifkan Row Level Security (RLS) dengan Policy Akses Publik (Anon Key) untuk Penelitian IoT
ALTER TABLE public.beef_dataset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beef_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beef_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon full access on beef_dataset" ON public.beef_dataset;
CREATE POLICY "Allow anon full access on beef_dataset" ON public.beef_dataset FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon full access on beef_measurements" ON public.beef_measurements;
CREATE POLICY "Allow anon full access on beef_measurements" ON public.beef_measurements FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon full access on beef_evaluations" ON public.beef_evaluations;
CREATE POLICY "Allow anon full access on beef_evaluations" ON public.beef_evaluations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon full access on device_commands" ON public.device_commands;
CREATE POLICY "Allow anon full access on device_commands" ON public.device_commands FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON public.beef_dataset TO anon, authenticated, service_role;
GRANT ALL ON public.beef_measurements TO anon, authenticated, service_role;
GRANT ALL ON public.beef_evaluations TO anon, authenticated, service_role;
GRANT ALL ON public.device_commands TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
