import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { app } from "../app.js"
import { auth } from "../lib/auth.js"
import { client, db } from "../lib/db.js"

// Isolated HTTP tests: inject a session and an in-memory database boundary.
// No accounts or lessons are created in the real database.
test("Express detail routes enforce permissions and validate engagement", async () => {
  const sessionFn = auth.api.getSession
  const connectFn = client.connect
  const collectionFn = db.collection
  let user = null
  const lesson = { _id: "lesson-1", creatorId: "owner", visibility: "public", accessLevel: "free", title: "A lesson", description: "A useful reflection", likes: [], createdAt: new Date(), secret: "not public" }
  let commentRecord
  let reportRecord
  let favorites = []
  auth.api.getSession = async () => user ? { user } : null
  client.connect = async () => client
  db.collection = (name) => ({
    findOne: async () => name === "lessons" ? lesson : { _id: "owner", name: "Author", email: "secret@example.com" },
    countDocuments: async () => 1,
    find: () => ({ toArray: async () => favorites }),
    aggregate: () => ({ toArray: async () => [] }),
    updateOne: async (filter, update) => {
      if (name === "favorites" && !favorites.length) favorites.push(update.$setOnInsert)
      return { modifiedCount: 1 }
    },
    deleteMany: async () => { favorites = []; return { deletedCount: 1 } },
    insertOne: async (record) => {
      if (name === "comments") commentRecord = record
      if (name === "lessonsReports") reportRecord = record
      return { insertedId: "new-record" }
    },
  })
  const server = app.listen(0, "127.0.0.1")
  await new Promise(resolve => server.once("listening", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  async function request(path = "", method = "GET", body, origin = process.env.CLIENT_URL || "http://localhost:3000") {
    return fetch(`${base}/api/lessons/lesson-1${path}`, { method, headers: { Origin: origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
  }
  try {
    assert.equal((await request()).status, 401)
    user = { id: "reader", email: "reader@example.com", isPremium: false }
    const response = await request()
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.lesson.description, lesson.description)
    assert.ok(!("secret" in body.lesson))
    assert.ok(!("email" in body.lesson.author))
    lesson.visibility = "private"
    assert.equal((await request()).status, 404)
    assert.equal((await request("/comments", "POST", { text: "no access" })).status, 404)
    lesson.visibility = "public"; lesson.accessLevel = "premium"
    assert.equal((await request()).status, 403)
    assert.equal((await request("/favorite", "PUT")).status, 403)
    user.isPremium = true
    assert.equal((await request()).status, 200)
    user.isPremium = false; user.id = "owner"
    assert.equal((await request()).status, 200)
    lesson.accessLevel = "free"; user.id = "reader"
    assert.equal((await request("/comments", "POST", { text: "" })).status, 400)
    assert.equal((await request("/comments", "POST", { text: "x".repeat(2001) })).status, 400)
    assert.equal((await request("/comments", "POST", { text: "Thoughtful comment", userId: "forged" })).status, 201)
    assert.equal(commentRecord.userId, "reader")
    assert.equal(commentRecord.lessonId, "lesson-1")
    assert.equal((await request("/reports", "POST", { reason: "not allowed" })).status, 400)
    assert.equal((await request("/reports", "POST", { reason: "Spam or advertising", reporterUserId: "forged" })).status, 201)
    assert.equal(reportRecord.reporterUserId, "reader")
    assert.equal((await request("/favorite", "PUT")).status, 200)
    assert.equal((await request("/favorite", "PUT")).status, 200)
    assert.equal(favorites.length, 1)
    assert.equal((await (await request("/favorite", "DELETE")).json()).saved, false)
    assert.equal((await request("/comments", "POST", { text: "bad origin" }, "https://untrusted.example")).status, 403)
  } finally {
    await new Promise(resolve => server.close(resolve))
    auth.api.getSession = sessionFn
    client.connect = connectFn
    db.collection = collectionFn
    await client.close()
  }
})
