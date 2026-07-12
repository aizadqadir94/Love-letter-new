/* ─────────────────────────────────────────────
   LOVE LETTER — Taash Edition · server
   Express + ws. Server-authoritative: hands live
   only here; clients get personalised views.
   House rule: Baron duel cards are visible ONLY
   to the two duelists. No public discard lists.
   ───────────────────────────────────────────── */
const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

/* ── game constants ────────────────────────── */
const ROLES = {
  1: "Guard", 2: "Priest", 3: "Baron", 4: "Handmaid",
  5: "Prince", 6: "King", 7: "Countess", 8: "Princess", 0: "KILL",
};
const DECK_SPEC = [
  { r: "A", s: "♠", v: 1 }, { r: "A", s: "♥", v: 1 }, { r: "A", s: "♦", v: 1 }, { r: "A", s: "♣", v: 1 }, { r: "J", s: "♠", v: 1 },
  { r: "2", s: "♠", v: 2 }, { r: "2", s: "♥", v: 2 }, { r: "2", s: "♦", v: 2 },
  { r: "3", s: "♠", v: 3 }, { r: "3", s: "♥", v: 3 }, { r: "3", s: "♦", v: 3 },
  { r: "4", s: "♠", v: 4 }, { r: "4", s: "♥", v: 4 }, { r: "4", s: "♦", v: 4 },
  { r: "5", s: "♥", v: 5 }, { r: "5", s: "♦", v: 5 },
  { r: "6", s: "♠", v: 6 }, { r: "6", s: "♣", v: 6 },
  { r: "7", s: "♣", v: 7 },
  { r: "8", s: "♥", v: 8 },
  { r: "K", s: "☠", v: 0 },
];
const FIVE_PLUS_PLAYER_EXTRA_CARDS = [
  { r: "J", s: "♥", v: 1 },
  { r: "2", s: "♣", v: 2 },
  { r: "3", s: "♣", v: 3 },
];
function deckForPlayerCount(n) {
  return n >= 5 ? [...DECK_SPEC, ...FIVE_PLUS_PLAYER_EXTRA_CARDS] : DECK_SPEC;
}
const WIN_TARGET = 4;
const MAX_PLAYERS = 6;
const MIN_START_PLAYERS = 3;
const BOT_FILL_TARGET = 4;
const BOT_NAMES = ["Bot Zara", "Bot Rafiq", "Bot Meena", "Bot Iqbal", "Bot Sana", "Bot Omar"];
const cardLabel = (c) => `${c.r}${c.s} ${ROLES[c.v]}`;

function freshCard(card) {
  return { ...card };
}

/* ── rooms ─────────────────────────────────── */
const rooms = new Map();

function makeCode() {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join(""); }
  while (rooms.has(code));
  return code;
}
const makeToken = () => crypto.randomBytes(12).toString("hex");

function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function newRoom(hostName) {
  const room = {
    code: makeCode(),
    players: [], // seat = index: {name, token, ws, connected, isBot}
    started: false,
    state: null,
    timers: { scene: null, bot: null },
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  addPlayer(room, hostName, false);
  return room;
}

function addPlayer(room, name, isBot) {
  const p = { name: name.slice(0, 14), token: isBot ? null : makeToken(), ws: null, connected: isBot, isBot };
  room.players.push(p);
  return p;
}

function touch(room) { room.lastActive = Date.now(); }

/* ── round setup ───────────────────────────── */
function startRound(room, roundNum, starter, keepWins) {
  const n = room.players.length;
  const roundDeckSpec = deckForPlayerCount(n);
  const deck = shuffle(roundDeckSpec.map((c) => freshCard(c)));
  const burned = deck.pop();
  room.state = {
    hands: Array.from({ length: n }, () => [deck.pop()]),
    discards: Array.from({ length: n }, () => []),
    alive: Array(n).fill(true),
    prot: Array(n).fill(false),
    wins: keepWins || Array(n).fill(0),
    lastPlayed: Array(n).fill(null),
    deckSpec: roundDeckSpec,
    deck, burned,
    turn: starter, roundNum,
    phase: "turn",
    roundOver: null, gameOver: null,
    log: [`— Round ${roundNum} — ${room.players[starter].name} starts`],
  };
  beginTurn(room);
}

function pushLog(room, m) {
  const st = room.state;
  st.log.push(m);
  if (st.log.length > 50) st.log.shift();
}

function aliveSeats(st) { return st.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0); }

function validTargets(room, seat, value) {
  const st = room.state;
  if (value === 0) return room.players.map((_, i) => i).filter((i) => st.alive[i] && i !== seat);
  const others = room.players.map((_, i) => i).filter((i) => st.alive[i] && i !== seat && !st.prot[i]);
  return others;
}

function eliminate(room, seat, why) {
  const st = room.state;
  st.alive[seat] = false;
  while (st.hands[seat].length) st.discards[seat].push(st.hands[seat].pop());
  pushLog(room, `☠ ${room.players[seat].name} out — ${why}`);
}

function endRound(room, winnerSeat, how) {
  const st = room.state;
  st.wins[winnerSeat] += 1;
  st.roundOver = { winner: winnerSeat, how };
  pushLog(room, `🏆 ${room.players[winnerSeat].name} wins the round (${how})`);
  if (st.wins[winnerSeat] >= WIN_TARGET) st.gameOver = winnerSeat;
}

function checkRoundEnd(room) {
  const a = aliveSeats(room.state);
  if (a.length === 1) { endRound(room, a[0], "last one standing"); return true; }
  return false;
}

/* ── turn flow ─────────────────────────────── */
function clearTimers(room) {
  clearTimeout(room.timers.scene);
  clearTimeout(room.timers.bot);
}

function beginTurn(room) {
  const st = room.state;
  const seat = st.turn;
  st.prot[seat] = false;
  if (st.deck.length === 0) { showdown(room); return; }
  st.hands[seat].push(st.deck.pop());
  st.phase = "turn";
  broadcastState(room);
  if (room.players[seat].isBot) {
    clearTimeout(room.timers.bot);
    room.timers.bot = setTimeout(() => botMove(room, seat), 2200);
  }
}

function nextTurn(room) {
  const st = room.state;
  if (checkRoundEnd(room)) { st.phase = "roundOver"; broadcastState(room); return; }
  let i = st.turn;
  do { i = (i + 1) % room.players.length; } while (!st.alive[i]);
  st.turn = i;
  beginTurn(room);
}

function showdown(room) {
  const st = room.state;
  const alive = aliveSeats(st);
  let best = -1, ids = [];
  alive.forEach((s) => {
    const v = st.hands[s][0]?.v ?? 0;
    if (v > best) { best = v; ids = [s]; } else if (v === best) ids.push(s);
  });
  let winner = ids[0];
  if (ids.length > 1) {
    let bs = -1;
    ids.forEach((s) => {
      const sum = st.discards[s].reduce((a, c) => a + c.v, 0);
      if (sum > bs) { bs = sum; winner = s; }
    });
  }
  alive.forEach((s) => pushLog(room, `Showdown: ${room.players[s].name} held ${cardLabel(st.hands[s][0])}`));
  endRound(room, winner, `highest card — ${cardLabel(st.hands[winner][0])}`);
  const scenes = [
    { title: "Deck is empty — showdown!", sub: "Highest card wins the round", cards: [], dur: 2000 },
    { title: "Final hands", cards: alive.map((s) => ({ card: st.hands[s][0], faceUp: true, label: room.players[s].name, vis: "all" })), dur: 3600 },
  ];
  playScenes(room, scenes);
}

/* ── resolution + cinematic scenes ─────────── */
function resolvePlay(room, seat, handIdx, targetSeat, guess) {
  const st = room.state;
  const A = room.players[seat].name;
  const card = st.hands[seat].splice(handIdx, 1)[0];
  st.discards[seat].push(card);
  st.lastPlayed[seat] = card.v;
  const hasT = targetSeat != null;
  const T = hasT ? room.players[targetSeat].name : null;
  const S = [];
  S.push({
    title: hasT && targetSeat !== seat ? `${A} plays on ${T}` : `${A} plays`,
    cards: [{ card, faceUp: true, label: ROLES[card.v], vis: "all" }],
    sub: hasT && targetSeat === seat ? "targets themself" : "",
    dur: 2200,
  });

  if (card.v === 8) {
    eliminate(room, seat, "discarded the Princess 8♥");
    S.push({ title: `${A} is OUT`, sub: "The Princess was discarded", cards: [{ card, faceUp: true, vis: "all" }], red: true, dur: 2600 });
  } else if (!hasT && [1, 2, 3, 5, 6, 0].includes(card.v)) {
    pushLog(room, `${A} played ${cardLabel(card)} — no valid target`);
    S.push({ title: "No valid target", sub: "Everyone is protected — no effect", cards: [], dur: 2000 });
  } else if (card.v === 1) {
    const tCard = { ...st.hands[targetSeat][0] };
    const hit = tCard.v === guess;
    pushLog(room, `${A}: Guard on ${T}, guessed ${ROLES[guess]} — ${hit ? "hit!" : "miss"}`);
    S.push({ title: `Guesses ${ROLES[guess]} (${guess})`, sub: `against ${T}…`, cards: [], dur: 2000 });
    if (hit) {
      eliminate(room, targetSeat, `${A}'s Guard guessed right`);
      S.push({ title: `CORRECT — ${T} is OUT`, cards: [{ card: tCard, faceUp: true, label: T, vis: "all" }], red: true, dur: 2800 });
    } else {
      S.push({ title: "Wrong guess", sub: `${T} survives — card stays hidden`, cards: [{ faceUp: false }], dur: 2200 });
    }
  } else if (card.v === 2) {
    const tCard = { ...st.hands[targetSeat][0] };
    pushLog(room, `${A}: Priest — peeked at ${T}`);
    S.push({
      title: `${A} peeks at ${T}'s card`,
      cards: [{ card: tCard, faceUp: true, label: T, vis: [seat] }],
      sub: "", subFor: { [seat]: "👁 Only you can see this — memorise it" },
      dur: 3600,
    });
  } else if (card.v === 3) {
    const aCard = { ...st.hands[seat][0] }, tCard = { ...st.hands[targetSeat][0] };
    const duelVis = [seat, targetSeat];
    S.push({ title: "Baron duel", sub: `${A} vs ${T} — comparing hands…`, cards: [{ faceUp: false, label: A }, { faceUp: false, label: T }], dur: 2200 });
    const duelCards = [{ card: aCard, faceUp: true, label: A, vis: duelVis }, { card: tCard, faceUp: true, label: T, vis: duelVis }];
    if (aCard.v > tCard.v) {
      eliminate(room, targetSeat, `lost Baron duel to ${A}`);
      S.push({ title: `${T} is OUT`, red: true, dur: 3000, cards: duelCards, sub: "Duel lost — cards stay hidden", subFor: { [seat]: "👁 Only you two see these cards", [targetSeat]: "👁 Only you two see these cards" } });
    } else if (tCard.v > aCard.v) {
      eliminate(room, seat, `lost Baron duel to ${T}`);
      S.push({ title: `${A} is OUT`, red: true, dur: 3000, cards: duelCards, sub: "Duel lost — cards stay hidden", subFor: { [seat]: "👁 Only you two see these cards", [targetSeat]: "👁 Only you two see these cards" } });
    } else {
      pushLog(room, `Baron tie: ${A} vs ${T}`);
      S.push({ title: "Tie — nobody is out", dur: 2600, cards: duelCards, sub: "Cards stay hidden", subFor: { [seat]: "👁 Equal cards — only you two see this", [targetSeat]: "👁 Equal cards — only you two see this" } });
    }
  } else if (card.v === 4) {
    st.prot[seat] = true;
    pushLog(room, `${A}: Handmaid — protected`);
    S.push({ title: `🛡 ${A} is protected`, sub: "Cannot be targeted until their next turn", cards: [], dur: 2000 });
  } else if (card.v === 5) {
    const dumped = st.hands[targetSeat].pop();
    st.discards[targetSeat].push(dumped);
    pushLog(room, `${A}: Prince → ${T} dumps ${cardLabel(dumped)}`);
    S.push({ title: `${T} throws down their card…`, cards: [{ card: dumped, faceUp: true, label: T, vis: "all" }], sub: "Forced discard — visible to everyone", dur: 3000 });
    if (dumped.v === 8) {
      eliminate(room, targetSeat, "forced to discard the Princess");
      S.push({ title: `It was the Princess — ${T} is OUT`, cards: [{ card: dumped, faceUp: true, vis: "all" }], red: true, dur: 2800 });
    } else {
      const fromBurn = st.deck.length === 0 && st.burned;
      const draw = st.deck.length ? st.deck.pop() : st.burned ? (() => { const b = st.burned; st.burned = null; return b; })() : null;
      if (draw) st.hands[targetSeat].push(draw);
      S.push({ title: `${T} draws a new card`, cards: [{ faceUp: false }], sub: fromBurn ? "…the burned card, deck was empty" : "from the deck", dur: 2200 });
    }
  } else if (card.v === 6) {
    const tmp = st.hands[seat][0];
    st.hands[seat][0] = st.hands[targetSeat][0];
    st.hands[targetSeat][0] = tmp;
    pushLog(room, `${A}: King — traded hands with ${T}`);
    S.push({ title: `${A} ⇄ ${T}`, sub: "Hands traded — values stay secret", cards: [{ faceUp: false, label: A }, { faceUp: false, label: T }], dur: 2800 });
  } else if (card.v === 7) {
    pushLog(room, `${A}: Countess`);
    S.push({ title: "The Countess bows out", sub: "No effect… but why was she played? 🤔", cards: [], dur: 2000 });
  } else if (card.v === 0) {
    const blocked = st.lastPlayed[targetSeat] === 4;
    if (blocked) {
      pushLog(room, `${A}: KILL on ${T} blocked — ${T} played a 4 last turn`);
      S.push({
        title: `KILL blocked by ${T}`,
        sub: `${T} played a 4 on their previous turn and survives`,
        cards: [{ card: { r: "4", s: "🛡", v: 4 }, faceUp: true, label: T, vis: "all" }],
        dur: 2800,
      });
    } else {
      pushLog(room, `${A}: KILL → ${T} eliminated`);
      eliminate(room, targetSeat, `${A}'s KILL eliminated ${T}`);
      S.push({
        title: `${T} is OUT`,
        sub: `KILL eliminates instantly`,
        cards: [{ card: { r: "K", s: "☠", v: 0 }, faceUp: true, label: "KILL", vis: "all" }],
        red: true,
        dur: 2800,
      });
    }
  }

  checkRoundEnd(room);
  playScenes(room, S);
}

function playScenes(room, scenes) {
  const st = room.state;
  st.phase = "scenes";
  const total = scenes.reduce((a, s) => a + s.dur, 0);
  room.players.forEach((p, seat) => {
    if (p.isBot || !p.ws) return;
    const filtered = scenes.map((sc) => ({
      title: sc.title, red: !!sc.red, dur: sc.dur,
      sub: sc.subFor && sc.subFor[seat] != null ? sc.subFor[seat] : sc.sub || "",
      cards: (sc.cards || []).map((c) => {
        const visible = c.vis === "all" || (Array.isArray(c.vis) && c.vis.includes(seat));
        return c.faceUp && visible ? { card: c.card, faceUp: true, label: c.label || "" } : { faceUp: false, label: c.label || "" };
      }),
    }));
    send(p.ws, { type: "scenes", scenes: filtered });
  });
  clearTimeout(room.timers.scene);
  room.timers.scene = setTimeout(() => {
    if (!rooms.has(room.code) || !room.state) return;
    if (room.state.roundOver) { room.state.phase = "roundOver"; broadcastState(room); }
    else nextTurn(room);
  }, total + 500);
}

/* ── bot brain ─────────────────────────────── */
function botMove(room, seat) {
  const st = room.state;
  if (!st || st.phase !== "turn" || st.turn !== seat || !st.alive[seat]) return;
  const hand = st.hands[seat];
  const [c0, c1] = hand;
  const forced = hand.some((c) => c.v === 7) && hand.some((c) => c.v === 5 || c.v === 6);
  let handIdx;
  if (forced) handIdx = hand.findIndex((c) => c.v === 7);
  else if (c0.v === 8) handIdx = 1;
  else if (c1.v === 8) handIdx = 0;
  else if (c0.v === 0) handIdx = 0;
  else if (c1.v === 0) handIdx = 1;
  else handIdx = c0.v <= c1.v ? 0 : 1;

  const card = hand[handIdx];
  const targets = validTargets(room, seat, card.v);
  let targetSeat = null, guess = null;

  if ([1, 2, 3, 6, 0].includes(card.v)) targetSeat = targets.length ? targets[Math.floor(Math.random() * targets.length)] : null;
  else if (card.v === 5) {
    targetSeat = targets.length ? targets[Math.floor(Math.random() * targets.length)] : null;
  }

  if (card.v === 1 && targetSeat != null) {
    const seen = [...hand, ...st.discards.flat()];
    const counts = {};
    (st.deckSpec || DECK_SPEC).forEach((c) => { if (c.v !== 1) counts[c.v] = (counts[c.v] || 0) + 1; });
    seen.forEach((c) => { if (c.v !== 1 && counts[c.v] != null) counts[c.v]--; });
    const pool = [];
    Object.entries(counts).forEach(([v, n]) => { for (let k = 0; k < n; k++) pool.push(+v); });
    guess = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 5;
  }
  resolvePlay(room, seat, handIdx, targetSeat, guess);
}

/* ── views ─────────────────────────────────── */
function viewFor(room, seat) {
  const st = room.state;
  return {
    type: "state",
    code: room.code,
    youSeat: seat,
    phase: st.phase,
    roundNum: st.roundNum,
    deckCount: st.deck.length,
    turn: st.turn,
    winTarget: WIN_TARGET,
    players: room.players.map((p, i) => ({
      seat: i, name: p.name, isBot: p.isBot, connected: p.isBot || p.connected,
      alive: st.alive[i], prot: st.prot[i], wins: st.wins[i],
    })),
    hand: st.alive[seat] ? st.hands[seat] : [],
    log: st.log.slice(-40),
    roundOver: st.roundOver ? { winner: st.roundOver.winner, how: st.roundOver.how } : null,
    gameOver: st.gameOver,
  };
}

function broadcastState(room) {
  touch(room);
  room.players.forEach((p, seat) => {
    if (!p.isBot && p.ws) send(p.ws, viewFor(room, seat));
  });
}

function broadcastLobby(room, reset = false) {
  touch(room);
  const lobby = {
    type: "lobby",
    code: room.code,
    reset,
    players: room.players.map((p, i) => ({ seat: i, name: p.name, isBot: p.isBot, connected: p.isBot || p.connected })),
  };
  room.players.forEach((p, seat) => {
    if (!p.isBot && p.ws) send(p.ws, { ...lobby, youSeat: seat, isHost: seat === 0 });
  });
}

function returnToHome(room) {
  clearTimers(room);
  room.players.forEach((p) => {
    if (!p.isBot && p.ws) {
      send(p.ws, { type: "homeReset" });
      p.ws.meta = { code: null, seat: null };
    }
  });
  rooms.delete(room.code);
}

/* ── websocket handling ────────────────────── */
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.meta = { code: null, seat: null };

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const room = ws.meta.code ? rooms.get(ws.meta.code) : null;

    if (m.type === "ping") { send(ws, { type: "pong" }); return; }

    if (m.type === "create") {
      const name = (m.name || "").trim();
      if (!name) return send(ws, { type: "error", msg: "Enter a name first." });
      const r = newRoom(name);
      const p = r.players[0];
      p.ws = ws; p.connected = true;
      ws.meta = { code: r.code, seat: 0 };
      send(ws, { type: "joined", code: r.code, token: p.token, seat: 0 });
      broadcastLobby(r);
      return;
    }

    if (m.type === "join") {
      const name = (m.name || "").trim();
      const r = rooms.get((m.code || "").toUpperCase().trim());
      if (!name) return send(ws, { type: "error", msg: "Enter a name first." });
      if (!r) return send(ws, { type: "error", msg: "Room not found — check the code." });
      if (r.started) return send(ws, { type: "error", msg: "That game already started." });
      if (r.players.length >= MAX_PLAYERS) return send(ws, { type: "error", msg: `Room is full (${MAX_PLAYERS} max).` });
      const p = addPlayer(r, name, false);
      p.ws = ws; p.connected = true;
      const seat = r.players.length - 1;
      ws.meta = { code: r.code, seat };
      send(ws, { type: "joined", code: r.code, token: p.token, seat });
      broadcastLobby(r);
      return;
    }

    if (m.type === "rejoin") {
      const r = rooms.get((m.code || "").toUpperCase().trim());
      if (!r) return send(ws, { type: "error", msg: "Room no longer exists.", fatal: true });
      const seat = r.players.findIndex((p) => p.token === m.token);
      if (seat < 0) return send(ws, { type: "error", msg: "Could not rejoin.", fatal: true });
      const p = r.players[seat];
      if (p.ws && p.ws !== ws) { try { p.ws.close(); } catch {} }
      p.ws = ws; p.connected = true;
      ws.meta = { code: r.code, seat };
      send(ws, { type: "joined", code: r.code, token: p.token, seat });
      if (r.started && r.state) send(ws, viewFor(r, seat));
      broadcastLobby(r);
      if (r.started && r.state) broadcastState(r);
      return;
    }

    if (!room) return;

    if (m.type === "start") {
      if (room.started) return;
      if (m.fillBots) {
        let b = 0;
        while (room.players.length < BOT_FILL_TARGET) addPlayer(room, BOT_NAMES[b++ % BOT_NAMES.length], true);
      }
      if (room.players.length < MIN_START_PLAYERS) return send(ws, { type: "error", msg: `Need at least ${MIN_START_PLAYERS} players, or tick 'fill with bots' to play with 4 total.` });
      room.started = true;
      startRound(room, 1, 0, null);
      return;
    }

    if (m.type === "returnLobby") {
      returnToHome(room);
      return;
    }

    if (m.type === "play") {
      const st = room.state;
      const seat = ws.meta.seat;
      if (!st || st.phase !== "turn" || st.turn !== seat || !st.alive[seat]) return;
      const hand = st.hands[seat];
      const handIdx = m.handIdx;
      if (typeof handIdx !== "number" || !hand[handIdx]) return;
      const card = hand[handIdx];
      const forced = hand.some((c) => c.v === 7) && hand.some((c) => c.v === 5 || c.v === 6);
      if (forced && card.v !== 7) return send(ws, { type: "error", msg: "Countess rule — you must play the 7." });
      const targets = validTargets(room, seat, card.v);
      let targetSeat = null, guess = null;
      if ([1, 2, 3, 5, 6, 0].includes(card.v) && targets.length > 0) {
        targetSeat = m.targetSeat;
        if (typeof targetSeat !== "number" || !targets.includes(targetSeat)) return send(ws, { type: "error", msg: "Pick a valid target." });
        if (card.v === 1) {
          guess = m.guess;
          if (typeof guess !== "number" || ![0,2,3,4,5,6,7,8].includes(guess)) return send(ws, { type: "error", msg: "Guess must be 0 or 2–8." });
        }
      }
      clearTimers(room);
      resolvePlay(room, seat, handIdx, targetSeat, guess);
      return;
    }

    if (m.type === "next") {
      const st = room.state;
      if (!st || st.phase !== "roundOver" || !st.roundOver) return;
      if (st.gameOver != null) startRound(room, 1, 0, null);
      else startRound(room, st.roundNum + 1, st.roundOver.winner, st.wins);
      return;
    }
  });

  ws.on("close", () => {
    const room = ws.meta.code ? rooms.get(ws.meta.code) : null;
    if (!room) return;
    const p = room.players[ws.meta.seat];
    if (p && p.ws === ws) {
      p.ws = null; p.connected = false;
      if (room.started && room.state) broadcastState(room);
      else broadcastLobby(room);
    }
  });
});

/* heartbeat: drop dead sockets */
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30000);

/* cleanup: remove rooms idle > 45 min with nobody connected */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = room.players.some((p) => !p.isBot && p.connected);
    if (!anyone && now - room.lastActive > 45 * 60 * 1000) {
      clearTimers(room);
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => console.log(`Love Letter Taash listening on ${PORT}`));
