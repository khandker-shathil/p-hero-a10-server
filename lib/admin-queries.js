import { CATEGORIES } from "./lesson-filters.js"

export const dateField = { $convert: { input: "$createdAt", to: "date", onError: null, onNull: null } }
export const reportLookup = [
  { $lookup: { from: "lessonsReports", let: { id: { $toString: "$_id" } }, pipeline: [
    { $match: { $expr: { $eq: [{ $toString: "$lessonId" }, "$$id"] } } }, { $count: "total" },
  ], as: "reports" } },
  { $set: { reportCount: { $ifNull: [{ $first: "$reports.total" }, 0] } } },
]
export function adminLessonFilters(query) {
  const match = {}
  if (CATEGORIES.includes(query.category)) match.category = query.category
  if (["public", "private"].includes(query.visibility)) match.visibility = query.visibility
  const stages = [{ $match: match }, ...reportLookup]
  if (query.flags === "flagged") stages.push({ $match: { reportCount: { $gt: 0 } } })
  if (query.flags === "unflagged") stages.push({ $match: { reportCount: 0 } })
  return stages
}
export function utcWindow(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { today, start: new Date(today.getTime() - 29 * 86400000), end: new Date(today.getTime() + 86400000) }
}
export function growthPipeline(start, end) {
  return [
    { $set: { day: dateField } }, { $match: { day: { $gte: start, $lt: end } } },
    { $group: { _id: { $dateToString: { date: "$day", format: "%Y-%m-%d", timezone: "UTC" } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]
}
export function fillGrowth(rows, start) {
  const counts = new Map(rows.map(row => [row._id, row.count]))
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10)
    return { date, count: counts.get(date) || 0 }
  })
}
export async function aggregatePage(db, collection, base, pageValue, project, sort = { _id: -1 }) {
  const totals = await db.collection(collection).aggregate([...base, { $count: "total" }], { maxTimeMS: 10000 }).toArray()
  const total = totals[0]?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / 10))
  const requested = Number(pageValue)
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, totalPages) : 1
  const items = total ? await db.collection(collection).aggregate([
    ...base, { $sort: sort }, { $skip: (page - 1) * 10 }, { $limit: 10 }, ...project,
  ], { maxTimeMS: 10000 }).toArray() : []
  return { items, total, page, totalPages }
}
