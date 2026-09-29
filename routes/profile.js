import { fromNodeHeaders } from "better-auth/node"
import { auth } from "../lib/auth.js"
import { getDatabase } from "../lib/db.js"
import { parseLessonFilters } from "../lib/lesson-filters.js"
import { browsePublicLessons } from "../lib/public-lessons.js"

export async function profile(req, res) {
  res.set("Cache-Control", "private, no-store").vary("Cookie")
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!session) return res.status(401).json({ error: "Please log in to view your profile." })
  const user = session.user
  const db = await getDatabase()
  const page = parseLessonFilters(new URL(req.originalUrl, "http://localhost").searchParams).page
  const [lessonsCreated, saves, publicLessons] = await Promise.all([
    db.collection("lessons").countDocuments({ $expr: { $eq: [{ $toString: "$creatorId" }, { $literal: String(user.id) }] } }),
    db.collection("favorites").aggregate([
      { $match: { $expr: { $eq: [{ $toString: "$userId" }, { $literal: String(user.id) }] } } },
      { $group: { _id: { $toString: "$lessonId" } } }, { $count: "total" },
    ], { maxTimeMS: 5000 }).toArray(),
    browsePublicLessons(db, { q: "", category: "", tone: "", sort: "newest", page, author: String(user.id) }, user),
  ])
  res.json({ user: { id: user.id, name: user.name, email: user.email, image: user.image || null, role: user.role || "user", isPremium: !!user.isPremium }, stats: { lessonsCreated, lessonsSaved: saves[0]?.total || 0 }, publicLessons })
}
