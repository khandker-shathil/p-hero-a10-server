import { PAGE_SIZE, publicLessonMatch } from "./lesson-filters.js"

const savesLookup = [
  {
    $lookup: {
      from: "favorites",
      let: { lesson: { $toString: "$_id" } },
      pipeline: [
        {
          $match: { $expr: { $eq: [{ $toString: "$lessonId" }, "$$lesson"] } },
        },
        { $group: { _id: { $toString: "$userId" } } },
        { $count: "total" },
      ],
      as: "saves",
    },
  },
  { $set: { savesCount: { $ifNull: [{ $first: "$saves.total" }, 0] } } },
]

export function publicLessonPipeline(filters, user, page) {
  const canRead = {
    $or: [
      { $eq: ["$accessLevel", "free"] },
      { $literal: user?.isPremium === true },
      {
        $eq: [
          { $toString: "$creatorId" },
          { $literal: user?.id ? String(user.id) : "__anonymous__" },
        ],
      },
    ],
  }
  return [
    { $match: publicLessonMatch(filters, user) },
    ...(filters.sort === "most-saved" ? savesLookup : []),
    {
      $sort: {
        ...(filters.sort === "most-saved" ? { savesCount: -1 } : {}),
        createdAt: -1,
        _id: -1,
      },
    },
    { $skip: (page - 1) * PAGE_SIZE },
    { $limit: PAGE_SIZE },
    ...(filters.sort === "newest" ? savesLookup : []),
    {
      $lookup: {
        from: "user",
        let: { creator: { $toString: "$creatorId" } },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: "$_id" }, "$$creator"] } } },
          { $project: { name: 1, image: 1 } },
        ],
        as: "author",
      },
    },
    { $set: { author: { $first: "$author" } } },
    {
      $project: {
        _id: 0,
        id: { $toString: "$_id" },
        title: 1,
        category: 1,
        emotionalTone: 1,
        accessLevel: 1,
        createdAt: 1,
        savesCount: 1,
        creatorId: { $toString: "$creatorId" },
        creatorName: { $ifNull: ["$author.name", "Community member"] },
        creatorImage: { $ifNull: ["$author.image", null] },
        description: {
          $cond: [
            canRead,
            { $substrCP: [{ $ifNull: ["$description", ""] }, 0, 180] },
            "",
          ],
        },
      },
    },
  ]
}

export async function browsePublicLessons(db, filters, user = null) {
  const lessons = db.collection("lessons")
  const total = await lessons.countDocuments(publicLessonMatch(filters, user), {
    maxTimeMS: 5000,
  })
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(filters.page, totalPages)
  const items = total
    ? await lessons
        .aggregate(publicLessonPipeline(filters, user, page), {
          maxTimeMS: 5000,
        })
        .toArray()
    : []
  return { items, total, page, pageSize: PAGE_SIZE, totalPages }
}
