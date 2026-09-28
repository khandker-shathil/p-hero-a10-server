import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { mongodbAdapter } from "better-auth/adapters/mongodb"
import { passwordError } from "./auth-validation.js"
import { client, db } from "./db.js"

export const auth = betterAuth({
  database: mongodbAdapter(db, { client, transaction: false }),
  baseURL: process.env.BETTER_AUTH_URL || process.env.CLIENT_URL,
  trustedOrigins: [process.env.CLIENT_URL || "http://localhost:3000"],
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    maxPasswordLength: 128,
    requireEmailVerification: false,
    autoSignIn: true,
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
      isPremium: { type: "boolean", defaultValue: false, input: false },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        const error = passwordError(ctx.body?.password)
        if (error) throw new APIError("BAD_REQUEST", { message: error })
        if (typeof ctx.body?.name !== "string" || !ctx.body.name.trim()) {
          throw new APIError("BAD_REQUEST", {
            message: "Please enter your name.",
          })
        }
      }
    }),
  },
  socialProviders:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {},
})
