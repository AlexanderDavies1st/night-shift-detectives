# Night Shift Detectives

A vanilla HTML/CSS/JavaScript online co-op point-and-click detective game built for Vercel static hosting, using Supabase for Auth, Postgres, Row Level Security, and Realtime.

## Features

- Email/password accounts with secure Supabase Auth
- Unique usernames, nicknames, and public UUID user IDs
- Public searchable statistics page
- 1–6 player private sessions with six-character join codes
- Realtime team chat
- Realtime team room/location display and discovered-room minimap
- Shared evidence/puzzle state
- Point-and-click room navigation
- Morse-code puzzle
- Interactive keyboard lockpicking puzzle
- Security guards with visual + short audio warning before arrival
- Hiding spots (lockers/boxes) to evade guards
- Evidence inventory and objective hints
- Final co-op extraction requiring all evidence and all players at the exit

## Setup

1. Create a free Supabase project.
2. Open **SQL Editor** and run `supabase-schema.sql`.
3. In Supabase, open **Project Settings > API** and copy the Project URL and public anon/publishable key.
4. Put those two public values in `js/config.js`.
5. In **Authentication > URL Configuration**, set your Site URL to your Vercel URL (for local testing, add `http://localhost:3000` as a redirect URL too).
6. Deploy this folder to Vercel. It is a static project and needs no build command.

Do **not** put the Supabase `service_role` secret in this project. The browser should only receive the public anon/publishable key. Security is enforced by Supabase Auth and Row Level Security.

## Local test

From this folder, run one of:

```bash
npx serve .
# or
python -m http.server 3000
```

Do not open `index.html` with `file://`, because browser ES modules require HTTP(S).

## Syntax check

```bash
npm run check
```

## Important production note

This is a complete playable prototype, not an anti-cheat authoritative game server. Because puzzle actions originate in the browser, a determined player can inspect or manipulate client requests. For a larger competitive game, move clue validation, extraction, and stat awarding into Supabase Edge Functions / database RPCs that validate full session state server-side.

## Username-only accounts

The game UI no longer asks players for an email address. Supabase Auth still uses an internal generated identifier behind the scenes, so in your Supabase dashboard go to **Authentication → Sign In / Providers → Email** and turn **Confirm email** off. Supabase documents that disabling Confirm Email allows signup to return a session immediately.

Players enter only:
- Username
- Nickname (signup only)
- Password

Do not put a Supabase secret/service-role key in the website.
