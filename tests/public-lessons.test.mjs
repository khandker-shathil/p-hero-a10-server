import test from "node:test"
import assert from "node:assert/strict"
import {
  parseLessonFilters,
  lessonSearchParams,
  publicLessonMatch,
} from "../lib/lesson-filters.js"
import {
  browsePublicLessons,
  publicLessonPipeline,
} from "../lib/public-lessons.js"

const defaults = parseLessonFilters(new URLSearchParams())

test("validates filter choices and bounds untrusted pagination/search", () => {
  const filters = parseLessonFilters(
    new URLSearchParams({
      q: " x ",
      category: "injected",
      tone: "wrong",
      sort: "bad",
      page: "-4",
    })
  )
  assert.deepEqual(filters, {
    q: "x",
    category: "",
    tone: "",
    sort: "newest",
    page: 1,
  })
  assert.equal(
    parseLessonFilters(new URLSearchParams({ page: "Infinity" })).page,
    1
  )
  assert.equal(
    parseLessonFilters(new URLSearchParams({ page: "99999999" })).page,
    100000
  )
  assert.equal(
    parseLessonFilters(new URLSearchParams({ q: "a".repeat(150) })).q.length,
    100
  )
})

test("preserves filters and pagination in shareable URLs", () => {
  const filters = {
    q: "A & B",
    category: "Career",
    tone: "Gratitude",
    sort: "most-saved",
    page: 2,
  }
  assert.deepEqual(parseLessonFilters(lessonSearchParams(filters)), filters)
})

test("keyword search treats regex syntax literally and always restricts visibility", () => {
  const match = publicLessonMatch({ ...defaults, q: ".*" })
  assert.equal(match.visibility, "public")
  assert.equal(match.$or[0].title.$regex, "\\.\\*")
})

test("out-of-range pages clamp to the final available page", async () => {
  let pipeline
  const db = {
    collection: () => ({
      countDocuments: async () => 12,
      aggregate: (stages) => {
        pipeline = stages
        return { toArray: async () => [] }
      },
    }),
  }
  const result = await browsePublicLessons(db, { ...defaults, page: 500 })
  assert.equal(result.page, 2)
  assert.equal(result.totalPages, 2)
  assert.equal(pipeline.find((stage) => stage.$skip !== undefined).$skip, 9)
})

test("empty collection returns usable pagination without querying card data", async () => {
  const db = { collection: () => ({ countDocuments: async () => 0 }) }
  const result = await browsePublicLessons(db, { ...defaults, page: 9 })
  assert.deepEqual(result, {
    items: [],
    total: 0,
    page: 1,
    pageSize: 9,
    totalPages: 1,
  })
})

test(
  "MongoDB fixture checks: public access, search, sorting, pagination and premium previews",
  { skip: process.env.RUN_MONGO_TESTS !== "1" },
  async () => {
    const { getDatabase } = await import("../lib/db.js")
    const db = await getDatabase()
    const fixtures = Array.from({ length: 12 }, (_, i) => ({
      _id: String(i),
      title: `Lesson ${i}`,
      creatorId: "author",
      visibility: "public",
      accessLevel: "free",
      description: `Reflection ${i}`,
      category: i % 2 ? "Career" : "Mindset",
      emotionalTone: "Gratitude",
      createdAt: new Date(2026, 0, i + 1),
      secret: "must not escape",
    }))
    fixtures.push({
      _id: "private",
      title: "Private hidden",
      visibility: "private",
      accessLevel: "free",
      description: "private text",
      creatorId: "author",
      createdAt: new Date(2026, 1, 1),
    })
    fixtures.push({
      _id: "premium",
      title: "Premium reflection",
      visibility: "public",
      accessLevel: "premium",
      description: "premium-secret-keyword",
      creatorId: "author",
      createdAt: new Date(2026, 1, 2),
    })
    const favorites = [
      { lessonId: "0", userId: "one" },
      { lessonId: "0", userId: "one" },
      { lessonId: "0", userId: "two" },
      { lessonId: "1", userId: "one" },
    ]
    async function run(filters = defaults, user = null, page = 1) {
      const pipeline = publicLessonPipeline(filters, user, page).map(
        (stage) => {
          if (!stage.$lookup) return stage
          const { from, ...lookup } = stage.$lookup
          const documents =
            from === "favorites"
              ? favorites
              : [
                  {
                    _id: "author",
                    name: "Test Author",
                    image: "https://example.com/avatar.png",
                    email: "private@example.com",
                  },
                ]
          return {
            $lookup: {
              ...lookup,
              pipeline: [{ $documents: documents }, ...lookup.pipeline],
            },
          }
        }
      )
      // $documents provides isolated fixtures. This test never writes to the database.
      return db.aggregate([{ $documents: fixtures }, ...pipeline]).toArray()
    }
    try {
      const page1 = await run()
      const page2 = await run(defaults, null, 2)
      assert.equal(page1.length, 9)
      assert.equal(page2.length, 4)
      assert.equal(new Set([...page1, ...page2].map((x) => x.id)).size, 13)
      assert.ok(![...page1, ...page2].some((x) => x.id === "private"))
      assert.equal(page1[0].id, "premium")
      assert.equal(page1[0].description, "")
      assert.ok(page1.every((x) => !("secret" in x) && !("email" in x)))
      assert.equal(page1[0].creatorName, "Test Author")
      assert.equal(
        (await run(defaults, { id: "author" }))[0].description,
        "premium-secret-keyword"
      )
      assert.equal(
        (await run(defaults, { id: "other", isPremium: true }))[0].description,
        "premium-secret-keyword"
      )
      assert.equal(
        (await run({ ...defaults, q: "premium-secret-keyword" })).length,
        0
      )
      assert.equal(
        (
          await run(
            { ...defaults, q: "premium-secret-keyword" },
            { id: "author" }
          )
        ).length,
        1
      )
      assert.equal((await run({ ...defaults, q: ".*" })).length, 0)
      const filtered = await run({
        ...defaults,
        category: "Career",
        tone: "Gratitude",
        q: "Reflection",
      })
      assert.equal(filtered.length, 6)
      const sorted = await run({ ...defaults, sort: "most-saved" })
      assert.equal(sorted[0].id, "0")
      assert.equal(sorted[0].savesCount, 2)
      assert.equal(sorted[1].id, "1")
    } finally {
      await (await import("../lib/db.js")).client.close()
    }
  }
)
