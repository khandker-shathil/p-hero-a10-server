import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import Stripe from "stripe"
import { activateCheckout, priceId, syncSubscription, validateCheckout } from "../lib/billing-service.js"
import { app } from "../app.js"
import { auth } from "../lib/auth.js"

const checkout = { id: "cs_test_paid", mode: "subscription", status: "complete", payment_status: "paid", client_reference_id: "reader", subscription: "sub_1" }
const active = () => ({ id: "sub_1", customer: "cus_1", metadata: { userId: "reader" }, status: "active", items: { data: [{ price: { id: priceId() } }] } })

test("only owned, completed subscription checkouts may activate", () => {
  assert.doesNotThrow(() => validateCheckout(checkout, "reader"))
  for (const changed of [{ client_reference_id: "someone-else" }, { client_reference_id: null }, { status: "open" }, { payment_status: "unpaid" }, { mode: "payment" }, { subscription: null }]) {
    assert.throws(() => validateCheckout({ ...checkout, ...changed }, "reader"))
  }
})
test("activation verifies live subscription and safely repeats the same user update", async () => {
  const writes = []
  const db = { collection: name => ({ updateOne: async (...args) => { assert.equal(name, "user"); writes.push(args); return { matchedCount: 1 } } }) }
  let subscription = active()
  const stripe = { checkout: { sessions: { retrieve: async () => checkout } }, subscriptions: { retrieve: async () => subscription } }
  for (const changes of [{ status: "canceled" }, { metadata: { userId: "other" } }, { items: { data: [{ price: { id: "wrong_price" } }] } }]) {
    subscription = { ...active(), ...changes }
    await assert.rejects(activateCheckout(db, stripe, checkout.id, "reader"))
  }
  assert.equal(writes.length, 0)
  subscription = active()
  for (let i = 0; i < 2; i++) assert.deepEqual(await activateCheckout(db, stripe, checkout.id, "reader"), { isPremium: true })
  assert.deepEqual(writes[0][0], { _id: { $in: ["reader"] } })
  assert.equal(writes[0][1].$set.isPremium, true)
  assert.equal(writes[0][1].$set.stripeSubscriptionId, "sub_1")
  assert.equal(writes[0][1].$set.stripeCustomerId, "cus_1")
  assert.ok(!("role" in writes[0][1].$set))
})
test("subscription lifecycle updates are scoped to the linked subscription", async () => {
  const writes = []
  const db = { collection: () => ({ updateOne: async (...args) => { writes.push(args) } }) }
  let subscription = { ...active(), status: "canceled" }
  const stripe = { subscriptions: { retrieve: async () => subscription } }
  await syncSubscription(db, stripe, "sub_1")
  assert.equal(writes[0][0].stripeSubscriptionId, "sub_1")
  assert.equal(writes[0][1].$set.isPremium, false)
  subscription = { ...active(), cancel_at_period_end: true }
  await syncSubscription(db, stripe, "sub_1")
  assert.equal(writes[1][1].$set.isPremium, true)
  subscription.metadata = {}
  await syncSubscription(db, stripe, "sub_1")
  assert.equal(writes.length, 2)
})
test("activation requires a session and webhook verifies signatures before accepting events", async () => {
  const previous = { session: auth.api.getSession, key: process.env.BILLING_SECRET_KEY, webhook: process.env.STRIPE_WEBHOOK_SECRET }
  process.env.BILLING_SECRET_KEY = "sk_test_fixture"
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture"
  let loggedIn = false
  auth.api.getSession = async () => loggedIn ? { user: { id: "reader" } } : null
  const server = app.listen(0, "127.0.0.1")
  await new Promise(resolve => server.once("listening", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const origin = new URL(process.env.CLIENT_URL || "http://localhost:3000").origin
  try {
    const post = () => fetch(`${base}/api/billing/activate`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "bad", isPremium: true, userId: "forged" }) })
    assert.equal((await post()).status, 401)
    loggedIn = true
    assert.equal((await post()).status, 400)
    const payload = JSON.stringify({ id: "evt_test", type: "irrelevant.event", data: { object: {} } })
    const send = signature => fetch(`${base}/api/stripe/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": signature }, body: payload })
    assert.equal((await send("forged")).status, 400)
    const stripe = new Stripe("sk_test_fixture")
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_fixture" })
    assert.equal((await send(signature)).status, 200)
    delete process.env.STRIPE_WEBHOOK_SECRET
    assert.equal((await send(signature)).status, 503)
  } finally {
    await new Promise(resolve => server.close(resolve))
    auth.api.getSession = previous.session
    for (const [name, value] of [["BILLING_SECRET_KEY", previous.key], ["STRIPE_WEBHOOK_SECRET", previous.webhook]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value
    }
  }
})
