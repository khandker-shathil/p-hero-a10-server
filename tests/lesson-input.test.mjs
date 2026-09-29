import test from "node:test"
import assert from "node:assert/strict"
import { lessonInput, canManageLesson } from "../lib/lesson-input.js"
const valid = { title: " A lesson ", description: " An insight ", category: "Career", emotionalTone: "Gratitude", visibility: "private", accessLevel: "free" }
test("creation validates fields and excludes ownership/admin fields", () => {
 const result = lessonInput({ ...valid, creatorId: "forged", isFeatured: true, likes: ["forged"] }, { id: "reader" })
 assert.equal(result.title, "A lesson"); assert.equal(result.image, null)
 assert.ok(!("creatorId" in result)); assert.ok(!("isFeatured" in result)); assert.ok(!("likes" in result))
 for(const fields of [{ title: " " }, { category: "unknown" }, { emotionalTone: "unknown" }, { visibility: "unknown" }, { image: "javascript:alert(1)" }]) assert.throws(() => lessonInput({ ...valid, ...fields }, {}))
})
test("premium permission is enforced independently of the UI", () => {
 assert.throws(() => lessonInput({ ...valid, accessLevel: "premium" }, {}))
 assert.equal(lessonInput({ ...valid, accessLevel: "premium" }, { isPremium: true }).accessLevel, "premium")
 assert.throws(() => lessonInput({ accessLevel: "premium" }, {}, valid))
 assert.deepEqual(lessonInput({ visibility: "public" }, {}, valid), { visibility: "public" })
 assert.equal(lessonInput({ ...valid, accessLevel: "premium" }, {}, { ...valid, accessLevel: "premium" }).accessLevel, "premium")
})
test("only owners and admins may manage existing lessons", () => {
 assert.equal(canManageLesson({ creatorId: "owner" }, { id: "other" }), false)
 assert.equal(canManageLesson({ creatorId: "owner" }, { id: "owner" }), true)
 assert.equal(canManageLesson({ creatorId: "owner" }, { id: "admin", role: "admin" }), true)
 assert.equal(canManageLesson(null, { role: "admin" }), false)
})
