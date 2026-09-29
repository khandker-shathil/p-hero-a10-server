import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../app.js'
import { auth } from '../lib/auth.js'

test('image endpoint authenticates, validates uploads, and hides provider secrets', async () => {
 const originalFetch=globalThis.fetch, originalSession=auth.api.getSession, originalKey=process.env.IMGBB_API_KEY
 let signedIn=false, providerFails=false, calls=0
 process.env.IMGBB_API_KEY='test-key'
 auth.api.getSession=async()=>signedIn?{user:{id:'reader'}}:null
 globalThis.fetch=async(url,options)=>{
  if(String(url)!=='https://api.imgbb.com/1/upload') return originalFetch(url,options)
  calls++
  assert.equal(options.body.get('key'),'test-key')
  assert.ok(options.body.get('image'))
  if(providerFails) return Response.json({error:{message:'secret-provider-details'}},{status:400})
  return Response.json({success:true,data:{url:'https://i.ibb.co/test/photo.png',delete_url:'secret-delete-url'}})
 }
 const server=app.listen(0,'127.0.0.1')
 await new Promise(resolve=>server.once('listening',resolve))
 const url=`http://127.0.0.1:${server.address().port}/api/images`
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')
 const send=(body=png,type='image/png',origin='http://localhost:3000')=>originalFetch(url,{method:'POST',headers:{'Content-Type':type,Origin:origin},body})
 try {
  assert.equal((await send()).status,401)
  signedIn=true
  assert.equal((await send(png,'image/png','https://evil.example')).status,403)
  assert.equal((await send(png,'image/svg+xml')).status,415)
  assert.equal((await send(Buffer.from('not an actual png image'))).status,400)
  assert.equal((await send(Buffer.alloc(5*1024*1024+1))).status,413)
  assert.equal(calls,0)
  const response=await send();assert.equal(response.status,201)
  assert.deepEqual(await response.json(),{url:'https://i.ibb.co/test/photo.png'})
  providerFails=true
  const failed=await send();assert.equal(failed.status,502)
  assert.ok(!JSON.stringify(await failed.json()).includes('secret'))
  delete process.env.IMGBB_API_KEY
  assert.equal((await send()).status,503)
 } finally {
  globalThis.fetch=originalFetch;auth.api.getSession=originalSession
  if(originalKey===undefined) delete process.env.IMGBB_API_KEY;else process.env.IMGBB_API_KEY=originalKey
  await new Promise(resolve=>server.close(resolve))
 }
})
