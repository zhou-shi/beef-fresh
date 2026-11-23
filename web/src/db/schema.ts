import { boolean, index, integer, jsonb, pgTable, real, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Payload perintah yang dikirim website -> ESP32 */
export interface CommandPayload {
  label?: string;
  split?: string;
  scaling?: string;
  k?: number;
  repeat?: number;
  /** khusus mode simulasi: kelas sebenarnya dari sampel virtual */
  truth?: string;
  force?: boolean;
}

/** Daftar grup dataset (mendukung New Dataset dinamis & Archive Dataset) */
export const datasets = pgTable("datasets", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  targetTrain: integer("target_train").notNull().default(144),
  targetTest: integer("target_test").notNull().default(36),
  status: varchar("status", { length: 16 }).notNull().default("active"), // active | archived
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Dataset: data latih + data uji per dataset */
export const samples = pgTable(
  "samples",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id"),
    split: varchar("split", { length: 8 }).notNull(), // train | test
    label: varchar("label", { length: 24 }).notNull(), // segar | mulai_membusuk | busuk
    r: real("r").notNull(),
    g: real("g").notNull(),
    b: real("b").notNull(),
    rawR: integer("raw_r"),
    rawG: integer("raw_g"),
    rawB: integer("raw_b"),
    rawC: integer("raw_c"),
    lux: real("lux"),
    colorTemp: real("color_temp"),
    source: varchar("source", { length: 16 }).notNull().default("device"), // device | manual | simulasi
    deviceId: varchar("device_id", { length: 64 }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("samples_split_label_idx").on(t.split, t.label)],
);

/** Antrean perintah dari website ke ESP32 (tombol alat dipindah ke website) */
export const deviceCommands = pgTable(
  "device_commands",
  {
    id: serial("id").primaryKey(),
    deviceId: varchar("device_id", { length: 64 }).notNull(),
    type: varchar("type", { length: 16 }).notNull(), // capture | classify | benchmark | ping | sync
    payload: jsonb("payload").$type<CommandPayload>().notNull().default({}),
    status: varchar("status", { length: 12 }).notNull().default("pending"), // pending | running | done | failed | expired | cancelled
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    simulated: boolean("simulated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    pickedAt: timestamp("picked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("device_commands_status_idx").on(t.status, t.id)],
);

/** Hasil klasifikasi KNN yang dijalankan di ESP32 */
export const classifications = pgTable("classifications", {
  id: serial("id").primaryKey(),
  commandId: integer("command_id"),
  deviceId: varchar("device_id", { length: 64 }),
  r: real("r").notNull(),
  g: real("g").notNull(),
  b: real("b").notNull(),
  rNorm: real("r_norm"),
  gNorm: real("g_norm"),
  bNorm: real("b_norm"),
  rawR: integer("raw_r"),
  rawG: integer("raw_g"),
  rawB: integer("raw_b"),
  rawC: integer("raw_c"),
  scaling: varchar("scaling", { length: 12 }).notNull(),
  k: integer("k").notNull(),
  predicted: varchar("predicted", { length: 24 }).notNull(),
  votes: jsonb("votes").$type<number[]>(),
  confidence: real("confidence"),
  nearest: real("nearest"),
  execUs: real("exec_us"),
  scaleUs: real("scale_us"),
  knnUs: real("knn_us"),
  memBytes: integer("mem_bytes"),
  modelBytes: integer("model_bytes"),
  freeHeap: integer("free_heap"),
  trainCount: integer("train_count"),
  actual: varchar("actual", { length: 24 }),
  source: varchar("source", { length: 16 }).notNull().default("device"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Benchmark performa KNN di ESP32 (waktu eksekusi & memori) per metode scaling */
export const benchmarks = pgTable("benchmarks", {
  id: serial("id").primaryKey(),
  commandId: integer("command_id"),
  deviceId: varchar("device_id", { length: 64 }),
  scaling: varchar("scaling", { length: 12 }).notNull(),
  k: integer("k").notNull(),
  repeat: integer("repeat").notNull().default(1),
  samples: integer("samples").notNull(),
  correct: integer("correct").notNull(),
  accuracy: real("accuracy").notNull(),
  avgUs: real("avg_us").notNull(),
  minUs: real("min_us"),
  maxUs: real("max_us"),
  scaleUs: real("scale_us"),
  knnUs: real("knn_us"),
  memBytes: integer("mem_bytes"),
  modelBytes: integer("model_bytes"),
  freeHeap: integer("free_heap"),
  cpuMhz: integer("cpu_mhz"),
  trainCount: integer("train_count"),
  source: varchar("source", { length: 16 }).notNull().default("device"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Heartbeat perangkat ESP32 */
export const devices = pgTable("devices", {
  id: varchar("id", { length: 64 }).primaryKey(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  ip: varchar("ip", { length: 64 }),
  rssi: integer("rssi"),
  freeHeap: integer("free_heap"),
  firmware: varchar("firmware", { length: 32 }),
  modelVersion: integer("model_version"),
  trainCount: integer("train_count"),
  sensorOk: boolean("sensor_ok"),
  oledOk: boolean("oled_ok"),
  uptimeS: integer("uptime_s"),
});

export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
});

export type DatasetRecord = typeof datasets.$inferSelect;
export type Sample = typeof samples.$inferSelect;
export type NewSample = typeof samples.$inferInsert;
export type DeviceCommand = typeof deviceCommands.$inferSelect;
export type Classification = typeof classifications.$inferSelect;
export type Benchmark = typeof benchmarks.$inferSelect;
export type Device = typeof devices.$inferSelect;
