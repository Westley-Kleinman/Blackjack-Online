const RULES = Object.freeze({ decks: 6, soft17: false, minBet: 10, maxBet: 500, maxPlayers: 6, maxHands: 4 });
const ROOM_CODE = /^[A-Z0-9]{4,8}$/;
const SIDE_BETS = Object.freeze({
  perfectPairs: { name: 'Perfect Pairs', cards: 2, profiles: { standard: { label: '25 / 15 / 5', pays: { perfect: 25, colored: 15, mixed: 5 } } } },
  twentyOneThree: { name: '21+3', cards: 3, profiles: { standard: { label: '9:1 winning hands', pays: { suitedTrips: 9, straightFlush: 9, trips: 9, straight: 9, flush: 9 } } } },
  luckyLucky: { name: 'Lucky Lucky', cards: 3, profiles: { standard: { label: '200 / 100 / 50 / 30 / 15 / 3 / 2 / 2', pays: { suited777: 200, suited678: 100, triple777: 50, run678: 30, suited21: 15, total21: 3, total20: 2, total19: 2 } } } }
});
const SIDE_BET_IDS = Object.keys(SIDE_BETS);
const emptySideBets = () => Object.fromEntries(SIDE_BET_IDS.map(id => [id, 0]));
const emptySideProfiles = () => Object.fromEntries(SIDE_BET_IDS.map(id => [id, 'standard']));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
}

function rankOf(card) { return card.rank; }
function valueOf(card) { return Math.min(rankOf(card), 10); }
function handValue(cards) {
  let total = cards.reduce((sum, card) => sum + valueOf(card), 0), aces = cards.filter(card => rankOf(card) === 1).length;
  let soft = false;
  while (aces > 0 && total + 10 <= 21) { total += 10; aces--; soft = true; }
  return { total, soft, blackjack: cards.length === 2 && total === 21 };
}
function sideBetCategory(id, cards) {
  const ranks = cards.map(card => rankOf(card)).sort((a, b) => a - b), suited = cards.every(card => card.suit === cards[0].suit);
  if (id === 'perfectPairs') {
    if (ranks[0] !== ranks[1]) return 'lose';
    if (suited) return 'perfect';
    const red = card => card.suit === 1 || card.suit === 2;
    return red(cards[0]) === red(cards[1]) ? 'colored' : 'mixed';
  }
  if (id === 'twentyOneThree') {
    const trips = ranks[0] === ranks[2], straight = ranks[1] === ranks[0] + 1 && ranks[2] === ranks[1] + 1 || ranks[0] === 1 && ranks[1] === 12 && ranks[2] === 13;
    if (trips) return suited ? 'suitedTrips' : 'trips';
    if (straight) return suited ? 'straightFlush' : 'straight';
    return suited ? 'flush' : 'lose';
  }
  const total = handValue(cards).total;
  if (ranks.every(rank => rank === 7)) return suited ? 'suited777' : 'triple777';
  if (ranks.join(',') === '6,7,8') return suited ? 'suited678' : 'run678';
  if (total === 21) return suited ? 'suited21' : 'total21';
  return total === 20 ? 'total20' : total === 19 ? 'total19' : 'lose';
}
function sideBetResult(id, profile, stake, cards) {
  const schedule = SIDE_BETS[id].profiles[profile] || SIDE_BETS[id].profiles.standard, category = sideBetCategory(id, cards), odds = schedule.pays[category] ?? -1;
  const paid = odds < 0 ? 0 : Math.round(stake * (odds + 1) * 100) / 100;
  return { id, profile, stake, category, odds, paid, net: Math.round((paid - stake) * 100) / 100 };
}
function totalWager(player) { return Math.round((player.bet + SIDE_BET_IDS.reduce((sum, id) => sum + (player.sideBets?.[id] || 0), 0)) * 100) / 100; }
function cardLabel(card) {
  if (!card) return 'hidden';
  return (['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][card.rank - 1] || '?') + ['♠', '♥', '♦', '♣'][card.suit];
}
function makeShoe(decks) {
  const shoe = [];
  for (let deck = 0; deck < decks; deck++) for (let suit = 0; suit < 4; suit++) for (let rank = 1; rank <= 13; rank++) shoe.push({ rank, suit });
  const random = new Uint32Array(1);
  for (let i = shoe.length - 1; i > 0; i--) {
    crypto.getRandomValues(random);
    const j = Math.floor(random[0] / 4294967296 * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}
function emptyPlayer(id, name) {
  return { id, name, connected: true, bankroll: 1000, bet: 0, sideBets: emptySideBets(), sideProfiles: emptySideProfiles(), sideResults: [], originalCards: [], hands: [], activeHand: 0, result: '', ready: false };
}
function emptyState(code) {
  return { code, phase: 'waiting', hostId: '', players: [], dealer: [], dealerRevealed: false,
    shoe: makeShoe(RULES.decks), position: 0, round: 0, activePlayer: 0, message: 'Waiting for players.', rules: { ...RULES } };
}
function publicState(state) {
  return {
    code: state.code, phase: state.phase, round: state.round, message: state.message,
    dealer: state.dealer.map((card, index) => index === 1 && !state.dealerRevealed ? null : card),
    dealerRevealed: state.dealerRevealed, position: state.position, shoeSize: state.shoe.length,
    activePlayer: state.activePlayer, hostId: state.hostId, rules: state.rules,
    players: state.players.map(player => ({ id: player.id, name: player.name, connected: player.connected,
      bankroll: player.bankroll, bet: player.bet, sideBets: { ...player.sideBets }, sideProfiles: { ...player.sideProfiles }, sideResults: player.sideResults.map(result => ({ ...result })),
      hands: player.hands.map(hand => ({ ...hand, cards: [...hand.cards] })), activeHand: player.activeHand, result: player.result, ready: player.ready }))
  };
}
function currentPlayer(state) { return state.players[state.activePlayer]; }
function currentHand(state) { const player = currentPlayer(state); return player?.hands[player.activeHand]; }
function playerIndex(state, id) { return state.players.findIndex(player => player.id === id); }
function legalActions(state, player) {
  if (state.phase !== 'playing' || currentPlayer(state)?.id !== player.id) return [];
  const hand = player.hands[player.activeHand], value = handValue(hand.cards);
  if (!hand || hand.done || value.total >= 21) return [];
  const actions = ['hit', 'stand'];
  if (hand.cards.length === 2 && !hand.splitAces && player.bankroll >= hand.wager && (!hand.fromSplit || state.rules.das !== false)) actions.push('double');
  if (hand.cards.length === 2 && valueOf(hand.cards[0]) === valueOf(hand.cards[1]) && player.hands.length < state.rules.maxHands && player.bankroll >= hand.wager && (!hand.splitAces || state.rules.resplitAces)) actions.push('split');
  if (hand.splitAces) return actions.filter(action => action === 'stand' || action === 'split');
  return actions;
}
function draw(state) {
  if (state.position >= state.shoe.length) { state.shoe = makeShoe(state.rules.decks); state.position = 0; }
  return state.shoe[state.position++];
}
function makeHand(cards, wager, fromSplit = false, splitAces = false) { return { cards, wager, fromSplit, splitAces, done: false, result: '' }; }
function dealOneToSplitHand(state, player, hand) {
  hand.cards.push(draw(state));
  const value = handValue(hand.cards);
  if (value.total >= 21 || hand.splitAces) hand.done = true;
}
function advanceTurn(state) {
  while (state.activePlayer < state.players.length) {
    const player = currentPlayer(state);
    if (player?.connected && player.hands.some(hand => !hand.done)) return;
    state.activePlayer++;
  }
  playDealer(state);
}
function advanceHand(state) {
  const player = currentPlayer(state);
  if (player.hands[player.activeHand] && !player.hands[player.activeHand].done) return;
  const next = player.hands.findIndex(hand => !hand.done);
  if (next >= 0) { player.activeHand = next; return; }
  advanceTurn(state);
}
function playDealer(state) {
  state.phase = 'dealer'; state.dealerRevealed = true;
  while (true) {
    const value = handValue(state.dealer);
    if (value.total > 21 || value.total > 17 || value.total === 17 && (!value.soft || !state.rules.soft17)) break;
    state.dealer.push(draw(state));
  }
  settle(state);
}
function settle(state) {
  const dealer = handValue(state.dealer), dealerBJ = dealer.blackjack;
  for (const player of state.players) {
    let roundNet = 0;
    for (const hand of player.hands) {
      const value = handValue(hand.cards), natural = value.blackjack && !hand.fromSplit;
      let returned = 0;
      if (dealerBJ) returned = natural ? hand.wager : 0;
      else if (natural) returned = hand.wager * 2.5;
      else if (value.total > 21) returned = 0;
      else if (dealer.total > 21 || value.total > dealer.total) returned = hand.wager * 2;
      else if (value.total === dealer.total) returned = hand.wager;
      player.bankroll = Math.round((player.bankroll + returned) * 100) / 100;
      roundNet += returned - hand.wager;
      hand.result = value.total > 21 ? 'Bust' : dealerBJ ? (natural ? 'Push' : 'Dealer blackjack') : natural ? 'Blackjack' : dealer.total > 21 || value.total > dealer.total ? 'Win' : value.total === dealer.total ? 'Push' : 'Lose';
    }
    player.sideResults = [];
    if (player.hands.length) for (const id of SIDE_BET_IDS) if (player.sideBets[id] > 0) {
      const cards = [...player.originalCards, state.dealer[0]];
      const result = sideBetResult(id, player.sideProfiles[id], player.sideBets[id], cards.slice(0, SIDE_BETS[id].cards));
      player.sideResults.push(result); player.bankroll = Math.round((player.bankroll + result.paid) * 100) / 100; roundNet += result.net;
    }
    player.result = roundNet > 0 ? 'Win' : roundNet < 0 ? 'Lose' : 'Push';
  }
  state.phase = 'settled'; state.message = 'Round complete. Place the next bets.';
}
function startRound(state) {
  if (state.players.length === 0) { state.message = 'At least one player must join.'; return; }
  const seated = state.players.filter(player => player.connected);
  const eligible = seated.filter(player => player.bet >= state.rules.minBet && player.bet <= state.rules.maxBet && player.bankroll >= totalWager(player));
  if (!seated.length) { state.message = 'At least one connected player must join.'; return; }
  if (eligible.length !== seated.length) { state.message = `Everyone at the table must place a valid main bet and have enough chips for their side bets before the host deals.`; return; }
  for (const player of state.players) { player.hands = []; player.originalCards = []; player.activeHand = 0; player.result = ''; player.sideResults = []; player.ready = false; }
  for (const player of seated) {
    player.bankroll -= totalWager(player);
    player.hands = [makeHand([], player.bet)];
  }
  state.dealer = []; state.dealerRevealed = false; state.round++; state.phase = 'playing'; state.activePlayer = 0;
  for (const player of seated) player.hands[0].cards.push(draw(state));
  state.dealer.push(draw(state));
  for (const player of seated) player.hands[0].cards.push(draw(state));
  state.dealer.push(draw(state));
  for (const player of seated) {
    const value = handValue(player.hands[0].cards); if (value.total >= 21) player.hands[0].done = true;
    player.originalCards = [...player.hands[0].cards];
  }
  if (handValue(state.dealer).blackjack) playDealer(state);
  else { advanceTurn(state); if (state.phase === 'playing') state.message = `${currentPlayer(state).name}'s turn.`; }
}
function handleAction(state, player, action) {
  if (!legalActions(state, player).includes(action)) return;
  const hand = currentHand(state);
  if (action === 'hit') { hand.cards.push(draw(state)); if (handValue(hand.cards).total >= 21) hand.done = true; }
  if (action === 'stand') hand.done = true;
  if (action === 'double') { player.bankroll -= hand.wager; hand.wager *= 2; hand.cards.push(draw(state)); hand.done = true; }
  if (action === 'split') {
    player.bankroll -= hand.wager;
    const splitAces = valueOf(hand.cards[0]) === 1;
    const first = makeHand([hand.cards[0]], hand.wager, true, splitAces), second = makeHand([hand.cards[1]], hand.wager, true, splitAces);
    player.hands.splice(player.activeHand, 1, first, second); dealOneToSplitHand(state, player, first);
    if (splitAces) dealOneToSplitHand(state, player, second);
  }
  advanceHand(state);
  if (state.phase === 'playing') state.message = `${currentPlayer(state).name}'s turn.`;
}

export class BlackjackRoom {
  constructor(state, env) { this.state = state; this.env = env; this.sockets = new Map(); this.ready = this.load(); }
  async load() {
    this.game = await this.state.storage.get('game') || emptyState(this.state.id.toString().slice(-8).toUpperCase());
    for (const player of this.game.players) { player.sideBets = { ...emptySideBets(), ...(player.sideBets || {}) }; player.sideProfiles = { ...emptySideProfiles(), ...(player.sideProfiles || {}) }; player.sideResults = player.sideResults || []; player.originalCards = player.originalCards || []; }
  }
  async persist() { await this.state.storage.put('game', this.game); }
  send(socket, playerId) { socket.send(JSON.stringify({ type: 'state', selfId: playerId, state: publicState(this.game), legalActions: legalActions(this.game, this.game.players.find(player => player.id === playerId)) })); }
  broadcast() { for (const [socket, playerId] of this.sockets) if (socket.readyState === 1) this.send(socket, playerId); }
  async fetch(request) {
    await this.ready;
    const requestedCode = new URL(request.url).pathname.match(/^\/room\/([A-Z0-9]{4,8})$/i)?.[1]?.toUpperCase();
    if (requestedCode && this.game.code !== requestedCode && this.game.phase === 'waiting') {
      this.game.code = requestedCode;
      await this.persist();
    }
    if (request.headers.get('Upgrade') !== 'websocket') return json({ ok: true, room: this.game.code });
    const pair = new WebSocketPair(); pair[1].accept();
    let playerId = crypto.randomUUID(); this.sockets.set(pair[1], playerId);
    pair[1].addEventListener('message', event => this.message(pair[1], playerId, event.data));
    pair[1].addEventListener('close', () => { const player = this.game.players.find(item => item.id === playerId); if (player) { player.connected = false; if (this.game.hostId === playerId) this.game.hostId = this.game.players.find(item => item.connected)?.id || ''; if (this.game.phase === 'playing' && currentPlayer(this.game)?.id === playerId) { player.hands.forEach(hand => { hand.done = true; }); advanceTurn(this.game); if (this.game.phase === 'playing') this.game.message = `${currentPlayer(this.game).name}'s turn.`; } } this.sockets.delete(pair[1]); this.persist().then(() => this.broadcast()); });
    this.send(pair[1], playerId); return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async message(socket, playerId, raw) {
    try {
      const event = JSON.parse(raw), type = event.type;
      if (type === 'join') {
        const name = String(event.name || 'Player').trim().slice(0, 24) || 'Player';
        let player = this.game.players.find(item => item.id === playerId);
        if (!player && this.game.players.length >= this.game.rules.maxPlayers) return socket.send(JSON.stringify({ type: 'error', message: 'This table is full.' }));
        if (!player) { player = emptyPlayer(playerId, name); this.game.players.push(player); if (!this.game.hostId) this.game.hostId = playerId; }
        player.connected = true; player.name = name; this.send(socket, playerId); await this.persist(); this.broadcast(); return;
      }
      const player = this.game.players.find(item => item.id === playerId);
      if (!player) return;
      if (type === 'bet' && ['waiting', 'betting', 'settled'].includes(this.game.phase)) {
        const amount = Number(event.amount); if (Number.isFinite(amount) && amount >= this.game.rules.minBet && amount <= this.game.rules.maxBet && amount + SIDE_BET_IDS.reduce((sum, id) => sum + player.sideBets[id], 0) <= player.bankroll) { player.bet = Math.round(amount * 100) / 100; player.ready = true; this.game.message = `${player.name} updated their main bet.`; } else socket.send(JSON.stringify({ type: 'error', message: `Your main bet must be between £${this.game.rules.minBet} and £${this.game.rules.maxBet}, with enough chips for your side bets.` }));
      } else if (type === 'sideBet' && ['waiting', 'betting', 'settled'].includes(this.game.phase)) {
        const id = String(event.id), amount = Number(event.amount), profile = String(event.profile || 'standard');
        const valid = SIDE_BET_IDS.includes(id) && Number.isFinite(amount) && amount >= 0 && amount <= this.game.rules.maxBet && Object.hasOwn(SIDE_BETS[id].profiles, profile);
        if (!valid || player.bet + SIDE_BET_IDS.reduce((sum, key) => sum + (key === id ? amount : player.sideBets[key]), 0) > player.bankroll) socket.send(JSON.stringify({ type: 'error', message: 'That side-bet amount is invalid or exceeds your available chips.' }));
        else { player.sideBets[id] = Math.round(amount * 100) / 100; player.sideProfiles[id] = profile; this.game.message = `${player.name} updated their side bets.`; }
      } else if (type === 'start' && player.id === this.game.hostId && ['waiting', 'betting', 'settled'].includes(this.game.phase)) startRound(this.game);
      else if (type === 'action') handleAction(this.game, player, String(event.action));
      else if (type === 'reset' && player.id === this.game.hostId) { this.game = emptyState(this.game.code); this.game.hostId = player.id; this.game.players = [emptyPlayer(player.id, player.name)]; }
      else return;
      await this.persist(); this.broadcast();
    } catch (error) { socket.send(JSON.stringify({ type: 'error', message: 'Invalid game request.' })); }
  }
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const bytes = new Uint8Array(6); crypto.getRandomValues(bytes);
  return [...bytes].map(byte => alphabet[byte % alphabet.length]).join('');
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response('', { headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' } });
    if (url.pathname === '/create' && request.method === 'POST') {
      let requested = '';
      try { requested = String((await request.json())?.code || '').trim().toUpperCase(); } catch { /* Empty body means generate a code. */ }
      if (requested && !ROOM_CODE.test(requested)) return json({ error: 'Room codes must be 4–8 letters or numbers.' }, 400);
      const code = requested || newCode(); env.ROOM.idFromName(code); return json({ code });
    }
    const match = url.pathname.match(/^\/room\/([A-Z0-9]{4,8})$/i);
    if (match) {
      const code = match[1].toUpperCase(); if (!ROOM_CODE.test(code)) return json({ error: 'Invalid room code.' }, 400);
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
    }
    return json({ ok: true, service: 'blackjack-multiplayer' });
  }
};
