import express from "express"
import { fromNodeHeaders } from "better-auth/node"
import { auth } from "../lib/auth.js"

export const images = express.Router()
const types = ["image/jpeg", "image/png", "image/webp", "image/gif"]
export function matchesImage(buffer, type) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false
  if (type === "image/jpeg") return buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  if (type === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (type === "image/gif") return ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))
  return type === "image/webp" && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP"
}
images.post("/", async (req, res, next) => {
  res.set("Cache-Control", "private, no-store")
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!session) return res.status(401).json({ error: "Please log in to upload an image." })
  if (!process.env.IMGBB_API_KEY) return res.status(503).json({ error: "Image uploads are not configured." })
  if (!types.includes(req.get("Content-Type"))) return res.status(415).json({ error: "Choose a JPEG, PNG, WebP, or GIF image." })
  next()
}, express.raw({ type: types, limit: "5mb", inflate: false }), async (req, res) => {
  const type = req.get("Content-Type")
  if (!matchesImage(req.body, type)) return res.status(400).json({ error: "The file is not a valid image of the selected type." })
  try {
    const form = new FormData()
    form.set("key", process.env.IMGBB_API_KEY)
    form.set("image", req.body.toString("base64"))
    const response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST", body: form, signal: AbortSignal.timeout(30000),
    })
    const result = await response.json()
    const url = new URL(result.data?.url)
    if (!response.ok || !result.success || url.protocol !== "https:" || url.hostname !== "i.ibb.co") throw new Error("Upload rejected")
    res.status(201).json({ url: url.href })
  } catch {
    res.status(502).json({ error: "Couldn’t upload your image. Please try again." })
  }
})
