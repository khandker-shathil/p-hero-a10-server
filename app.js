import "dotenv/config"
import { images } from "./routes/images.js"
import express from "express"
import cors from "cors"
import { toNodeHandler } from "better-auth/node"
import { auth } from "./lib/auth.js"
import { profile } from "./routes/profile.js"
import { home } from "./routes/home.js"
import { authorProfile } from "./routes/authors.js"
import { myFavorites } from "./routes/my-favorites.js"
import { myLessons } from "./routes/my-lessons.js"
import { lessons } from "./routes/lessons.js"

export const app = express()
const origin = new URL(process.env.CLIENT_URL || "http://localhost:3000").origin
app.disable("x-powered-by")
app.use(cors({ origin, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }))
app.get("/api/health", (req, res) => res.json({ status: "ok", service: "digital-life-lessons-api" }))
// Better Auth must receive the unparsed request body.
app.all("/api/auth/{*path}", toNodeHandler(auth))
app.use(express.json({ limit: "32kb" }))
app.use((req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin !== origin) {
    return res.status(403).json({ error: "Request origin is not allowed." })
  }
  next()
})
app.use("/api/images", images)
app.get("/api/home", home)
app.get("/api/profile", profile)
app.use("/api/lessons", lessons)
app.use("/api/my-lessons", myLessons)
app.use("/api/my-favorites", myFavorites)
app.get("/api/authors/:id", authorProfile)
app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }))
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  const status = error.type === "entity.parse.failed" ? 400 : error.type === "entity.too.large" ? 413 : 503
  res.status(status).json({ error: status === 400 ? "Invalid JSON request." : status === 413 ? "Request is too large." : "The service is temporarily unavailable. Please try again." })
})

// Vercel imports this entry point as a request handler.
export default app
