export function profileInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid profile data.")
  if (Object.keys(body).some(key => !["name", "image"].includes(key))) throw new Error("Only your display name and photo can be edited here.")
  const result = {}
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100) throw new Error("Enter a display name between 1 and 100 characters.")
    result.name = body.name.trim()
  }
  if ("image" in body) {
    if (body.image != null && typeof body.image !== "string") throw new Error("Enter a valid photo URL.")
    const image = (body.image || "").trim()
    if (image.length > 2048) throw new Error("Photo URL is too long.")
    if (image) {
      let url
      try { url = new URL(image) } catch { throw new Error("Enter a valid photo URL.") }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Photo URL must start with http:// or https://.")
    }
    result.image = image || null
  }
  if (!Object.keys(result).length) throw new Error("No profile changes were provided.")
  return result
}
