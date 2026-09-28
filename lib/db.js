import { MongoClient } from "mongodb"

if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI in the server .env file")
export const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
export const db = client.db(process.env.MONGODB_DB_NAME || "digital-life-lesson")
export async function getDatabase() {
  await client.connect()
  return db
}
