'use strict';
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const e=require('./engine.js');
let checks=0;
function check(condition,message){assert(condition,message);checks++;}
// The identical production shuffle, supplied by Node's Web Crypto API.
const words=new Uint32Array(8192);let cursor=words.length;
function randomWord(){if(cursor===words.length){webcrypto.getRandomValues(words);cursor=0}return words[cursor++]}
for(const decks of [1,2,4,6,8]){
  const shoe=e.makeShoe(decks,randomWord),counts=new Map();
  for(const card of shoe){const key=card.rank+':'+card.suit;counts.set(key,(counts.get(key)||0)+1)}
  check(shoe.length===52*decks&&counts.size===52&&[...counts.values()].every(n=>n===decks),'shoe composition '+decks);
  check(e.countSequence(shoe)===0,'balanced full-shoe Hi-Lo '+decks);
}
// Rejection sampling must discard the incomplete modulo bucket.
let supplied=[0xffffffff,0],used=0;
e.makeShoe(1,()=>supplied[used++]??0);
check(used===52,'shuffle rejects out-of-range word without skipping a swap');
const samples=100000,decks=6,ranks=Array(13).fill(0),suits=Array(4).fill(0);
let twoFace=0,twoTen=0,blackjack=0;
for(let i=0;i<samples;i++){
  const shoe=e.makeShoe(decks,randomWord),a=shoe[0],b=shoe[2];
  ranks[a.rank-1]++;suits[a.suit]++;
  if(a.rank>=11&&b.rank>=11)twoFace++;
  if(e.cardValue(a)===10&&e.cardValue(b)===10)twoTen++;
  if(e.handValue([a,b]).blackjack)blackjack++;
}
const n=52*decks,denominator=n*(n-1);
function frequency(label,observed,p){
  const z=(observed-samples*p)/Math.sqrt(samples*p*(1-p));
  // Six sigma avoids flaky tests; this is a diagnostic, not proof of randomness.
  check(Math.abs(z)<6,label+' distribution outside six standard deviations');
  console.log(label+': '+observed+'/'+samples+' ('+(100*observed/samples).toFixed(3)+'%), expected '+(100*p).toFixed(3)+'%, z='+z.toFixed(2));
}
frequency('Two face cards',twoFace,12*decks*(12*decks-1)/denominator);
frequency('Two ten-value cards',twoTen,16*decks*(16*decks-1)/denominator);
frequency('Natural blackjack',blackjack,2*4*decks*16*decks/denominator);
ranks.forEach((count,i)=>frequency('First card rank '+(i+1),count,1/13));
suits.forEach((count,i)=>frequency('First card suit '+i,count,1/4));
console.log('100,000 fresh-shoe distribution checks complete. Testing played rounds...');
const variants=[{}, {decks:1,soft17:true,das:false,maxHands:2},
  {decks:2,peek:false,doubleRule:'9-11',payout:1.2,resplitAces:true,maxHands:3},
  {decks:8,soft17:true,resplitAces:true,penetration:.9}];
let roundsPlayed=0;
for(const changes of variants){
  const rules={...e.DEFAULT_RULES,...changes,startingBankroll:1000000};
  let game=e.newGame(rules,e.makeShoe(rules.decks,randomWord)),stats=e.newSession(game.bankroll);
  if(changes.decks)game=e.reduceGame(game,{type:'sideBets',
    bets:{perfectPairs:1,twentyOneThree:2,luckyLucky:1},
    profiles:{perfectPairs:'alternative',twentyOneThree:'enhanced',luckyLucky:'standard'}});
  const roundCount=changes.decks?250:1000;
  for(let i=0;i<roundCount;i++){
    const opening=game.bankroll,serial=game.shoeSerial,position=game.position;
    game=e.reduceGame(game,{type:'deal',shoe:game.needsShuffle?e.makeShoe(rules.decks,randomWord):undefined});
    let steps=0;
    while(game.phase==='insurance'||game.phase==='player'){
      check(++steps<100,'round terminates');
      const event=game.phase==='insurance'?{type:'insurance',take:false}:
        {type:'action',action:e.bestAction(e.legalEVs(game))};
      game=e.reduceGame(game,event);
      check(game.bankroll>=0&&Number.isFinite(game.bankroll),'bankroll stays nonnegative and finite');
    }
    check(game.phase==='settled'&&!game.round.void,'normal shoe does not exhaust');
    check(Math.abs(e.roundMoney(game.bankroll-opening)-game.round.net)<1e-8,'round bankroll reconciles with net');
    check(Math.abs(e.roundMoney(game.round.mainNet+game.round.insuranceNet+game.round.sideNet)-game.round.net)<1e-8,
      'round blackjack, insurance and side-bet components reconcile');
    check(game.sideResults.every(result=>result.category===e.sideBetCategory(result.id,
      e.SIDE_BETS[result.id].cards===2?game.openingCards:[...game.openingCards,game.dealer[0]])),
      'side-bet result uses only original player cards and dealer upcard');
    check(game.position<=game.shoe.length&&game.hands.length<=rules.maxHands,'shoe and hand limits');
    check(game.shoeSerial!==serial||game.position>position,'cards consumed without replacement');
    check(game.runningCount===e.countSequence(game.shoe.slice(0,game.position)),'revealed running count equals consumed shoe');
    stats=e.recordRound(stats,game.round,game.bankroll);roundsPlayed++;
    check(stats.wins+stats.losses+stats.pushes===stats.hands,'outcome totals reconcile');
    check(stats.rankCounts.reduce((a,b)=>a+b,0)===stats.exposedCards,'exposed rank totals reconcile');
    check(Math.abs(e.roundMoney(game.bankroll-stats.openingBankroll)-stats.net)<1e-8,'session net reconciles');
    check(Math.abs(e.roundMoney(stats.mainNet+stats.insuranceNet+stats.sideNet)-stats.net)<1e-8,'session components reconcile');
    check(Math.abs(e.roundMoney(Object.values(stats.sideStats).reduce((sum,stat)=>sum+stat.net,0))-stats.sideNet)<1e-8,
      'individual side-bet totals reconcile');
    if((i+1)%250===0)console.log('Played '+roundsPlayed+' rounds; '+rules.decks+' decks, '+(rules.soft17?'H17':'S17')+', peek='+rules.peek);
  }
}
console.log('Audit passed: '+checks+' assertions across '+samples+' shuffled opening deals and '+roundsPlayed+' played rounds.');
