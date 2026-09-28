import { ObjectId } from "mongodb"
import { fromNodeHeaders } from "better-auth/node"
import { auth } from "../lib/auth.js"
import { getDatabase } from "../lib/db.js"
import { browsePublicLessons } from "../lib/public-lessons.js"
import { parseLessonFilters } from "../lib/lesson-filters.js"

export async function authorProfile(req, res) {
  res.set("Cache-Control", "private, no-store").vary("Cookie")
  const id = req.params.id
  if (id.length > 128) return res.status(404).json({ error: "Author not found." })
  const db = await getDatabase()
  const author = await db.collection("user").findOne({ _id: { $in: /^[a-f\d]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id] } }, { projection: { name: 1, image: 1 } })
  if (!author) return res.status(404).json({ error: "Author not found." })
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  const filters = parseLessonFilters(new URL(req.originalUrl, "http://localhost").searchParams)
  filters.author = id
  const result = await browsePublicLessons(db, filters, session?.user)
  res.json({ author: { id, name: author.name, image: author.image }, ...result })
}
