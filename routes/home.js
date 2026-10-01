import { getDatabase } from "../lib/db.js"

const authorLookup = [
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
]
const cardProjection = {
  _id: 0,
  id: { $toString: "$_id" },
  title: 1,
  category: 1,
  emotionalTone: 1,
  accessLevel: 1,
  createdAt: 1,
  savesCount: { $ifNull: ["$savesCount", 0] },
  creatorId: { $toString: "$creatorId" },
  creatorName: { $ifNull: ["$author.name", "Community member"] },
  creatorImage: { $ifNull: ["$author.image", null] },
  description: {
    $cond: [
      { $eq: ["$accessLevel", "free"] },
      { $substrCP: [{ $ifNull: ["$description", ""] }, 0, 180] },
      "",
    ],
  },
}

export async function home(req, res) {
  try {
    const db = await getDatabase()
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const publicFilter = {
      visibility: "public",
      accessLevel: { $in: ["free", "premium"] },
    }
    const [featured, mostSaved, contributors] = await Promise.all([
      db
        .collection("lessons")
        .aggregate(
          [
            { $match: { ...publicFilter, isFeatured: true } },
            { $sort: { createdAt: -1, _id: -1 } },
            { $limit: 3 },
            ...authorLookup,
            { $project: cardProjection },
          ],
          { maxTimeMS: 5000 }
        )
        .toArray(),
      db
        .collection("lessons")
        .aggregate(
          [
            { $match: publicFilter },
            {
              $lookup: {
                from: "favorites",
                let: { lesson: { $toString: "$_id" } },
                pipeline: [
                  {
                    $match: {
                      $expr: { $eq: [{ $toString: "$lessonId" }, "$$lesson"] },
                    },
                  },
                  { $group: { _id: "$userId" } },
                  { $count: "total" },
                ],
                as: "saves",
              },
            },
            {
              $set: {
                savesCount: { $ifNull: [{ $first: "$saves.total" }, 0] },
              },
            },
            { $match: { savesCount: { $gt: 0 } } },
            { $sort: { savesCount: -1, createdAt: -1, _id: -1 } },
            { $limit: 3 },
            ...authorLookup,
            { $project: cardProjection },
          ],
          { maxTimeMS: 5000 }
        )
        .toArray(),
      db
        .collection("lessons")
        .aggregate(
          [
            {
              $match: {
                ...publicFilter,
                createdAt: { $gte: weekStart },
                creatorId: { $ne: null },
              },
            },
            {
              $group: {
                _id: { $toString: "$creatorId" },
                lessonCount: { $sum: 1 },
              },
            },
            { $sort: { lessonCount: -1, _id: 1 } },
            { $limit: 4 },
            { $set: { creatorId: "$_id" } },
            ...authorLookup,
            {
              $project: {
                _id: 0,
                id: "$_id",
                lessonCount: 1,
                name: { $ifNull: ["$author.name", "Community member"] },
                image: { $ifNull: ["$author.image", null] },
              },
            },
          ],
          { maxTimeMS: 5000 }
        )
        .toArray(),
    ])
    return res.set("Cache-Control", "no-store").json({ featured, mostSaved, contributors })
  } catch {
    return res.status(503).json({ error: "Community lessons are temporarily unavailable. Please try again." })
  }
}
