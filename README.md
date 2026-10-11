# Eleven · თერთმეტი

Online version of თერთმეტობანა (Eleven), the Georgian card game of elevens.
Two to four players at a table, invite friends with a link, empty seats are
played by the computer. English by default, Georgian with one tap.

## Rules in short

- 52 cards. Each player gets 4, 4 go face up on the table. When hands are empty, 4 more each.
- A number card (ace = 1) takes a group of table cards that sum to 11 with it. One group per turn.
- Queen takes a queen, king takes a king. The jack is the *furti*: it takes everything except queens and kings.
- Taking is optional. Leftover table cards go to the last player who took something.
- Deal score: most cards 2, most clubs 1 (ties: nobody), 10♦ 1, 2♣ 1. First to the target with the sole lead wins.
- The dealer rotates; the player to the dealer's left starts.

## How it is built

| Part | Where | Notes |
| --- | --- | --- |
| Game engine | `supabase/functions/game/engine.js` | Plain ESM, shared by server and client. `npm test` runs it through hundreds of full games. |
| Server | `supabase/functions/game/index.ts` | Supabase Edge Function. The only writer of rooms and games; validates every move, plays the bots. |
| Database | `supabase/migrations/` (applied to project **Eleven**) | `profiles`, `rooms`, `room_players`, `games` (public state), `game_secrets` (deck + hands, server only), `game_hands` (your own hand, RLS). Realtime on all of them. |
| Client | `index.html`, `src/` | Vite, vanilla JS. Hash routing (`#/room/CODE`) so it works on GitHub Pages. |
| Hosting | `.github/workflows/deploy.yml` | Builds and publishes `dist/` to GitHub Pages on every push to `main`. |

## Local development

```sh
npm install
npm test          # engine tests
npm run dev       # http://localhost:5173/Jack/
npm run build
```

The client talks to the Supabase project in `src/config.js` (publishable key; row-level
security guards the data). Deploying the edge function:

```sh
supabase functions deploy game --no-verify-jwt --project-ref acknnwflahxlripuybwl
```

(`--no-verify-jwt` because the function verifies the user's token itself with `auth.getUser`.)

## Supabase settings to check once

- Authentication → URL configuration: Site URL `https://bekagnp-design.github.io/Jack/` and add it to Redirect URLs, so confirmation links come back to the app.
- Authentication → Providers → Email: turn **Confirm email** off if friends should be able to play right after signing up.
