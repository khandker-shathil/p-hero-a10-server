export const CATEGORIES = [
  "Personal Growth",
  "Career",
  "Relationships",
  "Mindset",
  "Mistakes Learned",
]
export const TONES = ["Motivational", "Sad", "Realization", "Gratitude"]
export const PAGE_SIZE = 9

export function parseLessonFilters(params) {
  const value = (key) =>
    typeof params.get(key) === "string" ? params.get(key) : ""
  const rawPage = value("page")
  return {
    q: value("q").trim().slice(0, 100),
    category: CATEGORIES.includes(value("category")) ? value("category") : "",
    tone: TONES.includes(value("tone")) ? value("tone") : "",
    sort: value("sort") === "most-saved" ? "most-saved" : "newest",
    page: /^\d+$/.test(rawPage)
      ? Math.max(1, Math.min(100000, Number(rawPage)))
      : 1,
  }
}

export function lessonSearchParams(filters) {
  const params = new URLSearchParams()
  if (filters.q) params.set("q", filters.q)
  if (filters.category) params.set("category", filters.category)
  if (filters.tone) params.set("tone", filters.tone)
  if (filters.sort === "most-saved") params.set("sort", filters.sort)
  if (filters.page > 1) params.set("page", String(filters.page))
  return params
}

export function publicLessonMatch(filters, user = null) {
  const match = {
    visibility: "public",
    accessLevel: { $in: ["free", "premium"] },
  }
  if (filters.author) match.$expr = { $eq: [{ $toString: "$creatorId" }, { $literal: String(filters.author) }] }
  if (filters.category) match.category = filters.category
  if (filters.tone) match.emotionalTone = filters.tone
  if (filters.q) {
    const regex = {
      $regex: filters.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    }
    const access = user?.isPremium
      ? {}
      : {
          $or: [
            { accessLevel: "free" },
            ...(user?.id
              ? [
                  {
                    $expr: {
                      $eq: [{ $toString: "$creatorId" }, String(user.id)],
                    },
                  },
                ]
              : []),
          ],
        }
    match.$or = [
      { title: regex },
      { category: regex },
      { emotionalTone: regex },
      { $and: [access, { description: regex }] },
    ]
  }
  return match
}
