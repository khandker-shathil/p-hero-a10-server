import { Router } from "express"
import { fromNodeHeaders } from "better-auth/node"
import { auth } from "../lib/auth.js"
import { getDatabase } from "../lib/db.js"
import { parseLessonFilters } from "../lib/lesson-filters.js"
import { favoriteMatch, favoritesPipeline, favoriteProjection } from "../lib/favorites-query.js"

export const myFavorites = Router()
myFavorites.use(async (req, res, next) => {
  res.set("Cache-Control", "private, no-store").vary("Cookie")
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!session) return res.status(401).json({ error: "Please log in to see your favorites." })
  req.viewer = session.user
  req.db = await getDatabase()
  next()
})
myFavorites.get("/", async (req, res) => {
  const filters = parseLessonFilters(new URL(req.originalUrl, "http://localhost").searchParams)
  const pipeline = favoritesPipeline(req.viewer, filters)
  const favorites = req.db.collection("favorites")
  const counts = await favorites.aggregate([...pipeline, { $count: "total" }], { maxTimeMS: 5000 }).toArray()
  const total = counts[0]?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / 10))
  const page = Math.min(filters.page, totalPages)
  const items = total ? await favorites.aggregate([
    ...pipeline, { $sort: { savedAt: -1, _id: 1 } }, { $skip: (page - 1) * 10 }, { $limit: 10 },
    { $project: favoriteProjection(req.viewer) },
  ], { maxTimeMS: 5000 }).toArray() : []
  res.json({ items, total, page, totalPages })
})
myFavorites.delete("/:id", async (req, res) => {
  if (req.params.id.length > 128) return res.status(400).json({ error: "Invalid lesson ID." })
  // Removal remains possible even if the saved lesson was deleted or made private.
  await req.db.collection("favorites").deleteMany(favoriteMatch(req.viewer.id, req.params.id))
  res.json({ message: "Removed from favorites." })
})
