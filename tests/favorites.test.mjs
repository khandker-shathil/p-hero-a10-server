import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { app } from "../app.js"
import { auth } from "../lib/auth.js"
import { client, db } from "../lib/db.js"
import { favoritesPipeline, favoriteProjection } from "../lib/favorites-query.js"

test("favorites API requires a session, scopes filters and removal to its user", async () => {
 const old = { session: auth.api.getSession, connect: client.connect, collection: db.collection }
 let user = null, removed, pipelines = []
 auth.api.getSession = async () => user ? { user } : null
 client.connect = async () => client
 db.collection = () => ({
  aggregate: pipeline => { pipelines.push(pipeline); return { toArray: async () => pipeline.at(-1).$count ? [{ total: 12 }] : [] } },
  deleteMany: async filter => { removed = filter; return { deletedCount: 1 } },
 })
 const server = app.listen(0, "127.0.0.1")
 await new Promise(resolve => server.once("listening", resolve))
 const url = `http://127.0.0.1:${server.address().port}/api/my-favorites`
 const request = (path = "", method = "GET") => fetch(url+path, { method, headers: { Origin: process.env.CLIENT_URL || "http://localhost:3000" } })
 try {
  assert.equal((await request()).status, 401)
  assert.equal((await request("/gone", "DELETE")).status, 401)
  user = { id: "reader" }
  const response = await request("?category=Career&tone=Gratitude&page=999&userId=forged")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal((await response.json()).page, 2)
  assert.equal(pipelines[0][0].$match.$expr.$and[0].$eq[1].$literal, "reader")
  assert.ok(pipelines[0].some(x => x.$match?.["lesson.category"] === "Career"))
  assert.ok(pipelines[0].some(x => x.$match?.["lesson.emotionalTone"] === "Gratitude"))
  assert.equal(pipelines[1].find(x => x.$skip !== undefined).$skip, 10)
  assert.equal((await request("/gone", "DELETE")).status, 200)
  assert.equal(removed.$expr.$and[0].$eq[1].$literal, "reader")
  assert.equal(removed.$expr.$and[1].$eq[1].$literal, "gone")
 } finally {
  await new Promise(resolve => server.close(resolve))
  auth.api.getSession = old.session; client.connect = old.connect; db.collection = old.collection
  await client.close()
 }
})

test("MongoDB favorites fixtures hide private metadata, deduplicate saves and filter correctly", { skip: process.env.RUN_MONGO_TESTS !== "1" }, async () => {
 const fixtures = [
  { lessonId:"free", userId:"reader", savedAt:new Date() },
  { lessonId:"free", userId:"reader", savedAt:new Date() },
  { lessonId:"premium", userId:"reader", savedAt:new Date() },
  { lessonId:"private", userId:"reader", savedAt:new Date() },
  { lessonId:"gone", userId:"reader", savedAt:new Date() },
  { lessonId:"other", userId:"someone-else", savedAt:new Date() },
 ]
 const lessonFixtures = [
  { _id:"free", title:"Free lesson", category:"Career", emotionalTone:"Gratitude", visibility:"public", accessLevel:"free", creatorId:"owner" },
  { _id:"premium", title:"Premium lesson", category:"Mindset", emotionalTone:"Realization", visibility:"public", accessLevel:"premium", creatorId:"owner", description:"secret story" },
  { _id:"private", title:"private secret title", category:"Career", visibility:"private", accessLevel:"free", creatorId:"owner" },
 ]
 await client.connect()
 try {
  async function run(user, filters={}) {
   const stages=favoritesPipeline(user,filters).map(stage => {
    if(!stage.$lookup) return stage
    const {from,...lookup}=stage.$lookup
    assert.equal(from,"lessons")
    return {$lookup:{...lookup,pipeline:[{$documents:lessonFixtures},...lookup.pipeline]}}
   })
   return db.aggregate([{$documents:fixtures},...stages,{$project:favoriteProjection(user)}]).toArray()
  }
  const rows=await run({id:"reader"})
  assert.equal(rows.length,4)
  assert.equal(rows.find(x=>x.id==="premium").locked,true)
  assert.equal(rows.find(x=>x.id==="private").title,"Lesson unavailable")
  assert.equal(rows.find(x=>x.id==="gone").available,false)
  assert.ok(rows.every(x=>!("description" in x)))
  assert.equal((await run({id:"reader",isPremium:true})).find(x=>x.id==="premium").locked,false)
  assert.equal((await run({id:"reader"},{category:"Career",tone:"Gratitude"})).length,1)
 } finally {await client.close()}
})
