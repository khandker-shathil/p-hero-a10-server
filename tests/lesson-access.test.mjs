import test from "node:test"
import assert from "node:assert/strict"
import { lessonAccess } from "../lib/lesson-access.js"
const lesson = { creatorId: "owner", visibility: "public", accessLevel: "free" }
test("detail authorization does not leak private or premium lessons", () => {
  assert.equal(lessonAccess(lesson, null), 200)
  assert.equal(lessonAccess({ ...lesson, visibility: "private" }, null), 404)
  assert.equal(lessonAccess({ ...lesson, accessLevel: "premium" }, null), 401)
  assert.equal(lessonAccess(null, { id: "other" }), 404)
  assert.equal(lessonAccess(lesson, { id: "other" }), 200)
  assert.equal(lessonAccess({ ...lesson, visibility: "private" }, { id: "other", isPremium: true }), 404)
  assert.equal(lessonAccess({ ...lesson, visibility: "private" }, { id: "owner" }), 200)
  assert.equal(lessonAccess({ ...lesson, accessLevel: "premium" }, { id: "other" }), 403)
  assert.equal(lessonAccess({ ...lesson, accessLevel: "premium" }, { id: "owner" }), 200)
  assert.equal(lessonAccess({ ...lesson, accessLevel: "premium" }, { id: "other", isPremium: true }), 200)
})
