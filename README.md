# Love Letter · Taash Edition — Online

Server-authoritative multiplayer Love Letter played with a standard taash deck.
3–6 human players can play without bots. With bots enabled, 1–3 humans are filled to 4 total players. The normal deck is used for 3–4 players; with 5–6 players, one extra Guard, one extra Priest, and one extra Baron are added. Hands never leave the server,
so nobody can cheat by inspecting the page.

## Deck
| Card | Role | Count |
|---|---|---|
| A♠ A♥ A♦ A♣ + J♠ (1) | Guard | 5 |
| 2s | Priest | 3 |
| 3s | Baron | 3 |
| 4s | Handmaid | 3 |
| 5♥ 5♦ | Prince | 2 |
| 6♠ 6♣ | King | 2 |
| 7♣ | Countess | 1 |
| 8♥ | Princess | 1 |
| K☠ (0) | KILL | 1 |

For 5–6 players: add J♥ Guard, 2♣ Priest, and 3♣ Baron.

House rules: Baron duel cards are shown ONLY to the two duelists.
No public discard lists. First to 4 round wins takes the game. Card 5 forces an opponent, not yourself, to discard face up and redraw. KILL has value 0. It eliminates any chosen opponent instantly unless that target played a 4 on their previous turn, and KILL cannot be used on the first turn after you get it.

## Files
```
package.json
server.js
public/
  index.html
```

## Run locally
```
npm install
node server.js
```
Open http://localhost:3000 in three or more browser tabs to test, or use bot fill.

## Deploy — GitHub
1. Go to github.com → **New repository** → name it `love-letter-taash` → Create.
2. **Add file → Upload files** → drag in `package.json` and `server.js`.
3. For the public folder: **Add file → Create new file** → in the filename box type
   `public/index.html` (the slash creates the folder) → paste the contents of
   `public/index.html` → Commit.
   (Or drag the whole `public` folder in step 2 — GitHub keeps folder structure
   when you drag a folder.)

## Deploy — Render
1. render.com → **New → Web Service** → connect the `love-letter-taash` repo.
2. Settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `node server.js`
   - Instance type: **Free**
3. Create Web Service and wait for the first deploy.
4. Your game is live at `https://love-letter-taash.onrender.com` (or whatever
   name Render gives you).

## Playing
1. Open the URL, enter your name, tap **Create table**.
2. Share the 4-letter code. Friends open the same URL, enter their name and
   the code, tap **Join**.
3. Any player can tap **Start game**. Three or more humans can start without bots. Tick "Fill to 4 seats with bots" to fill 1–3 humans up to 4 total players. The room can hold up to six human players.
4. During a game, the **Main room** button at the bottom ends the current table for everyone and returns all players to the first screen, so anyone can create or join a new game.
5. If someone's phone locks or loses signal, they just reopen the page — the
   session token in their browser reconnects them to their seat automatically.

## Notes
- Free Render instances sleep after ~15 min idle; the first load after that
  takes ~30–50 s to wake. Everyone after that is instant.
- Rooms are deleted after 45 minutes with nobody connected.
- WebSocket heartbeat runs every 30 s server-side and every 20 s client-side,
  same pattern as Band Rang.
