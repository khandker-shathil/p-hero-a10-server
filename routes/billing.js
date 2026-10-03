import { Router } from "express"
import { fromNodeHeaders } from "better-auth/node"
import { auth } from "../lib/auth.js"
import { getDatabase } from "../lib/db.js"
import { activateCheckout, stripeClient, syncSubscription } from "../lib/billing-service.js"

export const billing = Router()
billing.post("/activate", async (req, res) => {
  res.set("Cache-Control", "private, no-store").vary("Cookie")
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } })
  if (!session) return res.status(401).json({ error: "Please log in to activate your subscription." })
  const id = req.body?.sessionId
  if (typeof id !== "string" || id.length > 255 || !/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(id)) return res.status(400).json({ error: "Invalid checkout session." })
  try {
    const result = await activateCheckout(await getDatabase(), stripeClient(), id, session.user.id)
    res.json(result)
  } catch (error) {
    res.status(error.status || 502).json({ error: error.status ? error.message : "Couldn’t verify your subscription. Please try again." })
  }
})

export async function stripeWebhook(req, res) {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: "Stripe webhooks are not configured." })
  const stripe = stripeClient()
  let event
  try { event = stripe.webhooks.constructEvent(req.body, req.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET) }
  catch { return res.status(400).json({ error: "Invalid Stripe signature." }) }
  try {
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      const checkout = event.data.object
      if (checkout.mode === "subscription" && checkout.client_reference_id && ["paid", "no_payment_required"].includes(checkout.payment_status)) {
        try { await activateCheckout(await getDatabase(), stripe, checkout.id, checkout.client_reference_id) }
        catch (error) { if (![403, 404, 409].includes(error.status)) throw error }
      }
    } else if (["customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      await syncSubscription(await getDatabase(), stripe, event.data.object.id)
    }
    res.json({ received: true })
  } catch {
    // A non-2xx response asks Stripe to retry temporary failures.
    res.status(503).json({ error: "Couldn’t synchronize the subscription. Please retry." })
  }
}
