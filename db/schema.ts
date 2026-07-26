import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const signalObservations = sqliteTable("signal_observations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  observedAt: text("observed_at").notNull(),
  observedBucket: text("observed_bucket").notNull(),
  captureWindow: text("capture_window").notNull(),
  sessionDate: text("session_date").notNull(),
  sourceMode: text("source_mode").notNull(),
  boardId: text("board_id").notNull(),
  themeName: text("theme_name").notNull(),
  phase: text("phase").notNull(),
  score: integer("score").notNull(),
  leaderOneCode: text("leader_one_code"),
  leaderOneName: text("leader_one_name"),
  leaderOneChange: integer("leader_one_change_bps"),
  leaderTwoCode: text("leader_two_code"),
  leaderTwoName: text("leader_two_name"),
  leaderTwoChange: integer("leader_two_change_bps"),
  payload: text("payload").notNull(),
}, (table) => [
  uniqueIndex("signal_observation_bucket_board_uq").on(table.observedBucket, table.boardId),
  index("signal_observation_time_idx").on(table.observedAt),
  index("signal_observation_board_idx").on(table.boardId, table.observedAt),
]);
