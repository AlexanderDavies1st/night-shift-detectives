# Night Shift Detectives

A vanilla HTML/CSS/JavaScript online co-op point-and-click detective game built for Vercel static hosting, using Supabase for Auth, Postgres, Row Level Security, and Realtime.

## Features

- Username/password player accounts without an email field in the UI
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
6. In **Authentication > Sign In / Providers > Email**, disable **Confirm email**. The game does not ask players for an email and therefore cannot deliver a confirmation message.
7. Deploy this folder to Vercel. It is a static project and needs no build command.

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

## Error codes

Authentication errors shown by the game use stable codes so they can be reported without copying the entire message:

- `NSD-AUTH-001` — invalid username
- `NSD-AUTH-002` — invalid nickname
- `NSD-AUTH-003` — invalid password
- `NSD-AUTH-004` — Supabase rate limit
- `NSD-AUTH-005` — username already taken
- `NSD-AUTH-006` — invalid login credentials
- `NSD-AUTH-007` — Supabase rejected the internal auth identifier
- `NSD-AUTH-008` — other signup failure
- `NSD-AUTH-009` — profile could not be loaded
- `NSD-AUTH-010` — signup succeeded but no session was returned; check Confirm email
- `NSD-AUTH-999` — unexpected/unknown error

When reporting a problem, give me the `NSD-*` code first, then the text after it if available.

## Important production note

This is a complete playable prototype, not an anti-cheat authoritative game server. Because puzzle actions originate in the browser, a determined player can inspect or manipulate client requests. For a larger competitive game, move clue validation, extraction, and stat awarding into Supabase Edge Functions / database RPCs that validate full session state server-side.

## Username-only implementation

Supabase's email/password provider still expects an email-shaped identifier internally. The browser generates a deterministic internal identifier from the username using the reserved `.example` domain; players never see or enter an email address. Confirm email must be disabled for this flow.

## Recent authentication fix

The `auth.users` trigger previously converted duplicate usernames into a generic HTTP 500 database failure. The trigger has now been updated to check the username collision explicitly and return a normal duplicate error instead. Supabase's own troubleshooting documentation notes that errors during custom `auth.users` triggers can surface as `Database error saving new user` / HTTP 500 signup failures.
