# Arabic Coach App

**Version 0.2:** the full Arabic Coach (Words, Test, Chats, Drive, Study, Review, Forms, Talk, Ask) runs as `public/coach.html`. `public/claude-shim.js` gives it two services: `db` (each learner's saved data in the Supabase table `docs`) and `sample` (the Supabase Edge Function `sample`, which asks Claude). `app/page.js` is the sign-in page.

Saudi spoken Arabic for expat professionals, explained in Hindi, Urdu or English. Version 0.1 (testing).

## What's in version 0.1
- Sign in with an email code (Supabase Auth)
- Setup: explanation language and goal (customers or staff)
- Learn: 1,000 core Saudi words, 10 a day on the free plan
- Review: spaced review in 5 boxes (1, 3, 7, 16, 35 days)
- Talk: 100 role-play scenes with corrections (Claude Haiku 5.5)
- "Why does it work?" explanations in the learner's language (Claude Sonnet 5.5, cached for everyone)
- Free plan limit: 25 coach replies a day; usage and token cost logged per learner per day
- Installs to the phone home screen (web app manifest)

## Setup (done by Claude through the Supabase connector)
- Database tables and security rules: `supabase/schema.sql` (applied as migration `initial_schema`)
- AI function: `supabase/functions/ai/index.ts`, deployed as the Supabase Edge Function `ai`
- Owner adds one secret in Supabase: Edge Functions -> Secrets -> `ANTHROPIC_API_KEY`
- Hosting: import this repo on Vercel and tap Deploy (no settings needed)

## Code map
- `app/page.js`: the whole phone app (sign in, setup, Learn, Review, Talk, Me)
- `supabase/functions/ai/index.ts`: the only place that calls Claude; checks sign-in, plan limits, logs usage
- `lib/core.js`: the 1,000 words; `lib/chats.js`: the 100 scenes
- `supabase/schema.sql`: tables and security rules

## Run locally
`npm install`, then `npm run dev`.
