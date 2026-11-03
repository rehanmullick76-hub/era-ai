import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const creditOrdersTable = pgTable("credit_orders", {
  orderId: text("order_id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  packageId: text("package_id").notNull(),
  creditAmount: integer("credit_amount").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  paymentId: text("payment_id").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  creditedAt: timestamp("credited_at"),
});
