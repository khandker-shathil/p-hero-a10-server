export function favoriteMatch(userId, lessonId) {
  return { $expr: { $and: [
    { $eq: [{ $toString: "$userId" }, { $literal: String(userId) }] },
    ...(lessonId ? [{ $eq: [{ $toString: "$lessonId" }, { $literal: String(lessonId) }] }] : []),
  ] } }
}

export function favoritesPipeline(user, filters = {}) {
  return [
    { $match: favoriteMatch(user.id) },
    { $group: { _id: { $toString: "$lessonId" }, savedAt: { $max: "$savedAt" } } },
    { $lookup: { from: "lessons", let: { lesson: "$_id" }, pipeline: [
      { $match: { $expr: { $and: [
        { $eq: [{ $toString: "$_id" }, "$$lesson"] },
        { $or: [{ $eq: ["$visibility", "public"] }, { $eq: [{ $toString: "$creatorId" }, { $literal: String(user.id) }] }] },
      ] } } },
      { $project: { title: 1, category: 1, emotionalTone: 1, accessLevel: 1, creatorId: 1 } },
    ], as: "lesson" } },
    { $set: { lesson: { $first: "$lesson" } } },
    ...(filters.category ? [{ $match: { "lesson.category": filters.category } }] : []),
    ...(filters.tone ? [{ $match: { "lesson.emotionalTone": filters.tone } }] : []),
  ]
}

export const favoriteProjection = user => ({
  _id: 0, id: "$_id", savedAt: 1,
  title: { $ifNull: ["$lesson.title", "Lesson unavailable"] },
  category: { $ifNull: ["$lesson.category", null] },
  emotionalTone: { $ifNull: ["$lesson.emotionalTone", null] },
  accessLevel: { $ifNull: ["$lesson.accessLevel", null] },
  available: { $ne: [{ $ifNull: ["$lesson._id", null] }, null] },
  locked: { $and: [
    { $eq: ["$lesson.accessLevel", "premium"] },
    { $literal: !user.isPremium },
    { $ne: [{ $toString: "$lesson.creatorId" }, { $literal: String(user.id) }] },
  ] },
})
