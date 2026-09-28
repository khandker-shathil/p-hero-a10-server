import { Router } from "express"
import { ObjectId } from "mongodb"
import { fromNodeHeaders } from "better-auth/node"
import { auth } from "../lib/auth.js"
import { getDatabase } from "../lib/db.js"
import { browsePublicLessons } from "../lib/public-lessons.js"
import { parseLessonFilters } from "../lib/lesson-filters.js"
import { lessonAccess, REPORT_REASONS } from "../lib/lesson-access.js"

export const lessons = Router()
const idFilter = id => ({ _id: { $in: /^[a-f\d]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id] } })
const stringEqual = (field, id) => ({ $expr: { $eq: [{ $toString: `$${field}` }, { $literal: String(id) }] } })

lessons.use((req, res, next) => {
  res.set("Cache-Control", "private, no-store").vary("Cookie")
  next()
})
lessons.get("/", async (req, res) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  const filters = parseLessonFilters(new URL(req.originalUrl, "http://localhost").searchParams)
  res.json(await browsePublicLessons(await getDatabase(), filters, session?.user))
})
// Every detail/engagement operation verifies the session and content access anew.
lessons.use("/:id", async (req, res, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!session) return res.status(401).json({ error: "Please log in to read this lesson." })
  if (req.params.id.length > 128) return res.status(404).json({ error: "Lesson not found." })
  const db = await getDatabase()
  const lesson = await db.collection("lessons").findOne(idFilter(req.params.id))
  const status = lessonAccess(lesson, session.user)
  if (status !== 200) return res.status(status).json({ error: status === 403 ? "Upgrade to Premium to read this lesson." : "Lesson not found." })
  req.viewer = session.user
  req.lesson = lesson
  req.db = db
  next()
})

async function engagement(db, lesson, user) {
  const ref = stringEqual("lessonId", lesson._id)
  const [savedBy, fresh] = await Promise.all([
    db.collection("favorites").find(ref, { projection: { userId: 1 } }).toArray(),
    db.collection("lessons").findOne({ _id: lesson._id }, { projection: { likes: 1 } }),
  ])
  const savers = new Set(savedBy.map(x => String(x.userId)))
  const likes = [...new Set((fresh?.likes || []).map(String))]
  return { likesCount: likes.length, liked: likes.includes(String(user.id)), savesCount: savers.size, saved: savers.has(String(user.id)) }
}

lessons.get("/:id", async (req, res) => {
  const { db, lesson, viewer } = req
  const [author, totalLessons, stats] = await Promise.all([
    db.collection("user").findOne(idFilter(String(lesson.creatorId)), { projection: { name: 1, image: 1 } }),
    db.collection("lessons").countDocuments({ visibility: "public", ...stringEqual("creatorId", lesson.creatorId) }),
    engagement(db, lesson, viewer),
  ])
  res.json({ lesson: {
    id: String(lesson._id), title: lesson.title, description: lesson.description,
    category: lesson.category, emotionalTone: lesson.emotionalTone,
    image: lesson.image || lesson.imageUrl || null,
    accessLevel: lesson.accessLevel, visibility: lesson.visibility,
    createdAt: lesson.createdAt, updatedAt: lesson.updatedAt || lesson.createdAt,
    readingMinutes: Math.max(1, Math.ceil((lesson.description || "").trim().split(/\s+/).length / 200)),
    author: { id: String(lesson.creatorId), name: author?.name || "Community member", image: author?.image || null, totalLessons },
    ...stats,
  } })
})
lessons.get("/:id/comments", async (req, res) => {
  const { db, lesson } = req
  const raw = Number(req.query.page)
  const page = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 10000) : 1
  const filter = stringEqual("lessonId", lesson._id)
  const [total, items] = await Promise.all([
    db.collection("comments").countDocuments(filter),
    db.collection("comments").aggregate([
      { $match: filter }, { $sort: { createdAt: -1, _id: -1 } }, { $skip: (page - 1) * 20 }, { $limit: 20 },
      { $lookup: { from: "user", let: { user: { $toString: "$userId" } }, pipeline: [
        { $match: { $expr: { $eq: [{ $toString: "$_id" }, "$$user"] } } }, { $project: { name: 1, image: 1 } },
      ], as: "author" } },
      { $project: { _id: 0, id: { $toString: "$_id" }, text: 1, createdAt: 1, name: { $ifNull: [{ $first: "$author.name" }, "Community member"] } } },
    ]).toArray(),
  ])
  res.json({ items, total, page, totalPages: Math.max(1, Math.ceil(total / 20)) })
})
lessons.post("/:id/like", async (req, res) => {
  const { db, lesson, viewer } = req
  const uid = String(viewer.id)
  await db.collection("lessons").updateOne({ _id: lesson._id }, [
    { $set: { likes: { $map: { input: { $ifNull: ["$likes", []] }, as: "id", in: { $toString: "$$id" } } } } },
    { $set: { likes: { $cond: [{ $in: [{ $literal: uid }, "$likes"] }, { $setDifference: ["$likes", { $literal: [uid] }] }, { $setUnion: ["$likes", { $literal: [uid] }] }] } } },
    { $set: { likesCount: { $size: "$likes" } } },
  ])
  res.json(await engagement(db, lesson, viewer))
})
// PUT/DELETE are idempotent: retries cannot accidentally undo a save.
lessons.put("/:id/favorite", async (req, res) => {
  const { db, lesson, viewer } = req
  const filter = { lessonId: String(lesson._id), userId: String(viewer.id) }
  try { await db.collection("favorites").updateOne(filter, { $setOnInsert: { ...filter, savedAt: new Date() } }, { upsert: true }) }
  catch (error) { if (error.code !== 11000) throw error }
  res.json(await engagement(db, lesson, viewer))
})
lessons.delete("/:id/favorite", async (req, res) => {
  const { db, lesson, viewer } = req
  await db.collection("favorites").deleteMany({ $and: [stringEqual("lessonId", lesson._id), stringEqual("userId", viewer.id)] })
  res.json(await engagement(db, lesson, viewer))
})
lessons.post("/:id/comments", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : ""
  if (!text || text.length > 2000) return res.status(400).json({ error: "Write a comment between 1 and 2,000 characters." })
  await req.db.collection("comments").insertOne({ lessonId: String(req.lesson._id), userId: String(req.viewer.id), text, createdAt: new Date() })
  res.status(201).json({ message: "Comment posted." })
})
lessons.post("/:id/reports", async (req, res) => {
  const reason = req.body?.reason
  if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: "Choose a valid report reason." })
  await req.db.collection("lessonsReports").insertOne({ lessonId: String(req.lesson._id), reporterUserId: String(req.viewer.id), reportedUserEmail: req.viewer.email, reason, timestamp: new Date() })
  res.status(201).json({ message: "Report submitted for review." })
})
