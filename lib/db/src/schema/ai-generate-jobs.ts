import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export type AiGenerateJobStatus = "queued" | "running" | "succeeded" | "failed";
export type AiGenerateJobStage = "queued" | "design" | "code" | "repair" | "fallback";

export interface AiGenerateJobPayload {
  prompt: string;
  projectId: string;
  mode?: "frontend" | "fullstack";
  files: { path: string; content: string; language: string }[];
  history: { role: "user" | "assistant"; content: string }[];
}

export interface AiGenerateJobResult {
  message: string;
  files: {
    path: string;
    content?: string;
    language?: string;
    action: "create" | "update" | "delete";
  }[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  creditsCharged: number;
  searchStatus?: "not_used" | "used" | "unavailable";
  sources?: { title: string; url: string }[];
}

export const aiGenerateJobsTable = pgTable("ai_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").$type<AiGenerateJobStatus>().notNull().default("queued"),
  generationStage: text("generation_stage").$type<AiGenerateJobStage>().notNull().default("queued"),
  generationModel: text("generation_model"),
  payload: jsonb("payload").$type<AiGenerateJobPayload>().notNull(),
  result: jsonb("result").$type<AiGenerateJobResult>(),
  error: text("error"),
  errorStatus: integer("error_status"),
  creditsRemaining: integer("credits_remaining").notNull(),
  reservedCredits: integer("reserved_credits").notNull().default(5),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiGenerateJobSchema = createInsertSchema(aiGenerateJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiGenerateJob = z.infer<typeof insertAiGenerateJobSchema>;
export type AiGenerateJob = typeof aiGenerateJobsTable.$inferSelect;
