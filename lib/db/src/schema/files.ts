import { pgTable, text, serial, uuid, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const filesTable = pgTable("project_files", {
  id: serial("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
  language: text("language").notNull().default("html"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("project_files_project_path_unique").on(table.path, table.projectId),
]);

export const insertFileSchema = createInsertSchema(filesTable).omit({ id: true, updatedAt: true });
export type InsertFile = z.infer<typeof insertFileSchema>;
export type ProjectFile = typeof filesTable.$inferSelect;
