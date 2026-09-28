import "dotenv/config"
import { app } from "./app.js"
import { client } from "./lib/db.js"

const port = Number(process.env.PORT || 5005)
const server = app.listen(port, (error) => { if (error) { console.error("Server failed to start:", error.code); process.exit(1) } console.log(`Digital Life Lessons API listening on port ${port}`) })
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(async () => { await client.close(); process.exit(0) }))
}
