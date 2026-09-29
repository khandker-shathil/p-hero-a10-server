import { CATEGORIES, TONES } from "./lesson-filters.js"

export function lessonInput(body, user, current = null) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid lesson data.")
  const result = {}
  for (const [key, max] of [["title", 160], ["description", 20000]]) {
    if (!current || key in body) {
      if (typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > max) throw new Error(`${key === "title" ? "Title" : "Description"} is required and must be at most ${max} characters.`)
      result[key] = body[key].trim()
    }
  }
  for (const [key, allowed] of [["category", CATEGORIES], ["emotionalTone", TONES], ["visibility", ["public", "private"]], ["accessLevel", ["free", "premium"]]]) {
    if (!current || key in body) {
      const value = body[key] ?? (key === "accessLevel" ? "free" : undefined)
      if (!allowed.includes(value)) throw new Error(`Choose a valid ${key}.`)
      result[key] = value
    }
  }
  if (!user.isPremium && (current ? result.accessLevel && result.accessLevel !== current.accessLevel : result.accessLevel === "premium")) throw new Error("Upgrade to Premium to change lesson access levels.")
  if (!current || "image" in body) {
    if (body.image != null && typeof body.image !== "string") throw new Error("Image must be a URL.")
    const image = (body.image || "").trim()
    if (image.length > 2048) throw new Error("Image URL is too long.")
    if (image) {
      let url
      try { url = new URL(image) } catch { throw new Error("Enter a valid image URL.") }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Image URL must start with http:// or https://.")
    }
    result.image = image || null
  }
  if (!Object.keys(result).length) throw new Error("No editable fields were provided.")
  return result
}

export function canManageLesson(lesson, user) {
  return !!lesson && !!user && (String(lesson.creatorId) === String(user.id) || user.role === "admin")
}
