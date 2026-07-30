import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dailySnapshots = sqliteTable("daily_snapshots", {
  tradeDate: text("trade_date").primaryKey(),
  firstCapturedAt: text("first_captured_at").notNull(),
  firstPayload: text("first_payload").notNull(),
  latestCapturedAt: text("latest_captured_at").notNull(),
  latestPayload: text("latest_payload").notNull(),
  sampleCount: integer("sample_count").notNull().default(1),
});

export const signalEvents = sqliteTable("signal_events", {
  eventKey: text("event_key").primaryKey(),
  tradeDate: text("trade_date").notNull(),
  triggeredAt: text("triggered_at").notNull(),
  signalType: text("signal_type").notNull(),
  stockCode: text("stock_code").notNull(),
  stockName: text("stock_name").notNull(),
  sectorName: text("sector_name").notNull(),
  score: integer("score").notNull(),
  summary: text("summary").notNull(),
  payload: text("payload").notNull(),
});
