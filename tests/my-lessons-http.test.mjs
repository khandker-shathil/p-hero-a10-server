import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { app } from "../app.js"
import { auth } from "../lib/auth.js"
import { client, db } from "../lib/db.js"

test("lesson CRUD verifies ownership, ignores forged identity, validates access and cleans related data", async () => {
 const old = { session: auth.api.getSession, connect: client.connect, collection: db.collection }
 let user = null
 let inserted, updated, deleted = false, cleanup = [], listPipeline
 let lesson = { _id: "one", creatorId: "owner", title: "Existing", description: "Story", category: "Career", emotionalTone: "Gratitude", visibility: "private", accessLevel: "free" }
 auth.api.getSession = async () => user ? { user } : null
 client.connect = async () => client
 db.collection = name => ({
  findOne: async () => lesson,
  countDocuments: async () => 1,
  aggregate: stages => { listPipeline = stages; return { toArray: async () => [] } },
  insertOne: async record => { inserted = record; return { insertedId: "new" } },
  updateOne: async (filter, update) => { updated = update; return { modifiedCount: 1 } },
  deleteOne: async () => { deleted = true; return { deletedCount: 1 } },
  deleteMany: async () => { cleanup.push(name); return { deletedCount: 0 } },
 })
 const server = app.listen(0, "127.0.0.1")
 await new Promise(resolve => server.once("listening", resolve))
 const url = `http://127.0.0.1:${server.address().port}/api/my-lessons`
 const request = (path = "", method = "GET", body) => fetch(url + path, { method, headers: { Origin: process.env.CLIENT_URL || "http://localhost:3000", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
 try {
  assert.equal((await request()).status, 401)
  assert.equal((await request("", "POST", {})).status, 401)
  user = { id: "other" }
  for(const [method, body] of [["GET"], ["PATCH", {title:"Forged"}], ["DELETE"]]) assert.equal((await request("/one", method, body)).status, 404)
  assert.equal(deleted, false); assert.equal(updated, undefined)
  user = { id: "owner" }
  assert.equal((await request()).status, 200)
  assert.equal(listPipeline[0].$match.$expr.$eq[1].$literal, "owner")
  assert.equal((await request("/one")).status, 200)
  assert.equal((await request("", "POST", {...lesson, creatorId:"forged", isFeatured:true})).status, 201)
  assert.equal(inserted.creatorId, "owner"); assert.equal(inserted.isFeatured, false)
  assert.deepEqual(inserted.likes, []); assert.ok(inserted.createdAt instanceof Date)
  assert.equal((await request("", "POST", {...lesson,accessLevel:"premium"})).status, 400)
  assert.equal((await request("/one", "PATCH", {accessLevel:"premium"})).status, 400)
  assert.equal((await request("/one", "PATCH", {visibility:"public",creatorId:"forged",isFeatured:true})).status, 200)
  assert.equal(updated.$set.visibility, "public"); assert.ok(!("creatorId" in updated.$set)); assert.ok(!("isFeatured" in updated.$set))
  user.isPremium = true
  assert.equal((await request("/one", "PATCH", {accessLevel:"premium"})).status, 200)
  assert.equal((await request("/one", "DELETE")).status, 200)
  assert.ok(deleted); assert.deepEqual(cleanup.sort(), ["comments","favorites","lessonsReports"].sort())
 } finally {
  await new Promise(resolve => server.close(resolve))
  auth.api.getSession = old.session; client.connect = old.connect; db.collection = old.collection
  await client.close()
 }
})
