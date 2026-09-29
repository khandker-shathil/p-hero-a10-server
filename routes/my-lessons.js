import { Router } from "express"
import { ObjectId } from "mongodb"
import { fromNodeHeaders } from "better-auth/node"
import { auth } from "../lib/auth.js"
import { getDatabase } from "../lib/db.js"
import { lessonInput, canManageLesson } from "../lib/lesson-input.js"

export const myLessons = Router()
const ref = (field, id) => ({ $expr: { $eq: [{ $toString: `$${field}` }, { $literal: String(id) }] } })
myLessons.use(async (req, res, next) => {
  res.set("Cache-Control", "private, no-store").vary("Cookie")
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!session) return res.status(401).json({ error: "Please log in to manage lessons." })
  req.viewer = session.user
  req.db = await getDatabase()
  next()
})
myLessons.get("/", async (req, res) => {
  const filter = ref("creatorId", req.viewer.id)
  const total = await req.db.collection("lessons").countDocuments(filter)
  const totalPages = Math.max(1, Math.ceil(total / 10))
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(req.query.page) || 1)))
  const items = await req.db.collection("lessons").aggregate([
    { $match: filter }, { $sort: { createdAt: -1, _id: -1 } }, { $skip: (page - 1) * 10 }, { $limit: 10 },
    { $lookup: { from: "favorites", let: { lesson: { $toString: "$_id" } }, pipeline: [
      { $match: { $expr: { $eq: [{ $toString: "$lessonId" }, "$$lesson"] } } },
      { $group: { _id: { $toString: "$userId" } } }, { $count: "total" },
    ], as: "saves" } },
    { $project: { _id: 0, id: { $toString: "$_id" }, title: 1, category: 1, emotionalTone: 1, visibility: 1, accessLevel: 1, createdAt: 1,
      likesCount: { $size: { $setUnion: [{ $map: { input: { $ifNull: ["$likes", []] }, as: "user", in: { $toString: "$$user" } } }, []] } },
      savesCount: { $ifNull: [{ $first: "$saves.total" }, 0] },
    } },
  ]).toArray()
  res.json({ items, total, page, totalPages })
})
myLessons.post("/", async (req, res) => {
  let input
  try { input = lessonInput(req.body, req.viewer) } catch (error) { return res.status(400).json({ error: error.message }) }
  const now = new Date()
  const result = await req.db.collection("lessons").insertOne({ ...input, creatorId: String(req.viewer.id), likes: [], likesCount: 0, isFeatured: false, isReviewed: false, createdAt: now, updatedAt: now })
  res.status(201).json({ id: String(result.insertedId), message: "Lesson created." })
})
myLessons.use("/:id", async (req, res, next) => {
  const id = req.params.id
  if (id.length > 128) return res.status(404).json({ error: "Lesson not found." })
  const ids = /^[a-f\d]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id]
  const lesson = await req.db.collection("lessons").findOne({ _id: { $in: ids } })
  if (!canManageLesson(lesson, req.viewer)) return res.status(404).json({ error: "Lesson not found or you do not have permission to edit it." })
  req.lesson = lesson
  next()
})
myLessons.get("/:id", (req, res) => {
  const { lesson } = req
  res.json({ lesson: { id: String(lesson._id), title: lesson.title, description: lesson.description, category: lesson.category, emotionalTone: lesson.emotionalTone, image: lesson.image || lesson.imageUrl || "", visibility: lesson.visibility, accessLevel: lesson.accessLevel } })
})
myLessons.patch("/:id", async (req, res) => {
  let input
  try { input = lessonInput(req.body, req.viewer, req.lesson) } catch (error) { return res.status(400).json({ error: error.message }) }
  await req.db.collection("lessons").updateOne({ _id: req.lesson._id }, { $set: { ...input, updatedAt: new Date() } })
  res.json({ message: "Lesson updated." })
})
myLessons.delete("/:id", async (req, res) => {
  await req.db.collection("lessons").deleteOne({ _id: req.lesson._id })
  await Promise.all(["favorites", "comments", "lessonsReports"].map(name => req.db.collection(name).deleteMany(ref("lessonId", req.lesson._id))))
  res.json({ message: "Lesson deleted." })
})
