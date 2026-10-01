import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { app } from "../app.js"
import { auth } from "../lib/auth.js"
import { client, db } from "../lib/db.js"

test("admin APIs require a current admin role and constrain moderation", async () => {
  const previous = { session: auth.api.getSession, connect: client.connect, collection: db.collection }
  let user = null, role = "user"
  const writes = [], pipelines = []
  const lesson = { _id: "lesson", title: "Reflection", visibility: "public" }
  auth.api.getSession = async () => user ? { user } : null
  client.connect = async () => client
  db.collection = name => ({
    findOne: async () => name === "user" ? { role } : lesson,
    countDocuments: async () => 12,
    aggregate: pipeline => { pipelines.push({ name, pipeline }); return { toArray: async () => [] } },
    updateOne: async (...args) => { writes.push({ name, args }); return { matchedCount: 1 } },
    deleteOne: async (...args) => { writes.push({ name, args }); return { deletedCount: 1 } },
    deleteMany: async (...args) => { writes.push({ name, args }); return { deletedCount: 1 } },
  })
  const server = app.listen(0, "127.0.0.1")
  await new Promise(resolve => server.once("listening", resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/admin`
  const request = (path, method = "GET", body) => fetch(base + path, {
    method, headers: { Origin: new URL(process.env.CLIENT_URL || "http://localhost:3000").origin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  try {
    const endpoints = [["/overview"], ["/users"], ["/lessons"], ["/reports"], ["/lessons/lesson", "PATCH", { isFeatured: true }], ["/lessons/lesson", "DELETE"], ["/reports/report", "DELETE"]]
    for (const args of endpoints) assert.equal((await request(...args)).status, 401)
    user = { id: "reader", role: "admin" }
    // A forged/stale session role cannot replace the database role.
    for (const args of endpoints) assert.equal((await request(...args)).status, 403)
    assert.equal(writes.length, 0)
    role = "admin"
    assert.equal((await request("/overview")).status, 200)
    const users = await request("/users?page=999")
    assert.equal(users.headers.get("cache-control"), "private, no-store")
    assert.equal((await users.json()).page, 2)
    const projection = pipelines[0].pipeline.at(-1).$project
    assert.deepEqual(Object.keys(projection).sort(), ["_id", "email", "id", "isPremium", "name", "role"].sort())
    assert.equal((await request("/lessons/lesson", "PATCH", { isFeatured: true, role: "admin" })).status, 400)
    lesson.visibility = "private"
    assert.equal((await request("/lessons/lesson", "PATCH", { isFeatured: true })).status, 400)
    lesson.visibility = "public"
    assert.equal((await request("/lessons/lesson", "PATCH", { isFeatured: true })).status, 200)
    assert.deepEqual(writes.at(-1).args[1], { $set: { isFeatured: true } })
    assert.equal((await request("/lessons/lesson", "DELETE")).status, 200)
    assert.ok(["favorites", "comments", "lessonsReports"].every(name => writes.some(write => write.name === name)))
    const beforeDismiss = writes.length
    assert.equal((await request("/reports/report", "DELETE")).status, 200)
    assert.equal(writes.length, beforeDismiss + 1)
    assert.equal(writes.at(-1).name, "lessonsReports")
    role = "user"
    assert.equal((await request("/overview")).status, 403)
  } finally {
    await new Promise(resolve => server.close(resolve))
    auth.api.getSession = previous.session; client.connect = previous.connect; db.collection = previous.collection
    await client.close()
  }
})
