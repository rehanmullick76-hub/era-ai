import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import Razorpay from "razorpay";
import { and, eq } from "drizzle-orm";
import { db, creditOrdersTable } from "@workspace/db";
import { authMiddleware } from "../middlewares/auth";
import { addCreditsForUser, ensureUser, getCredits } from "../lib/credits";
import { getCreditPackage } from "../lib/credit-packages";
import { verifyPaymentSignature } from "../lib/payment-signature";

const router: IRouter = Router();
function razorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Payments are not configured.");
  return { client: new Razorpay({ key_id: keyId, key_secret: keySecret }), keyId, keySecret };
}

router.post("/credits/create-order", authMiddleware, async (req, res): Promise<void> => {
  const pack = getCreditPackage(req.body?.packageId);
  if (!pack) {
    res.status(400).json({ error: "Unknown credit package." });
    return;
  }
  const userId = (req as any).userId as string;
  try {
    await ensureUser(userId);
    const { client, keyId } = razorpayClient();
    // Razorpay receipts have a 40-character limit; a UUID user ID would exceed it.
    const order = await client.orders.create({
      amount: pack.amount, currency: "INR", receipt: `credits_${randomUUID().slice(0, 28)}`,
      notes: { userId, packageId: req.body.packageId, creditAmount: String(pack.credits) },
    });
    await db.insert(creditOrdersTable).values({
      orderId: order.id, userId, packageId: req.body.packageId,
      creditAmount: pack.credits, amount: pack.amount, currency: "INR",
    });
    res.json({ orderId: order.id, amount: Number(order.amount), keyId });
  } catch {
    // SDK errors can contain request credentials: never serialize or log them.
    res.status(502).json({ error: "Could not create the payment order. Please try again." });
  }
});

router.post("/credits/verify-payment", authMiddleware, async (req, res): Promise<void> => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body ?? {};
  if (typeof orderId !== "string" || !/^order_[a-zA-Z0-9]+$/.test(orderId) ||
      typeof paymentId !== "string" || !/^pay_[a-zA-Z0-9]+$/.test(paymentId) || typeof signature !== "string") {
    res.status(400).json({ verified: false, error: "Invalid payment details." });
    return;
  }
  const userId = (req as any).userId as string;
  try {
    const { client, keySecret } = razorpayClient();
    const [stored] = await db.select().from(creditOrdersTable)
      .where(and(eq(creditOrdersTable.orderId, orderId), eq(creditOrdersTable.userId, userId)));
    if (!stored || !verifyPaymentSignature(stored.orderId, paymentId, signature, keySecret)) {
      res.status(400).json({ verified: false, error: "Invalid signature or order." });
      return;
    }
    if (stored.creditedAt) {
      if (stored.paymentId !== paymentId) {
        res.status(400).json({ verified: false, error: "Order already paid with another payment." });
        return;
      }
      res.json({ verified: true, credits: await getCredits(userId) });
      return;
    }
    const [order, fetchedPayment] = await Promise.all([client.orders.fetch(orderId), client.payments.fetch(paymentId)]);
    const notes = order.notes;
    if (notes?.userId !== userId || notes?.packageId !== stored.packageId ||
        Number(notes?.creditAmount) !== stored.creditAmount || Number(order.amount) !== stored.amount ||
        order.currency !== stored.currency || fetchedPayment.order_id !== orderId ||
        Number(fetchedPayment.amount) !== stored.amount || fetchedPayment.currency !== stored.currency) {
      res.status(400).json({ verified: false, error: "Payment does not match this credit order." });
      return;
    }
    // Capture authorized payments if automatic capture has not already done so.
    const payment = fetchedPayment.status === "authorized"
      ? await client.payments.capture(paymentId, stored.amount, stored.currency)
      : fetchedPayment;
    if (payment.status !== "captured") {
      res.status(409).json({ verified: false, error: "Payment is not captured yet. Retry verification shortly." });
      return;
    }
    const credits = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(creditOrdersTable)
        .where(eq(creditOrdersTable.orderId, orderId)).for("update");
      if (locked.creditedAt) {
        // A simultaneous verification has already fulfilled the order.
        return null;
      }
      const balance = await addCreditsForUser(userId, locked.creditAmount, tx);
      await tx.update(creditOrdersTable).set({ paymentId, creditedAt: new Date() })
        .where(eq(creditOrdersTable.orderId, orderId));
      return balance;
    });
    res.json({ verified: true, credits: credits ?? await getCredits(userId) });
  } catch {
    res.status(502).json({ verified: false, error: "Could not verify payment. Retry verification; do not pay again." });
  }
});

export default router;
