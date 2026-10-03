import Stripe from "stripe"
import { ObjectId } from "mongodb"

export const priceId = () => process.env.STRIPE_PRICE_ID || "price_1ULz3MCaR1yXlvXbgF6eAhcr"
export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.")
  return new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 10000, maxNetworkRetries: 1 })
}
const userFilter = id => ({ _id: { $in: /^[a-f\d]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id] } })
export function billingError(message, status = 400) {
  const error = new Error(message); error.status = status; return error
}
export function validateCheckout(session, userId) {
  if (!session.client_reference_id) throw billingError("This older checkout is not linked to an account. Contact the site administrator to match your payment; do not pay again.", 409)
  if (session.client_reference_id !== String(userId)) throw billingError("This checkout belongs to another account.", 403)
  if (session.mode !== "subscription" || session.status !== "complete" || !["paid", "no_payment_required"].includes(session.payment_status)) throw billingError("Payment has not completed. Please check again shortly.", 409)
  if (!session.subscription) throw billingError("No subscription was found for this checkout.", 409)
}
export async function activateCheckout(db, stripe, sessionId, userId) {
  const checkout = await stripe.checkout.sessions.retrieve(sessionId)
  validateCheckout(checkout, userId)
  const subscriptionId = typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription.id
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  if (subscription.metadata?.userId !== String(userId)) throw billingError("Subscription account verification failed.", 403)
  if (!["active", "trialing"].includes(subscription.status)) throw billingError("This subscription is not active.", 409)
  if (!subscription.items.data.some(item => item.price.id === priceId())) throw billingError("This subscription does not include the Premium plan.", 403)
  const result = await db.collection("user").updateOne(userFilter(String(userId)), { $set: {
    isPremium: true, stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id, stripeSubscriptionStatus: subscription.status, updatedAt: new Date(),
  } })
  if (!result.matchedCount) throw billingError("Account not found.", 404)
  return { isPremium: true }
}
export async function syncSubscription(db, stripe, subscriptionId) {
  // Retrieve current state rather than applying a possibly delayed event snapshot.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const userId = subscription.metadata?.userId
  if (!userId || !subscription.items.data.some(item => item.price.id === priceId())) return
  const isPremium = ["active", "trialing"].includes(subscription.status)
  // Lifecycle events only change the subscription already linked by verified checkout.
  await db.collection("user").updateOne({ ...userFilter(userId), stripeSubscriptionId: subscription.id }, { $set: {
    isPremium, stripeSubscriptionStatus: subscription.status, updatedAt: new Date(),
  } })
}
