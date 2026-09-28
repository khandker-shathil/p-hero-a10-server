# Digital Life Lessons — Server

Standalone Express 5 API for the Digital Life Lessons Next.js frontend.
Owns Better Auth, MongoDB, public discovery, protected lesson details, likes,
favorites, comments, and reports. Live URL: not deployed yet.

## Run

1. `nvm use` (Node 24), then `npm install`
2. Copy `.env.example` to `.env` and fill in the values.
3. `npm run dev` (port 5005 by default).
4. Start the Next.js frontend with `API_SERVER_URL=http://localhost:5005`.

Keep CLIENT_URL and BETTER_AUTH_URL set to the public frontend origin. Next.js
proxies `/api/*` to this server; login cookies and Google redirects therefore
remain same-origin in the browser. Google OAuth callback:
`http://localhost:3000/api/auth/callback/google` (replace origin in production).
Set API_SERVER_URL before building/deploying the frontend. Deploy this server
separately as a persistent Node service, with the same MongoDB and auth secret
as before to preserve existing accounts/sessions. Never put credentials in
NEXT_PUBLIC_ variables. Do not expose a public wildcard CORS origin.

## Endpoints

- GET `/api/health`
- ALL `/api/auth/*` — Better Auth
- GET `/api/home` — featured, most saved, contributors
- GET `/api/authors/:id` — public author profile and lessons
- GET `/api/lessons` — public search/filter/sort/pagination
- GET `/api/lessons/:id` — session- and content-protected full lesson
- POST `/api/lessons/:id/like` — atomic like toggle
- PUT/DELETE `/api/lessons/:id/favorite` — save/remove
- GET/POST `/api/lessons/:id/comments` — paginated comments/post
- POST `/api/lessons/:id/reports` — report with fixed reason choices

All detail and engagement endpoints verify the session and lesson access.
Private lessons return 404 for other users. Premium stories require premium
membership or ownership. Public APIs whitelist fields and never expose private
stories, emails, or premium content to anonymous/free users.

Packages: Express, cors, dotenv, Better Auth, its MongoDB adapter, mongodb.

## Tests

`npm test`

Read-only MongoDB query fixtures (no inserted records):
`RUN_MONGO_TESTS=1 node --env-file=.env --test tests/public-lessons.test.mjs`

CRUD dashboards, Stripe, admin moderation are remaining
features. This migration preserves the existing database; it does not create
sample lessons or change user roles.
