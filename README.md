# Arabic Coach App

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

## Setup (once)
1. **Supabase:** create a project, open SQL Editor, paste `supabase/schema.sql`, Run.
2. **Supabase sign-in email:** Authentication → Emails → "Magic Link" template: make sure it contains `{{ .Token }}` so learners get a 6-digit code (the link also works).
3. **Supabase URLs:** Authentication → URL Configuration → Site URL = your Vercel address.
4. **Vercel:** import this repo and add the 4 variables from `.env.example` (Project URL, anon key, service_role key, Anthropic API key).

## Code map
- `app/page.js`: the whole phone app (sign in, setup, Learn, Review, Talk, Me)
- `app/api/ai/route.js`: the only place that calls Claude; checks sign-in, plan limits, logs usage
- `lib/core.js`: the 1,000 words; `lib/chats.js`: the 100 scenes
- `supabase/schema.sql`: tables and security rules

## Run locally
`npm install`, copy `.env.example` to `.env.local` with real values, then `npm run dev`.
