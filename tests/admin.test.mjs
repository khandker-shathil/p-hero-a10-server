import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { app } from "../app.js"
import { auth } from "../lib/auth.js"
import { client, db } from "../lib/db.js"
import { adminLessonFilters, aggregatePage, fillGrowth, growthPipeline, reportLookup, utcWindow } from "../lib/admin-queries.js"

test("UTC growth includes today, fills missing days and ignores unsafe filters", () => {
  const { today, start, end } = utcWindow(new Date("2026-09-30T23:59:59Z"))
  assert.equal(today.toISOString(), "2026-09-30T00:00:00.000Z")
  assert.equal(start.toISOString(), "2026-09-01T00:00:00.000Z")
  assert.equal(end.toISOString(), "2026-10-01T00:00:00.000Z")
  const points = fillGrowth([{ _id: "2026-09-30", count: 3 }], start)
  assert.equal(points.length, 30); assert.equal(points[0].count, 0); assert.equal(points.at(-1).count, 3)
  assert.deepEqual(adminLessonFilters({ category: { $ne: null }, visibility: "secret", flags: "invalid" })[0], { $match: {} })
  const filtered = adminLessonFilters({ category: "Career", visibility: "private", flags: "flagged" })
  assert.deepEqual(filtered[0], { $match: { category: "Career", visibility: "private" } })
  assert.deepEqual(filtered.at(-1), { $match: { reportCount: { $gt: 0 } } })
})

test("pagination clamps overflow and keeps filter stages for totals and rows", async () => {
  const calls = []
  const fakeDb = { collection: () => ({ aggregate: pipeline => { calls.push(pipeline); return { toArray: async () => pipeline.at(-1).$count ? [{ total: 12 }] : [] } } }) }
  const base = [{ $match: { visibility: "private" } }]
  const result = await aggregatePage(fakeDb, "lessons", base, 999, [])
  assert.equal(result.page, 2)
  assert.equal(calls[1].find(stage => stage.$skip !== undefined).$skip, 10)
  assert.deepEqual(calls[0][0], base[0]); assert.deepEqual(calls[1][0], base[0])
})

test("admin APIs enforce current roles, promotion, reviewed status and grouped report actions", async () => {
  const previous = { session: auth.api.getSession, connect: client.connect, collection: db.collection }
  let user = null, role = "user"
  const writes = [], pipelines = []
  const lesson = { _id: "lesson", title: "Reflection", visibility: "public" }
  auth.api.getSession = async () => user ? { user } : null
  client.connect = async () => client
  db.collection = name => ({
    findOne: async () => name === "user" ? { role } : lesson,
    countDocuments: async () => 12,
    aggregate: pipeline => { pipelines.push({ name, pipeline }); return { toArray: async () => pipeline.at(-1).$count ? [{ total: 12 }] : [] } },
    updateOne: async (...args) => { writes.push({ name, method: "updateOne", args }); return { matchedCount: 1 } },
    deleteOne: async (...args) => { writes.push({ name, method: "deleteOne", args }); return { deletedCount: 1 } },
    deleteMany: async (...args) => { writes.push({ name, method: "deleteMany", args }); return { deletedCount: 3 } },
  })
  const server = app.listen(0, "127.0.0.1")
  await new Promise(resolve => server.once("listening", resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/admin`
  const request = (path, method = "GET", body, origin = new URL(process.env.CLIENT_URL || "http://localhost:3000").origin) => fetch(base + path, {
    method, headers: { Origin: origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  try {
    const endpoints = [["/access"], ["/overview"], ["/users"], ["/lessons"], ["/reports"], ["/reports/lesson"], ["/users/reader/role", "PATCH", { role: "admin" }], ["/lessons/lesson", "PATCH", { isReviewed: true }], ["/lessons/lesson", "DELETE"], ["/reports/lesson", "DELETE"]]
    for (const args of endpoints) assert.equal((await request(...args)).status, 401)
    user = { id: "reader", role: "admin" }
    for (const args of endpoints) assert.equal((await request(...args)).status, 403)
    assert.equal(writes.length, 0)
    role = "admin"
    const overview = await request("/overview")
    assert.equal(overview.status, 200)
    const counts = await overview.json()
    assert.equal(counts.publicLessons, 12); assert.equal(counts.flaggedLessons, 12)
    assert.equal(counts.growth.lessons.length, 30)
    const users = await request("/users?page=999")
    assert.equal(users.headers.get("cache-control"), "private, no-store")
    assert.equal((await users.json()).page, 2)
    const userPipeline = pipelines.find(row => row.name === "user" && row.pipeline.at(-1).$project)
    assert.deepEqual(Object.keys(userPipeline.pipeline.at(-1).$project).sort(), ["_id", "email", "id", "name", "role", "totalLessons"].sort())
    assert.equal((await request("/users/reader/role", "PATCH", { role: "user" })).status, 400)
    assert.equal((await request("/users/reader/role", "PATCH", { role: "admin", isPremium: true })).status, 400)
    assert.equal((await request("/users/reader/role", "PATCH", { role: "admin" }, "https://evil.example")).status, 403)
    assert.equal((await request("/users/reader/role", "PATCH", { role: "admin" })).status, 200)
    assert.equal(writes.at(-1).args[1].$set.role, "admin")
    assert.equal((await request("/lessons/lesson", "PATCH", { isReviewed: true, role: "admin" })).status, 400)
    assert.equal((await request("/lessons/lesson", "PATCH", { isReviewed: true })).status, 200)
    assert.deepEqual(writes.at(-1).args[1], { $set: { isReviewed: true } })
    lesson.visibility = "private"
    assert.equal((await request("/lessons/lesson", "PATCH", { isFeatured: true })).status, 400)
    lesson.visibility = "public"
    assert.equal((await request("/lessons/lesson", "PATCH", { isFeatured: true })).status, 200)
    assert.equal((await request("/reports/lesson")).status, 200)
    const details = pipelines.find(row => row.name === "lessonsReports" && row.pipeline.at(-1).$project)
    assert.ok(details.pipeline.at(-1).$project.reporterEmail)
    assert.equal((await request("/lessons/lesson", "DELETE")).status, 200)
    assert.ok(["favorites", "comments", "lessonsReports"].every(name => writes.some(write => write.name === name)))
    const beforeIgnore = writes.length
    assert.equal((await request("/reports/lesson", "DELETE")).status, 200)
    assert.equal(writes.length, beforeIgnore + 1)
    assert.equal(writes.at(-1).name, "lessonsReports")
    assert.equal(writes.at(-1).method, "deleteMany")
    assert.equal(writes.at(-1).args[0].$expr.$eq[1].$literal, "lesson")
    role = "user"
    assert.equal((await request("/access")).status, 403)
  } finally {
    await new Promise(resolve => server.close(resolve))
    auth.api.getSession = previous.session; client.connect = previous.connect; db.collection = previous.collection
    await client.close()
  }
})

test("MongoDB fixtures count distinct flagged lessons and bucket mixed dates", { skip: process.env.RUN_MONGO_TESTS !== "1" }, async () => {
  await client.connect()
  try {
    const reports = [{ lessonId: "a" }, { lessonId: "a" }, { lessonId: "b" }, { lessonId: "missing" }]
    const lessons = [{ _id: "a", category: "Career", visibility: "public", createdAt: new Date("2026-09-30T01:00:00Z") }, { _id: "b", category: "Career", visibility: "private", createdAt: "2026-09-30T23:59:59Z" }, { _id: "c", category: "Mindset", visibility: "public", createdAt: "bad date" }]
    function withFixtures(stages) {
      return stages.map(stage => stage.$lookup ? { $lookup: { let: stage.$lookup.let, as: stage.$lookup.as, pipeline: [{ $documents: reports }, ...stage.$lookup.pipeline] } } : stage)
    }
    const flagged = await db.aggregate([{ $documents: lessons }, ...withFixtures(reportLookup), { $match: { reportCount: { $gt: 0 } } }]).toArray()
    assert.equal(flagged.length, 2); assert.equal(flagged[0].reportCount, 2)
    const filtered = await db.aggregate([{ $documents: lessons }, ...withFixtures(adminLessonFilters({ category: "Career", visibility: "private", flags: "flagged" }))]).toArray()
    assert.equal(filtered.length, 1); assert.equal(filtered[0]._id, "b")
    const { start, end } = utcWindow(new Date("2026-09-30T12:00:00Z"))
    const growth = await db.aggregate([{ $documents: lessons }, ...growthPipeline(start, end)]).toArray()
    assert.deepEqual(growth, [{ _id: "2026-09-30", count: 2 }])
  } finally { await client.close() }
})
