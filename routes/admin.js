import { Router } from "express"
import { ObjectId } from "mongodb"
import { fromNodeHeaders } from "better-auth/node"
import { auth } from "../lib/auth.js"
import { getDatabase } from "../lib/db.js"

export const admin = Router()
const idFilter = id => ({ _id: { $in: /^[a-f\d]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id] } })
const ref = (field, id) => ({ $expr: { $eq: [{ $toString: `$${field}` }, { $literal: String(id) }] } })

admin.use(async (req, res, next) => {
  res.set("Cache-Control", "private, no-store").vary("Cookie")
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!session) return res.status(401).json({ error: "Please log in to continue." })
  const db = await getDatabase()
  // Check the current database role so a revoked admin cannot use an old session.
  const user = await db.collection("user").findOne(idFilter(String(session.user.id)), { projection: { role: 1 } })
  if (user?.role !== "admin") return res.status(403).json({ error: "Admin access is required." })
  req.db = db
  next()
})
admin.get("/overview", async (req, res) => {
  const [users, lessons, reports, premiumUsers] = await Promise.all([
    req.db.collection("user").countDocuments({}),
    req.db.collection("lessons").countDocuments({}),
    req.db.collection("lessonsReports").countDocuments({}),
    req.db.collection("user").countDocuments({ isPremium: true }),
  ])
  res.json({ users, lessons, reports, premiumUsers })
})
async function paginate(req, collection, stages) {
  const total = await req.db.collection(collection).countDocuments({})
  const totalPages = Math.max(1, Math.ceil(total / 10))
  const requested = Number(req.query.page)
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, totalPages) : 1
  const items = await req.db.collection(collection).aggregate([
    { $sort: { _id: -1 } }, { $skip: (page - 1) * 10 }, { $limit: 10 }, ...stages,
  ]).toArray()
  return { items, total, totalPages, page }
}
admin.get("/users", async (req, res) => {
  res.json(await paginate(req, "user", [{ $project: { _id: 0, id: { $toString: "$_id" }, name: 1, email: 1, role: 1, isPremium: 1 } }]))
})
admin.get("/lessons", async (req, res) => {
  res.json(await paginate(req, "lessons", [{ $project: { _id: 0, id: { $toString: "$_id" }, title: 1, visibility: 1, accessLevel: 1, isFeatured: 1, category: 1 } }]))
})
admin.get("/reports", async (req, res) => {
  res.json(await paginate(req, "lessonsReports", [
    { $lookup: { from: "lessons", let: { id: "$lessonId" }, pipeline: [
      { $match: { $expr: { $eq: [{ $toString: "$_id" }, { $toString: "$$id" }] } } },
      { $project: { title: 1 } },
    ], as: "lesson" } },
    { $project: { _id: 0, id: { $toString: "$_id" }, lessonId: { $toString: "$lessonId" }, reason: 1, timestamp: 1,
      title: { $ifNull: [{ $first: "$lesson.title" }, "Deleted lesson"] } } },
  ]))
})
admin.param("id", (req, res, next, id) => {
  if (id.length > 128) return res.status(404).json({ error: "Item not found." })
  next()
})
admin.patch("/lessons/:id", async (req, res) => {
  if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.isFeatured !== "boolean")
    return res.status(400).json({ error: "Provide only a valid featured setting." })
  const lesson = await req.db.collection("lessons").findOne(idFilter(req.params.id))
  if (!lesson) return res.status(404).json({ error: "Lesson not found." })
  if (req.body.isFeatured && lesson.visibility !== "public") return res.status(400).json({ error: "Only public lessons can be featured." })
  await req.db.collection("lessons").updateOne({ _id: lesson._id }, { $set: { isFeatured: req.body.isFeatured } })
  res.json({ message: req.body.isFeatured ? "Lesson featured." : "Lesson removed from featured." })
})
admin.delete("/lessons/:id", async (req, res) => {
  const lesson = await req.db.collection("lessons").findOne(idFilter(req.params.id))
  if (!lesson) return res.status(404).json({ error: "Lesson not found." })
  await req.db.collection("lessons").deleteOne({ _id: lesson._id })
  await Promise.all(["favorites", "comments", "lessonsReports"].map(name => req.db.collection(name).deleteMany(ref("lessonId", lesson._id))))
  res.json({ message: "Lesson and related activity deleted." })
})
admin.delete("/reports/:id", async (req, res) => {
  const result = await req.db.collection("lessonsReports").deleteOne(idFilter(req.params.id))
  if (!result.deletedCount) return res.status(404).json({ error: "Report not found." })
  res.json({ message: "Report dismissed. The lesson was kept." })
})
