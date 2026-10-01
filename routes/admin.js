import { Router } from "express"
import { ObjectId } from "mongodb"
import { fromNodeHeaders } from "better-auth/node"
import { auth } from "../lib/auth.js"
import { getDatabase } from "../lib/db.js"
import { adminLessonFilters, aggregatePage, dateField, fillGrowth, growthPipeline, reportLookup, utcWindow } from "../lib/admin-queries.js"

export const admin = Router()
const idFilter = id => ({ _id: { $in: /^[a-f\d]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id] } })
const ref = (field, id) => ({ $expr: { $eq: [{ $toString: `$${field}` }, { $literal: String(id) }] } })
const run = (db, name, pipeline) => db.collection(name).aggregate(pipeline, { maxTimeMS: 10000 }).toArray()
admin.use(async (req, res, next) => {
  res.set("Cache-Control", "private, no-store").vary("Cookie")
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!session) return res.status(401).json({ error: "Please log in to continue." })
  const db = await getDatabase()
  const user = await db.collection("user").findOne(idFilter(String(session.user.id)), { projection: { role: 1 } })
  if (user?.role !== "admin") return res.status(403).json({ error: "Admin access is required." })
  req.db = db
  next()
})
admin.get("/access", (req, res) => res.json({ allowed: true }))
admin.param("id", (req, res, next, id) => {
  if (id.length > 128) return res.status(404).json({ error: "Item not found." })
  next()
})
async function lessonStats(db) {
  const [publicLessons, privateLessons, flagged] = await Promise.all([
    db.collection("lessons").countDocuments({ visibility: "public" }),
    db.collection("lessons").countDocuments({ visibility: "private" }),
    run(db, "lessons", [...reportLookup, { $match: { reportCount: { $gt: 0 } } }, { $count: "total" }]),
  ])
  return { publicLessons, privateLessons, flaggedLessons: flagged[0]?.total || 0 }
}
admin.get("/overview", async (req, res) => {
  const { db } = req
  const { today, start, end } = utcWindow()
  const [users, stats, lessonsGrowth, usersGrowth, contributors] = await Promise.all([
    db.collection("user").countDocuments({}), lessonStats(db),
    run(db, "lessons", growthPipeline(start, end)), run(db, "user", growthPipeline(start, end)),
    run(db, "lessons", [
      { $set: { day: dateField } }, { $match: { day: { $gte: start, $lt: end } } },
      { $group: { _id: { $toString: "$creatorId" }, count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 5 },
      { $lookup: { from: "user", let: { id: "$_id" }, pipeline: [
        { $match: { $expr: { $eq: [{ $toString: "$_id" }, "$$id"] } } }, { $project: { name: 1 } },
      ], as: "author" } },
      { $project: { _id: 0, id: "$_id", count: 1, name: { $ifNull: [{ $first: "$author.name" }, "Deleted account"] } } },
    ]),
  ])
  const lessonGrowth = fillGrowth(lessonsGrowth, start)
  res.json({ users, ...stats, todayLessons: lessonGrowth.at(-1).count, contributors,
    growth: { lessons: lessonGrowth, users: fillGrowth(usersGrowth, start) }, today: today.toISOString().slice(0, 10), timezone: "UTC" })
})
admin.get("/users", async (req, res) => {
  res.json(await aggregatePage(req.db, "user", [], req.query.page, [
    { $lookup: { from: "lessons", let: { id: { $toString: "$_id" } }, pipeline: [
      { $match: { $expr: { $eq: [{ $toString: "$creatorId" }, "$$id"] } } }, { $count: "total" },
    ], as: "lessons" } },
    { $project: { _id: 0, id: { $toString: "$_id" }, name: 1, email: 1, role: { $ifNull: ["$role", "user"] },
      totalLessons: { $ifNull: [{ $first: "$lessons.total" }, 0] } } },
  ]))
})
admin.patch("/users/:id/role", async (req, res) => {
  if (!req.body || Object.keys(req.body).length !== 1 || req.body.role !== "admin") return res.status(400).json({ error: "Only promotion to admin is supported." })
  const result = await req.db.collection("user").updateOne(idFilter(req.params.id), { $set: { role: "admin", updatedAt: new Date() } })
  if (!result.matchedCount) return res.status(404).json({ error: "User not found." })
  res.json({ message: "User promoted to admin. They should log out and back in to refresh their navigation." })
})
admin.get("/lessons", async (req, res) => {
  const [list, stats] = await Promise.all([
    aggregatePage(req.db, "lessons", adminLessonFilters(req.query), req.query.page, [
      { $project: { _id: 0, id: { $toString: "$_id" }, title: 1, visibility: 1, accessLevel: 1, isFeatured: 1, isReviewed: 1, category: 1, reportCount: 1 } },
    ]), lessonStats(req.db),
  ])
  res.json({ ...list, stats })
})
admin.patch("/lessons/:id", async (req, res) => {
  const keys = Object.keys(req.body || {})
  if (!keys.length || keys.some(key => !["isFeatured", "isReviewed"].includes(key) || typeof req.body[key] !== "boolean"))
    return res.status(400).json({ error: "Provide only valid featured or reviewed settings." })
  const lesson = await req.db.collection("lessons").findOne(idFilter(req.params.id))
  if (!lesson) return res.status(404).json({ error: "Lesson not found." })
  if (req.body.isFeatured && lesson.visibility !== "public") return res.status(400).json({ error: "Only public lessons can be featured." })
  const settings = Object.fromEntries(keys.map(key => [key, req.body[key]]))
  await req.db.collection("lessons").updateOne({ _id: lesson._id }, { $set: settings })
  res.json({ message: "Lesson moderation updated." })
})
admin.delete("/lessons/:id", async (req, res) => {
  const lesson = await req.db.collection("lessons").findOne(idFilter(req.params.id))
  if (!lesson) return res.status(404).json({ error: "Lesson not found." })
  await req.db.collection("lessons").deleteOne({ _id: lesson._id })
  await Promise.all(["favorites", "comments", "lessonsReports"].map(name => req.db.collection(name).deleteMany(ref("lessonId", lesson._id))))
  res.json({ message: "Lesson and related activity deleted." })
})
admin.get("/reports", async (req, res) => {
  res.json(await aggregatePage(req.db, "lessons", [...reportLookup, { $match: { reportCount: { $gt: 0 } } }], req.query.page, [
    { $project: { _id: 0, id: { $toString: "$_id" }, title: 1, reportCount: 1 } },
  ], { reportCount: -1, _id: -1 }))
})
admin.get("/reports/:id", async (req, res) => {
  // Paginate the modal so every reason is reachable without an unbounded response.
  res.json(await aggregatePage(req.db, "lessonsReports", [{ $match: ref("lessonId", req.params.id) }], req.query.page, [
    { $lookup: { from: "user", let: { id: { $toString: "$reporterUserId" } }, pipeline: [
      { $match: { $expr: { $eq: [{ $toString: "$_id" }, "$$id"] } } }, { $project: { name: 1, email: 1 } },
    ], as: "reporter" } },
    { $project: { _id: 0, id: { $toString: "$_id" }, reason: 1, timestamp: 1,
      reporterName: { $ifNull: [{ $first: "$reporter.name" }, "Deleted account"] },
      reporterEmail: { $ifNull: [{ $first: "$reporter.email" }, "$reportedUserEmail"] } } },
  ]))
})
admin.delete("/reports/:id", async (req, res) => {
  await req.db.collection("lessonsReports").deleteMany(ref("lessonId", req.params.id))
  res.json({ message: "All reports for this lesson cleared. The lesson was kept." })
})
