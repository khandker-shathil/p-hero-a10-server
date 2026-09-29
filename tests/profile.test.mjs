import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { profileInput } from "../lib/profile-input.js"
import { app } from "../app.js"
import { auth } from "../lib/auth.js"
import { client, db } from "../lib/db.js"

test("profile edits accept only validated name and image fields", () => {
 assert.deepEqual(profileInput({name:"  Reader  ",image:""}),{name:"Reader",image:null})
 assert.deepEqual(profileInput({image:"https://example.com/photo.jpg"}),{image:"https://example.com/photo.jpg"})
 for(const body of [{name:" "},{name:"a".repeat(101)},{image:"javascript:alert(1)"},{image:"not a URL"},{image:123},{email:"new@example.com"},{role:"admin"},{isPremium:true},{id:"someone-else"},{}]) assert.throws(()=>profileInput(body))
})

test("Better Auth applies profile validation before an update can reach the database", async () => {
 for(const body of [{name:" "},{image:"javascript:alert(1)"},{email:"new@example.com"},{role:"admin"},{isPremium:true}]) {
  await assert.rejects(auth.api.updateUser({body}),error=>error.statusCode===400)
 }
})

test("profile endpoint returns only the signed-in user's counts and newest public lessons", async () => {
 const old={session:auth.api.getSession,connect:client.connect,collection:db.collection}
 let user=null
 const counts=[],pipelines=[]
 auth.api.getSession=async()=>user?{user,session:{token:"private-token"}}:null
 client.connect=async()=>client
 db.collection=name=>({
  countDocuments:async filter=>{counts.push(filter);return filter.visibility==="public"?2:5},
  aggregate:pipeline=>{pipelines.push({name,pipeline});return{toArray:async()=>name==="favorites"?[{total:3}]:[]}},
 })
 const server=app.listen(0,"127.0.0.1")
 await new Promise(resolve=>server.once("listening",resolve))
 const url=`http://127.0.0.1:${server.address().port}/api/profile?userId=forged&sort=most-saved`
 try {
  assert.equal((await fetch(url)).status,401)
  user={id:"reader",name:"Reader",email:"reader@example.com",role:"user",isPremium:false,extra:"private"}
  const response=await fetch(url);assert.equal(response.status,200)
  assert.equal(response.headers.get("cache-control"),"private, no-store")
  const result=await response.json()
  assert.equal(result.user.id,"reader");assert.ok(!("extra" in result.user));assert.ok(!("session" in result))
  assert.deepEqual(result.stats,{lessonsCreated:5,lessonsSaved:3})
  assert.equal(counts[0].$expr.$eq[1].$literal,"reader")
  const publicFilter=counts.find(x=>x.visibility==="public")
  assert.equal(publicFilter.$expr.$eq[1].$literal,"reader")
  const lessonPipeline=pipelines.find(x=>x.name==="lessons").pipeline
  assert.deepEqual(lessonPipeline.find(x=>x.$sort).$sort,{createdAt:-1,_id:-1})
  const favorites=pipelines.find(x=>x.name==="favorites").pipeline
  assert.equal(favorites[0].$match.$expr.$eq[1].$literal,"reader")
  assert.ok(favorites.some(x=>x.$group))
 } finally {
  await new Promise(resolve=>server.close(resolve))
  auth.api.getSession=old.session;client.connect=old.connect;db.collection=old.collection
  await client.close()
 }
})
