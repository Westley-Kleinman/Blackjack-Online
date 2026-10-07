/* Pure blackjack rules and EV solver. Shoe cards retain rank and suit.
   Numeric cards are also accepted by the console tests: ace=1, J/Q/K=11/12/13. */
const RANKS = [1,2,3,4,5,6,7,8,9,10];
const WEIGHTS = [1,1,1,1,1,1,1,1,1,4];
const DEFAULT_RULES = Object.freeze({decks:6, soft17:false, payout:1.5, das:true,
  doubleRule:'any', resplitAces:false, maxHands:4, peek:true,
  penetration:0.75, startingBankroll:1000, minBet:10, maxBet:500});
const P = RANKS.map((r,i)=>[r,WEIGHTS[i]/13]);
const COACH_INTERVAL=25;
const EV_TOLERANCE=1e-9;
// Published non-progressive schedules: Wizard of Odds Perfect Pairs v1 A/B/D,
// 21+3 v1/v7, and Lucky Lucky table 1. Odds are recomputed, never hardcoded.
const SIDE_BETS=Object.freeze({
  perfectPairs:{name:'Perfect Pairs',cards:2,description:'Your original two cards must share the same rank. J+Q is not a pair.',
    categories:{perfect:'Perfect pair (same rank and suit)',colored:'Colored pair (same rank/color, different suits)',mixed:'Mixed pair (same rank, opposite colors)'},
    profiles:{standard:{name:'25 / 15 / 5',pays:{perfect:25,colored:15,mixed:5}},
      alternative:{name:'30 / 10 / 5',pays:{perfect:30,colored:10,mixed:5}},
      live:{name:'25 / 12 / 6',pays:{perfect:25,colored:12,mixed:6}}}},
  twentyOneThree:{name:'21+3',cards:3,description:'Your original two cards plus the dealer’s upcard form a three-card poker hand. Aces can be low (A-2-3) or high (Q-K-A), not K-A-2.',
    categories:{suitedTrips:'Suited three of a kind',straightFlush:'Straight flush',trips:'Three of a kind',straight:'Straight',flush:'Flush'},
    profiles:{standard:{name:'9:1 for any winning hand',pays:{suitedTrips:9,straightFlush:9,trips:9,straight:9,flush:9}},
      enhanced:{name:'100 / 40 / 30 / 10 / 5',pays:{suitedTrips:100,straightFlush:40,trips:30,straight:10,flush:5}}}},
  luckyLucky:{name:'Lucky Lucky',cards:3,description:'Your original two cards plus the dealer’s upcard total 19, 20 or 21. Blackjack card values apply; aces count as 1 or 11.',
    categories:{suited777:'Suited 7-7-7',suited678:'Suited 6-7-8',triple777:'Unsuited 7-7-7',run678:'Unsuited 6-7-8',suited21:'Other suited 21',total21:'Other unsuited 21',total20:'Total of 20',total19:'Total of 19'},
    profiles:{standard:{name:'Table 1 · top payout 200:1',pays:{suited777:200,suited678:100,triple777:50,run678:30,suited21:15,total21:3,total20:2,total19:2}}}}
});
const SIDE_BET_IDS=Object.keys(SIDE_BETS);
function emptySideBets(){return Object.fromEntries(SIDE_BET_IDS.map(id=>[id,0]));}
function normalizeSideProfiles(input={}) {
  return Object.fromEntries(SIDE_BET_IDS.map(id=>[id,Object.hasOwn(SIDE_BETS[id].profiles,input?.[id])?input[id]:'standard']));
}
function sideBetCategory(id,cards) {
  if(!SIDE_BETS[id]||cards.length!==SIDE_BETS[id].cards||cards.some(card=>
    !card||typeof card!=='object'||!Number.isInteger(card.rank)||card.rank<1||card.rank>13||
    !Number.isInteger(card.suit)||card.suit<0||card.suit>3))throw new Error('Side bets require cards with valid ranks and suits');
  const ranks=cards.map(card=>card.rank).sort((a,b)=>a-b),suited=cards.every(card=>card.suit===cards[0].suit);
  if(id==='perfectPairs'){
    if(ranks[0]!==ranks[1])return 'lose';
    if(suited)return 'perfect';
    const red=card=>card.suit===1||card.suit===2;
    return red(cards[0])===red(cards[1])?'colored':'mixed';
  }
  if(id==='twentyOneThree'){
    const trips=ranks[0]===ranks[2],straight=ranks[1]===ranks[0]+1&&ranks[2]===ranks[1]+1||
      ranks[0]===1&&ranks[1]===12&&ranks[2]===13;
    if(trips)return suited?'suitedTrips':'trips';
    if(straight)return suited?'straightFlush':'straight';
    return suited?'flush':'lose';
  }
  const total=handValue(cards).total;
  if(ranks.every(rank=>rank===7))return suited?'suited777':'triple777';
  if(ranks.join(',')==='6,7,8')return suited?'suited678':'run678';
  if(total===21)return suited?'suited21':'total21';
  return total===20?'total20':total===19?'total19':'lose';
}
function sideBetResult(id,profile,stake,cards) {
  if(!SIDE_BETS[id]||!Number.isFinite(stake)||stake<0)throw new Error('Invalid side-bet wager');
  profile=normalizeSideProfiles({[id]:profile})[id];stake=roundMoney(stake);
  const schedule=SIDE_BETS[id].profiles[profile];
  const category=sideBetCategory(id,cards),odds=schedule.pays[category]??-1;
  const paid=odds<0?0:roundMoney(stake*(odds+1));
  return {id,profile,stake,category,odds,paid,net:roundMoney(paid-stake)};
}
const sideDistributionCache=new Map();
function sideBetDistribution(id,decks) {
  const key=id+':'+decks;if(sideDistributionCache.has(key))return sideDistributionCache.get(key);
  if(!SIDE_BETS[id]||![1,2,4,6,8].includes(decks))throw new Error('Invalid side-bet odds request');
  const types=[];for(let suit=0;suit<4;suit++)for(let rank=1;rank<=13;rank++)types.push({rank,suit});
  const choose=(n,k)=>k===1?n:k===2?n*(n-1)/2:n*(n-1)*(n-2)/6;
  const counts=Object.fromEntries([...Object.keys(SIDE_BETS[id].categories),'lose'].map(category=>[category,0]));
  const record=(indices)=>{
    const multiplicity=new Map();for(const index of indices)multiplicity.set(index,(multiplicity.get(index)||0)+1);
    let weight=1;for(const copies of multiplicity.values())weight*=choose(decks,copies);
    if(weight>0)counts[sideBetCategory(id,indices.map(index=>types[index]))]+=weight;
  };
  for(let a=0;a<types.length;a++)for(let b=a;b<types.length;b++){
    if(SIDE_BETS[id].cards===2)record([a,b]);
    else for(let c=b;c<types.length;c++)record([a,b,c]);
  }
  const combinations=choose(52*decks,SIDE_BETS[id].cards);
  const distribution={counts,combinations,probabilities:Object.fromEntries(Object.entries(counts).map(([category,n])=>[category,n/combinations]))};
  sideDistributionCache.set(key,distribution);return distribution;
}
function sideBetOdds(id,profile,decks) {
  const distribution=sideBetDistribution(id,decks),pays=(SIDE_BETS[id].profiles[profile]||SIDE_BETS[id].profiles.standard).pays;
  const ev=Object.entries(distribution.probabilities).reduce((sum,[category,p])=>sum+p*(pays[category]??-1),0);
  return {...distribution,ev,houseEdge:-ev,winProbability:1-distribution.probabilities.lose};
}
function cardRank(card) { return typeof card==='number'?card:card.rank; }
function cardValue(card) { return Math.min(cardRank(card),10); }
function isPair(cards) { return cards.length===2 && cardValue(cards[0])===cardValue(cards[1]); }
function decisionOptimal(item) {
  return item.chosen===item.best || Number.isFinite(item.chosenEV) &&
    Number.isFinite(item.bestEV) && item.chosenEV>=item.bestEV-EV_TOLERANCE;
}
function roundMoney(value) { return Math.round((value+Number.EPSILON)*100)/100; }
function normalizeRules(input={}) {
  if(!input||typeof input!=='object')input={};
  const r={...DEFAULT_RULES};
  for(const key of ['soft17','das','resplitAces','peek'])
    if(typeof input[key]==='boolean')r[key]=input[key];
  for(const [key,allowed] of [['decks',[1,2,4,6,8]],['payout',[1.5,1.2]],['maxHands',[2,3,4]],['doubleRule',['any','9-11']]])
    if(allowed.includes(input[key]))r[key]=input[key];
  if(Number.isFinite(input.penetration))r.penetration=Math.max(.5,Math.min(.9,input.penetration));
  for(const key of ['startingBankroll','minBet','maxBet'])
    if(Number.isFinite(input[key])&&input[key]>=.01)r[key]=roundMoney(input[key]);
  r.maxBet=Math.max(r.minBet,r.maxBet);
  return r;
}
function insuranceExpectedValue(rules,cards) {
  const unseen=52*rules.decks-cards.length-1;
  const tens=16*rules.decks-cards.filter(card=>cardValue(card)===10).length;
  return 3*tens/unseen-1;
}
function handValue(cards) {
  let total=0, aces=0;
  for (const card of cards) { const value=cardValue(card);total+=value; if(value===1) aces++; }
  let soft=false;
  if(aces && total+10<=21) { total+=10; soft=true; }
  return {total,soft,blackjack:cards.length===2 && total===21};
}
function hiLo(card) { const value=cardValue(card);return value>=2 && value<=6 ? 1 : value===1 || value===10 ? -1 : 0; }
function countSequence(cards) { return cards.reduce((n,c)=>n+hiLo(c),0); }
function beginnerShortcut(key) {
  return ({ArrowUp:1,ArrowDown:-1,ArrowLeft:0,ArrowRight:0})[key]??null;
}
function newBeginnerDrill(cards) {
  return {cards:[...cards],answered:0,correct:0,streak:0,count:0,lastAnswer:null,complete:cards.length===0};
}
function answerBeginnerDrill(previous,guess) {
  if(previous.complete||![-1,0,1].includes(guess))return previous;
  const card=previous.cards[previous.answered],expected=hiLo(card),correct=guess===expected;
  const answered=previous.answered+1,count=previous.count+expected;
  return {...previous,answered,count,correct:previous.correct+Number(correct),
    streak:correct?previous.streak+1:0,complete:answered===previous.cards.length,
    lastAnswer:{card,guess,expected,correct,before:previous.count,after:count}};
}
function insuranceShortcut(key,phase) {
  if(phase!=='insurance') return null;
  return key==='a'?true:key==='d'?false:null;
}
function makeShoe(decks, randomWord) {
  const cards=[];
  for(let d=0;d<decks;d++) for(let suit=0;suit<4;suit++)
    for(let rank=1;rank<=13;rank++) cards.push({rank,suit});
  for(let i=cards.length-1;i>0;i--) {
    const span=i+1,limit=0x100000000-(0x100000000%span);
    let word;do {word=randomWord()} while(word>=limit);
    const j=word%span; [cards[i],cards[j]]=[cards[j],cards[i]];
  }
  return cards;
}
function dealerDraw(total,soft,rules,cache,probs) {
  const key=total+','+soft;
  if(cache.has(key)) return cache.get(key);
  if(total>21) return {bust:1};
  if(total>17 || total===17 && (!soft || !rules.soft17)) return {[total]:1};
  const out={};
  for(const [rank,p] of probs) {
    let next=total+rank, nextSoft=soft;
    if(rank===1 && total+11<=21) { next+=10; nextSoft=true; }
    else if(next>21 && nextSoft) {next-=10; nextSoft=false;}
    const branch=dealerDraw(next,nextSoft,rules,cache,probs);
    for(const [k,v] of Object.entries(branch)) out[k]=(out[k]||0)+p*v;
  }
  cache.set(key,out); return out;
}
function dealerDistribution(up,rules,conditionNoBlackjack,probs=P) {
  up=cardValue(up);
  const cache=new Map(), out={}; let weight=0;
  for(const [hole,p] of probs) {
    const bj=(up===1 && hole===10)||(up===10 && hole===1);
    if(bj && conditionNoBlackjack) continue;
    weight+=p;
    const dist=bj ? {blackjack:1} : dealerDraw(handValue([up,hole]).total,handValue([up,hole]).soft,rules,cache,probs);
    for(const [k,v] of Object.entries(dist)) out[k]=(out[k]||0)+p*v;
  }
  for(const k of Object.keys(out)) out[k]/=weight;
  return out;
}
const solverCache=new Map();
function solverFor(rules,up,conditionNoBlackjack=rules.peek,knownCards=[]) {
  up=cardValue(up);knownCards=knownCards.map(cardValue).sort((a,b)=>a-b);
  const key=JSON.stringify([rules.soft17,rules.payout,rules.das,rules.doubleRule,
    rules.resplitAces,rules.maxHands,rules.peek,rules.decks,up,
    conditionNoBlackjack,knownCards]);
  if(solverCache.has(key)) return solverCache.get(key);
  const actionCache=new Map();
  function actions(cards,options={}) {
    cards=cards.map(cardValue).sort((a,b)=>a-b);
    const funds=options.funds===undefined?Infinity:options.funds;
    const stake=options.stake===undefined?1:options.stake;
    // At most every available split hand can add one double-down wager.
    const budget=Math.min(2*rules.maxHands,Math.floor((funds+EV_TOLERANCE)/stake));
    const cacheKey=JSON.stringify([cards,budget,options.fromSplit,options.splitAces,
      options.natural,options.handCount||1]);
    if(actionCache.has(cacheKey))return {...actionCache.get(cacheKey)};
    const counts=WEIGHTS.map(w=>w*4*rules.decks);
    for(const rank of [up,...cards])counts[rank-1]--;
    if(counts.some(n=>n<0))throw new Error('Impossible hand composition');
    const initialN=counts.reduce((a,b)=>a+b,0);
    const excluded=conditionNoBlackjack?(up===1?9:up===10?0:-1):-1;
    const dealerCache=new Map(),distributionCache=new Map(),playerCache=new Map();
    // Dealer buckets: bust, 17, 18, 19, 20, 21, natural blackjack.
    const terminals=Array.from({length:7},(_,i)=>Array.from({length:7},(_,j)=>Number(i===j)));
    function addCard(value,rank){let total=value.total+rank,soft=value.soft;
      if(rank===1&&total+10<=21){total+=10;soft=true}
      else if(total>21&&soft){total-=10;soft=false}
      return {total,soft};
    }
    function dealer(total,soft,n){
      if(total>21)return terminals[0];
      if(total>17||total===17&&(!soft||!rules.soft17))return terminals[total-16];
      const key=counts.join(',')+':'+total+':'+soft;
      if(dealerCache.has(key))return dealerCache.get(key);
      const out=Array(7).fill(0);
      for(let i=0;i<RANKS.length;i++)if(counts[i]){
        const p=counts[i]/n,next=addCard({total,soft},i+1);
        counts[i]--;const branch=dealer(next.total,next.soft,n-1);counts[i]++;
        for(let k=0;k<out.length;k++)out[k]+=p*branch[k];
      }
      dealerCache.set(key,out);return out;
    }
    function distribution(n){const key=counts.join(',');
      if(distributionCache.has(key))return distributionCache.get(key);
      const out=Array(7).fill(0),denominator=n-(excluded>=0?counts[excluded]:0);
      for(let i=0;i<RANKS.length;i++)if(i!==excluded&&counts[i]){
        const p=counts[i]/denominator,hole=i+1;
        if(up===1&&hole===10||up===10&&hole===1){out[6]+=p;continue}
        const value=handValue([up,hole]);counts[i]--;
        const branch=dealer(value.total,value.soft,n-1);counts[i]++;
        for(let k=0;k<out.length;k++)out[k]+=p*branch[k];
      }
      distributionCache.set(key,out);return out;
    }
    function stand(value,n,natural=false){
      if(value.total>21)return -1;
      const dist=distribution(n);
      if(natural)return (1-dist[6])*rules.payout;
      let ev=dist[0]-dist[6];
      for(let k=1;k<=5;k++)ev+=dist[k]*Math.sign(value.total-(k+16));
      return ev;
    }
    function drawProbability(i,n){
      // The unseen counts include one reserved hole card. After a peek its
      // rank cannot complete blackjack, so player draws use the conditional
      // marginal, without inspecting the actual hidden card in the game.
      const allowed=n-(excluded>=0?counts[excluded]:0);
      const holeProbability=i===excluded?0:counts[i]/allowed;
      return (counts[i]-holeProbability)/(n-1);
    }
    function hit(value,n,doubled=false){let ev=0;
      for(let i=0;i<RANKS.length;i++)if(counts[i]){
        const p=drawProbability(i,n),next=addCard(value,i+1);
        counts[i]--;ev+=p*(doubled?2*stand(next,n-1):bestAfterHit(next,n-1));counts[i]++;
      }
      return ev;
    }
    function bestAfterHit(value,n){
      if(value.total>21)return -1;
      if(value.total===21)return stand(value,n);
      const key=counts.join(',')+':'+value.total+':'+value.soft;
      if(playerCache.has(key))return playerCache.get(key);
      const ev=Math.max(stand(value,n),hit(value,n));playerCache.set(key,ev);return ev;
    }
    const value=handValue(cards),two=cards.length===2;
    const out={stand:stand(value,initialN,Boolean(options.natural))};
    if(!options.natural&&value.total<21&&!options.splitAces)out.hit=hit(value,initialN);
    if(two&&!options.natural&&!options.splitAces&&value.total<21&&budget>=1&&
      (!options.fromSplit||rules.das)&&(rules.doubleRule==='any'||value.total>=9&&value.total<=11))
      out.double=hit(value,initialN,true);
    if(isPair(cards)&&!options.natural&&budget>=1&&(options.handCount||1)<rules.maxHands&&
      (!options.splitAces||cards[0]===1&&rules.resplitAces)){
      const rank=cards[0],aces=rank===1,children=[];
      for(let i=0;i<RANKS.length;i++)if(counts[i]){
        const p=drawProbability(i,initialN),child=handValue([rank,i+1]);counts[i]--;
        const single=Math.max(stand(child,initialN-1),aces||child.total===21?-Infinity:hit(child,initialN-1));
        const canDouble=!aces&&child.total<21&&rules.das&&
          (rules.doubleRule==='any'||child.total>=9&&child.total<=11);
        children.push({rank:i+1,p,single,double:canDouble?hit(child,initialN-1,true):-Infinity});counts[i]++;
      }
      const splitCache=new Map();
      // Split EV treats each child against the same initial unseen mixture;
      // depletion by the other split hands is ignored. Budget and global
      // hand limits are shared. This is the only approximation in this solver.
      function splitQueue(pending,remainingSplits,available){
        if(!pending)return 0;
        const key=pending+','+remainingSplits+','+available;
        if(splitCache.has(key))return splitCache.get(key);
        let ev=0;
        for(const child of children){
          let result=child.single+splitQueue(pending-1,remainingSplits,available);
          if(available>0)result=Math.max(result,child.double+splitQueue(pending-1,remainingSplits,available-1));
          if(child.rank===rank&&remainingSplits>0&&available>0&&(!aces||rules.resplitAces))
            result=Math.max(result,splitQueue(pending+1,remainingSplits-1,available-1));
          ev+=child.p*result;
        }
        splitCache.set(key,ev);return ev;
      }
      out.split=splitQueue(2,rules.maxHands-(options.handCount||1)-1,budget-1);
    }
    actionCache.set(cacheKey,out);return {...out};
  }
  const solver={actions};
  // Retain small final-EV caches; recursive working maps are released per solve.
  if(solverCache.size>=4096)solverCache.delete(solverCache.keys().next().value);
  solverCache.set(key,solver);return solver;
}
function bestAction(evs) {
  const order=['split','double','stand','hit'];
  return order.filter(a=>a in evs).reduce((a,b)=>evs[b]>evs[a]+EV_TOLERANCE?b:a);
}
function newGame(rules,shoe) {
  rules=normalizeRules(rules);
  return {rules:{...rules},pendingRules:null,shoe:[...shoe],position:0,shoeSerial:1,
    roundId:0,round:null,review:[],needsShuffle:false,
    bankroll:rules.startingBankroll,bet:rules.minBet,phase:'betting',dealer:[],
    dealerRevealed:false,hands:[],active:0,insurance:0,exposedCards:[],dealerPlayed:false,
    sideBets:emptySideBets(),sideProfiles:normalizeSideProfiles(),sideResults:[],
    runningCount:0,message:'Choose a bet and deal.'};
}
function legalActions(s) {
  if(s.phase!=='player') return [];
  const hand=s.hands[s.active], cards=hand.cards, value=handValue(cards);
  if(hand.done||cards.length<2||value.total>=21)return [];
  const actions=['hit','stand'];
  if(hand.splitAces) actions.splice(actions.indexOf('hit'),1);
  if(cards.length===2 && !hand.splitAces && s.bankroll>=hand.wager &&
    (!hand.fromSplit || s.rules.das) &&
    (s.rules.doubleRule==='any' || value.total>=9 && value.total<=11)) actions.push('double');
  if(isPair(cards) && s.hands.length<s.rules.maxHands &&
    s.bankroll>=hand.wager && (!hand.splitAces || s.rules.resplitAces)) actions.push('split');
  return actions;
}
function legalEVs(s) {
  if(s.phase!=='player') return {};
  const hand=s.hands[s.active],legal=legalActions(s);
  const candidates=solverFor(s.rules,s.dealer[0],s.rules.peek,hand.cards).actions(hand.cards,
    {funds:s.bankroll,stake:hand.wager,fromSplit:hand.fromSplit,splitAces:hand.splitAces,
      handCount:s.hands.length});
  return Object.fromEntries(Object.entries(candidates).filter(([action])=>legal.includes(action)));
}
function newSession(openingBankroll) {
  return {openingBankroll,rounds:0,hands:0,wins:0,losses:0,pushes:0,blackjacks:0,
    net:0,totalWagered:0,openingBets:0,decisions:0,optimalDecisions:0,evMissed:0,
    doubles:0,splits:0,insuranceBets:0,largestWin:0,largestLoss:0,
    currentStreak:0,longestWinStreak:0,longestLossStreak:0,shoesUsed:0,
    history:[],handHistory:[],coachReports:[],shoeSerials:[],twoFaceHands:0,twoTenValueHands:0,
    openingBlackjacks:0,rankCounts:Array(13).fill(0),exposedCards:0,playerBusts:0,dealerBusts:0,dealerPlayedRounds:0,
    mainNet:0,insuranceNet:0,sideNet:0,sideWagered:0,
    sideStats:Object.fromEntries(SIDE_BET_IDS.map(id=>[id,{bets:0,wins:0,wagered:0,net:0}]))};
}
function summarizeCoachingBlock(hands) {
  const decisions=hands.flatMap(hand=>hand.decisions);
  const optimal=decisions.filter(decisionOptimal).length;
  const evMissed=decisions.reduce((sum,item)=>sum+item.evCost,0);
  const patterns=new Map();
  for(const item of decisions) {
    if(decisionOptimal(item)) continue;
    const key=item.chosen+'→'+item.best;
    const group=patterns.get(key)||{chosen:item.chosen,best:item.best,count:0,evCost:0,example:item};
    group.count++;group.evCost+=item.evCost;
    if(item.evCost>group.example.evCost) group.example=item;
    patterns.set(key,group);
  }
  const topPattern=[...patterns.values()].sort((a,b)=>b.evCost-a.evCost)[0]||null;
  return {hands:hands.length,decisions:decisions.length,optimal,evMissed,
    wins:hands.filter(hand=>hand.result==='Win'||hand.result==='Blackjack').length,
    losses:hands.filter(hand=>!['Win','Blackjack','Push'].includes(hand.result)).length,
    pushes:hands.filter(hand=>hand.result==='Push').length,topPattern};
}
function buildCoachReport(handHistory,milestone) {
  const current=summarizeCoachingBlock(handHistory.slice(milestone-COACH_INTERVAL,milestone));
  const previous=milestone>=2*COACH_INTERVAL?
    summarizeCoachingBlock(handHistory.slice(milestone-2*COACH_INTERVAL,milestone-COACH_INTERVAL)):null;
  return {milestone,current,previous};
}
function recordRound(previous,round,bankroll) {
  if(!round || round.void) return previous;
  const s={...previous,history:[...previous.history],handHistory:[...previous.handHistory],
    coachReports:[...previous.coachReports],shoeSerials:[...previous.shoeSerials],rankCounts:[...previous.rankCounts],
    sideStats:Object.fromEntries(SIDE_BET_IDS.map(id=>[id,{...previous.sideStats[id]}]))};
  s.rounds++;s.hands+=round.results.length;s.net=roundMoney(s.net+round.net);
  s.totalWagered=roundMoney(s.totalWagered+round.wagered);s.openingBets=roundMoney(s.openingBets+round.bet);
  s.mainNet=roundMoney(s.mainNet+(round.mainNet??round.net));s.insuranceNet=roundMoney(s.insuranceNet+(round.insuranceNet||0));
  for(const result of round.sideResults||[]){
    const stat=s.sideStats[result.id];stat.bets++;if(result.paid>0)stat.wins++;
    stat.wagered=roundMoney(stat.wagered+result.stake);stat.net=roundMoney(stat.net+result.net);
    s.sideNet=roundMoney(s.sideNet+result.net);s.sideWagered=roundMoney(s.sideWagered+result.stake);
  }
  if(!s.shoeSerials.includes(round.shoeSerial))s.shoeSerials.push(round.shoeSerial);
  s.shoesUsed=s.shoeSerials.length;
  for(const card of round.exposedCards||[]){s.rankCounts[cardRank(card)-1]++;s.exposedCards++}
  s.playerBusts+=round.results.filter(result=>result==='Bust').length;
  if(round.dealerPlayed)s.dealerPlayedRounds++;
  if(round.dealerBust)s.dealerBusts++;
  if(round.openingCards){
    if(round.openingCards.every(card=>cardRank(card)>=11))s.twoFaceHands++;
    if(round.openingCards.every(card=>cardValue(card)===10))s.twoTenValueHands++;
    if(handValue(round.openingCards).blackjack)s.openingBlackjacks++;
  }
  for(const result of round.results) {
    if(result==='Blackjack') {s.blackjacks++;s.wins++;}
    else if(result==='Win') s.wins++;
    else if(result==='Push') s.pushes++;
    else s.losses++;
  }
  for(const decision of round.review) {
    s.decisions++;
    if(decisionOptimal(decision)) s.optimalDecisions++;
    s.evMissed+=decision.evCost;
    if(decision.chosen==='double') s.doubles++;
    if(decision.chosen==='split') s.splits++;
    if(decision.chosen==='takeInsurance') s.insuranceBets++;
  }
  if(round.net>0) s.currentStreak=s.currentStreak>0?s.currentStreak+1:1;
  else if(round.net<0) s.currentStreak=s.currentStreak<0?s.currentStreak-1:-1;
  else s.currentStreak=0;
  s.longestWinStreak=Math.max(s.longestWinStreak,s.currentStreak);
  s.longestLossStreak=Math.max(s.longestLossStreak,-s.currentStreak);
  s.largestWin=Math.max(s.largestWin,round.net);
  s.largestLoss=Math.min(s.largestLoss,round.net);
  s.history.push({number:s.rounds,bet:round.bet,net:round.net,sideNet:round.sideNet||0,bankroll,
    results:[...round.results]});
  round.results.forEach((result,index)=>s.handHistory.push({result,roundId:round.id,
    decisions:round.review.filter(item=>item.handIndex===index).map(item=>({...item}))}));
  const nextMilestone=Math.floor(s.hands/COACH_INTERVAL)*COACH_INTERVAL;
  const previousMilestone=Math.floor(previous.hands/COACH_INTERVAL)*COACH_INTERVAL;
  if(nextMilestone>previousMilestone)
    s.coachReports.push(buildCoachReport(s.handHistory,nextMilestone));
  return s;
}
function trainingFamily(item) {
  if(item.kind==='insurance') return 'Insurance';
  const cards=item.cards,value=handValue(cards),rank=cardValue(cards[0]);
  if(isPair(cards)) return 'Pair of '+(rank===1?'aces':rank===10?'10-value cards':rank+'s');
  if(value.soft) return value.total<=17?'Soft 13–17':value.total===18?'Soft 18':'Soft 19+';
  return value.total<=11?'Hard 11 or less':value.total<=16?'Hard 12–16':'Hard 17+';
}
function trainingScenarioKey(item) {
  const rules=item.rules||{},cards=item.cards.map(cardValue).sort((a,b)=>a-b);
  const ruleKeys=['decks','soft17','payout','das','doubleRule','resplitAces','maxHands','peek'];
  return JSON.stringify([item.kind,cards,cardValue(item.dealerUp),[...(item.legal||[])].sort(),
    ruleKeys.map(key=>rules[key])]);
}
function analyzeTraining(handHistory) {
  const decisions=handHistory.flatMap(hand=>hand.decisions.map(item=>({...item,roundId:hand.roundId})));
  const misses=decisions.filter(item=>!decisionOptimal(item));
  const patternMap=new Map(),scenarioMap=new Map();
  for(const item of misses) {
    const family=trainingFamily(item),patternKey=family+'|'+item.chosen+'|'+item.best;
    const gap=Math.max(0,item.bestEV-item.chosenEV);
    const pattern=patternMap.get(patternKey)||{key:patternKey,family,chosen:item.chosen,best:item.best,
      count:0,totalGap:0,totalCost:0,example:item};
    pattern.count++;pattern.totalGap+=gap;pattern.totalCost+=item.evCost;
    if(gap>pattern.example.bestEV-pattern.example.chosenEV) pattern.example=item;
    patternMap.set(patternKey,pattern);
    const key=trainingScenarioKey(item);
    const scenario=scenarioMap.get(key)||{key,patternKey,example:item,count:0,totalGap:0};
    scenario.count++;scenario.totalGap+=gap;scenario.example=item;
    scenarioMap.set(key,scenario);
  }
  const patterns=[...patternMap.values()].sort((a,b)=>b.totalGap-a.totalGap||b.count-a.count);
  const scenarios=[...scenarioMap.values()].sort((a,b)=>b.totalGap-a.totalGap||b.count-a.count);
  const windowSize=10, recent=decisions.slice(-windowSize),prior=decisions.slice(-2*windowSize,-windowSize);
  const rate=items=>items.filter(decisionOptimal).length/items.length;
  const trend=prior.length===windowSize&&recent.length===windowSize?
    {previousRate:rate(prior),recentRate:rate(recent),windowSize}:null;
  return {decisions:decisions.length,misses:misses.length,patterns,scenarios,trend};
}
function draw(s,visible=true) {
  if(s.position>=s.shoe.length) throw new Error('shoe exhausted');
  const card=s.shoe[s.position++];
  if(visible){s.runningCount+=hiLo(card);s.exposedCards.push(card)}
  return card;
}
function revealDealer(s) {
  if(!s.dealerRevealed && s.dealer.length>1) {
    s.runningCount+=hiLo(s.dealer[1]); s.dealerRevealed=true;
    s.exposedCards.push(s.dealer[1]);
  }
}
function settle(s) {
  revealDealer(s);
  const dealer=handValue(s.dealer), dealerBJ=dealer.blackjack;
  let net=0;
  for(const hand of s.hands) {
    let paid=0;
    const player=handValue(hand.cards), natural=player.blackjack && !hand.fromSplit;
    if(dealerBJ) paid=natural?hand.wager:0;
    else if(natural) paid=hand.wager*(1+s.rules.payout);
    else if(player.total>21) paid=0;
    else if(dealer.total>21 || player.total>dealer.total) paid=2*hand.wager;
    else if(player.total===dealer.total) paid=hand.wager;
    paid=roundMoney(paid);s.bankroll=roundMoney(s.bankroll+paid);net=roundMoney(net+paid-hand.wager);
    hand.result=player.total>21?'Bust':dealerBJ?(natural?'Push':'Dealer blackjack'):
      natural?'Blackjack':dealer.total>21||player.total>dealer.total?'Win':
      player.total===dealer.total?'Push':'Lose';
  }
  const mainNet=net;let insuranceNet=0;
  if(s.insurance) {
    const paid=dealerBJ?3*s.insurance:0;
    s.bankroll=roundMoney(s.bankroll+paid);insuranceNet=roundMoney(paid-s.insurance);
  }
  const sideNet=roundMoney(s.sideResults.reduce((sum,result)=>sum+result.net,0));
  net=roundMoney(mainNet+insuranceNet+sideNet);
  s.round={id:s.roundId,void:false,net,mainNet,insuranceNet,sideNet,sideResults:s.sideResults.map(result=>({...result})),bet:s.bet,
    wagered:roundMoney(s.hands.reduce((sum,hand)=>sum+hand.wager,0)+s.insurance+s.sideResults.reduce((sum,result)=>sum+result.stake,0)),
    results:s.hands.map(hand=>hand.result),review:s.review.map(item=>({...item})),
    shoeSerial:s.shoeSerial,openingCards:s.openingCards,exposedCards:[...s.exposedCards],
    dealerPlayed:s.dealerPlayed,dealerBust:dealer.total>21};
  s.phase='settled'; s.message=(net>0?'+':'')+money(net)+' this hand.';
  s.needsShuffle=Boolean(s.pendingRules)||s.position>=Math.floor(s.shoe.length*s.rules.penetration);
}
function money(n) {return '£'+Number(n.toFixed(2)).toFixed(2);}
function finishHands(s) {
  while(s.active<s.hands.length) {
    const hand=s.hands[s.active];
    // Casino order: finish the active split hand before dealing to the next.
    if(hand.cards.length===1)hand.cards.push(draw(s));
    if(handValue(hand.cards).total>=21)hand.done=true;
    if(!hand.done && !hand.splitAces) break;
    if(!hand.done && hand.splitAces && legalActions(s).includes('split')) break;
    hand.done=true; s.active++;
  }
  if(s.active<s.hands.length) return;
  if(s.hands.every(h=>handValue(h.cards).total>21)) {settle(s);return;}
  s.phase='dealer';s.dealerPlayed=true;revealDealer(s);
  while(true) {
    const v=handValue(s.dealer);
    if(v.total>21 || v.total>17 || v.total===17 && (!v.soft || !s.rules.soft17)) break;
    s.dealer.push(draw(s));
  }
  settle(s);
}
function reduceGame(previous,event) {
  const s=JSON.parse(JSON.stringify(previous));
  try {
    if(event.type==='sideBets') {
      if(!['betting','settled'].includes(s.phase))return previous;
      const bets=event.bets||s.sideBets,maxBet=(s.pendingRules||s.rules).maxBet;
      if(SIDE_BET_IDS.some(id=>!Number.isFinite(bets[id])||bets[id]<0||bets[id]>maxBet)){
        s.message='Each side bet must be between '+money(0)+' and '+money(maxBet)+'.';return s;
      }
      s.sideBets=Object.fromEntries(SIDE_BET_IDS.map(id=>[id,roundMoney(bets[id])]));
      s.sideProfiles=normalizeSideProfiles(event.profiles||s.sideProfiles);return s;
    }
    if(event.type==='bet') {
      if(s.phase!=='betting' && s.phase!=='settled') return previous;
      const betRules=s.pendingRules||s.rules;
      const requested=Number(event.amount);
      s.bet=roundMoney(Math.min(betRules.maxBet,Math.max(betRules.minBet,Number.isFinite(requested)?requested:betRules.minBet)));
      return s;
    }
    if(event.type==='rules') {
      s.pendingRules=normalizeRules(event.rules);s.needsShuffle=true;
      s.message='Rules saved. They apply on the next deal with a fresh shoe.';
      return s;
    }
    if(event.type==='reset') return newGame(s.rules,event.shoe);
    if(event.type==='deal') {
      if(!['betting','settled'].includes(s.phase)) return previous;
      if(s.pendingRules) {
        s.rules=s.pendingRules;s.pendingRules=null;
        s.needsShuffle=true;
        s.bet=Math.max(s.rules.minBet,Math.min(s.rules.maxBet,s.bet));
      }
      const sideStake=roundMoney(SIDE_BET_IDS.reduce((sum,id)=>sum+s.sideBets[id],0));
      if(SIDE_BET_IDS.some(id=>s.sideBets[id]>s.rules.maxBet)){
        s.message='Side bet exceeds the new table maximum. Reduce it before dealing.';return s;
      }
      if(roundMoney(s.bet+sideStake)>s.bankroll) {s.message='Your main bet plus side bets exceed your bankroll.';return s;}
      if(s.bankroll<s.rules.minBet) {s.message='Bankroll below minimum. Reset bankroll in Settings.';return s;}
      if(s.needsShuffle || s.position>=Math.floor(s.shoe.length*s.rules.penetration)) {
        if(!event.shoe) throw new Error('new shoe required');
        s.shoe=[...event.shoe];s.position=0;s.runningCount=0;s.needsShuffle=false;
        s.shoeSerial++;
      }
      s.roundId++;s.round=null;s.review=[];
      s.bankroll=roundMoney(s.bankroll-s.bet-sideStake);s.insurance=0;s.sideResults=[];
      s.dealer=[];s.dealerRevealed=false;s.exposedCards=[];s.dealerPlayed=false;s.hands=[{cards:[],wager:s.bet,fromSplit:false,
        splitAces:false,done:false}];s.active=0;
      s.hands[0].cards.push(draw(s));s.dealer.push(draw(s));
      s.hands[0].cards.push(draw(s));s.dealer.push(draw(s,false));
      s.openingCards=[...s.hands[0].cards];
      for(const id of SIDE_BET_IDS)if(s.sideBets[id]>0){
        const cards=SIDE_BETS[id].cards===2?s.openingCards:[...s.openingCards,s.dealer[0]];
        const result=sideBetResult(id,s.sideProfiles[id],s.sideBets[id],cards);
        s.sideResults.push(result);s.bankroll=roundMoney(s.bankroll+result.paid);
      }
      const up=cardValue(s.dealer[0]), dealerBJ=handValue(s.dealer).blackjack;
      if(up===1) {s.phase='insurance';
        s.message='Insurance offered: up to half your bet. Usually a negative EV bet.';return s;}
      if(s.rules.peek && up===10 && dealerBJ) {settle(s);return s;}
      if(handValue(s.hands[0].cards).blackjack) {settle(s);return s;}
      s.phase='player';s.message='Choose an action.';return s;
    }
    if(event.type==='insurance') {
      if(s.phase!=='insurance') return previous;
      const stake=roundMoney(Math.min(s.bet/2,s.bankroll));
      const taking=Boolean(event.take && stake>=s.bet/2),insuranceEV=insuranceExpectedValue(s.rules,s.hands[0].cards);
      s.review.push({kind:'insurance',chosen:taking?'takeInsurance':'declineInsurance',
        best:'declineInsurance',cards:[...s.hands[0].cards],dealerUp:s.dealer[0],
        handIndex:0,legal:s.bankroll>=s.bet/2?['declineInsurance','takeInsurance']:['declineInsurance'],rules:{...s.rules},
        evs:s.bankroll>=s.bet/2?{declineInsurance:0,takeInsurance:insuranceEV}:{declineInsurance:0},
        evCost:taking?-insuranceEV*stake:0,chosenEV:taking?insuranceEV:0,bestEV:0});
      if(taking) {s.insurance=stake;s.bankroll=roundMoney(s.bankroll-stake);}
      if(s.rules.peek && handValue(s.dealer).blackjack) {settle(s);return s;}
      if(handValue(s.hands[0].cards).blackjack) {settle(s);return s;}
      s.phase='player';s.message='Choose an action.';return s;
    }
    if(event.type==='action') {
      const action=event.action;
      if(!legalActions(s).includes(action)) return previous;
      const h=s.hands[s.active],evs=legalEVs(s),best=bestAction(evs);
      s.review.push({kind:'play',chosen:action,best,cards:[...h.cards],
        dealerUp:s.dealer[0],handIndex:s.active,legal:Object.keys(evs),rules:{...s.rules},evs:{...evs},
        chosenEV:evs[action],bestEV:evs[best],
        evCost:Math.max(0,evs[best]-evs[action])*h.wager});
      if(action==='hit') {h.cards.push(draw(s));if(handValue(h.cards).total>=21) h.done=true;}
      if(action==='stand') h.done=true;
      if(action==='double') {s.bankroll=roundMoney(s.bankroll-h.wager);h.wager*=2;h.cards.push(draw(s));h.done=true;}
      if(action==='split') {
        s.bankroll=roundMoney(s.bankroll-h.wager);
        const ace=cardValue(h.cards[0])===1;
        const a={cards:[h.cards[0]],wager:h.wager,fromSplit:true,splitAces:ace,
          done:false};
        const b={...a,cards:[h.cards[1]]};
        s.hands.splice(s.active,1,a,b);
      }
      finishHands(s);return s;
    }
    return previous;
  } catch(error) {
    if(error.message!=='shoe exhausted') throw error;
    // A depleted shoe voids the hand; no replacement cards enter mid-hand.
    for(const h of s.hands)s.bankroll=roundMoney(s.bankroll+h.wager);
    s.bankroll=roundMoney(s.bankroll+s.insurance);s.insurance=0;s.phase='settled';s.needsShuffle=true;
    // Side winnings were paid on the opening deal. Reverse them and refund
    // all original side stakes when the whole round is voided.
    s.bankroll=roundMoney(s.bankroll+SIDE_BET_IDS.reduce((sum,id)=>sum+s.sideBets[id],0)-s.sideResults.reduce((sum,result)=>sum+result.paid,0));
    s.sideResults=[];
    s.round={id:s.roundId,void:true};
    revealDealer(s);s.message='Shoe exhausted mid-hand. All wagers refunded; next deal reshuffles.';
    return s;
  }
}
function runSelfTests() {
  let passed=0;
  const assert=(ok,label)=>{if(!ok) throw new Error('Self-test failed: '+label);passed++;};
  const rules={...DEFAULT_RULES};
  const choice=(cards,up,r=rules,options={})=>bestAction(solverFor(r,up,r.peek,cards).actions(cards,options));
  assert(choice([10,6],10)==='hit','16 vs 10 without surrender');
  assert(choice([10,5],10)==='hit','15 vs 10 without surrender');
  assert(choice([1,7],9)==='hit','soft 18 vs 9');
  assert(choice([1,1],10)==='split','A,A split');
  assert(choice([8,8],10)==='split','8,8 split');
  assert(choice([10,10],6)==='stand','10,10 stand');
  assert(choice([9,9],7)==='stand','9,9 vs 7 stand');
  assert(choice([9,3],4)==='stand','12 vs 4 stand');
  assert(choice([10,2],4)==='hit','10+2 vs 4 finite-deck composition exception');
  assert(choice([10,2],3)==='hit','12 vs 3 hit');
  const single={...rules,decks:1,soft17:true};
  assert(choice([6,5],1,single)==='double','single deck H17 11 vs A double');
  assert(choice([6,5],1,{...single,soft17:false})==='double','single deck S17 6+5 vs A double');
  assert(choice([6,5],1,{...rules,soft17:true})==='double','six deck H17 11 vs A double');
  assert(choice([6,5],1,rules)==='hit','six deck S17 11 vs A hit');
  assert(countSequence([2,5,7,9,10,1,6])===1,'Hi-Lo sequence');
  assert(beginnerShortcut('ArrowUp')===1&&beginnerShortcut('ArrowDown')===-1&&
    beginnerShortcut('ArrowLeft')===0&&beginnerShortcut('ArrowRight')===0&&beginnerShortcut('h')===null,
    'beginner arrow keys map to card values, not blackjack actions');
  let beginner=newBeginnerDrill([2,11,8,6,1]);
  const initialBeginner=beginner;
  for(const value of [0,-1,0,1,-1])beginner=answerBeginnerDrill(beginner,value);
  assert(initialBeginner.answered===0&&beginner.complete&&beginner.answered===5&&
    beginner.correct===4&&beginner.streak===4&&beginner.count===0,
    'beginner answers are immutable, scored once, and count uses actual cards even after a mistake');
  assert(answerBeginnerDrill(beginner,1)===beginner&&
    answerBeginnerDrill(initialBeginner,2)===initialBeginner,'completed drills and invalid answers cannot advance');
  for(const decks of [1,2,4,6,8]){
    let full=newBeginnerDrill(makeShoe(decks,()=>0));
    for(const card of full.cards)full=answerBeginnerDrill(full,hiLo(card));
    assert(full.complete&&full.answered===52*decks&&full.correct===52*decks&&full.count===0,
      'beginner full '+decks+'-deck run visits every card exactly once and ends balanced');
  }
  assert(insuranceShortcut('a','insurance')===true &&
    insuranceShortcut('d','insurance')===false &&
    insuranceShortcut('d','player')===null &&
    insuranceShortcut('h','insurance')===null,
    'insurance shortcuts are active only during the insurance offer');
  const missed={kind:'play',cards:[10,6],dealerUp:10,chosen:'stand',best:'hit',
    legal:['hit','stand'],rules,chosenEV:-0.6,bestEV:-0.5,evCost:1};
  const training=analyzeTraining([{roundId:1,decisions:[missed,missed]},
    {roundId:2,decisions:[{...missed,chosen:'hit',evCost:0}]}]);
  assert(training.decisions===3 && training.misses===2 &&
    training.patterns.length===1 && training.patterns[0].count===2 &&
    training.scenarios.length===1 && training.scenarios[0].count===2,
    'training groups only missed decisions and deduplicates situations');
  assert(trainingScenarioKey(missed)!==trainingScenarioKey({...missed,rules:{...rules,soft17:true}}) &&
    trainingScenarioKey(missed)!==trainingScenarioKey({...missed,legal:['hit','stand','double']}),
    'practice situations remain separate when rules or legal actions differ');
  const improving=analyzeTraining([{roundId:1,decisions:Array(10).fill(missed)},
    {roundId:2,decisions:Array(10).fill({...missed,chosen:'hit'})}]);
  assert(improving.trend.previousRate===0 && improving.trend.recentRate===1,
    'training compares recent decisions with the preceding window');
  const dist=dealerDistribution(10,rules,true);
  assert(Math.abs(Object.values(dist).reduce((a,b)=>a+b,0)-1)<1e-10,'dealer distribution sums to one');
  assert(!('blackjack' in dist),'peek conditions away dealer blackjack');
  const shoe=makeShoe(1,()=>0);
  assert(shoe.length===52 && Array.from({length:13},(_,i)=>i+1).every(r=>shoe.filter(c=>c.rank===r).length===4) &&
    new Set(shoe.map(c=>c.rank+':'+c.suit)).size===52,'one deck has all 52 distinct ranks and suits');
  let game=newGame(rules,[1,9,10,7]);game=reduceGame(game,{type:'deal'});
  assert(game.phase==='settled' && game.bankroll===1015,'natural blackjack pays 3:2');
  game=newGame(rules,[10,1,6,10]);game=reduceGame(game,{type:'deal'});
  assert(game.phase==='insurance' && game.runningCount===-1,'dealer hole card stays hidden from count');
  game=reduceGame(game,{type:'insurance',take:true});
  assert(game.phase==='settled' && game.bankroll===1000 && game.runningCount===-2,
    'insurance pays 2:1 against dealer blackjack and reveals hole card');
  game=newGame({...rules,peek:false},[10,1,6,10]);
  game=reduceGame(game,{type:'deal'});game=reduceGame(game,{type:'insurance',take:false});
  assert(!legalActions(game).includes('surrender'),'surrender is never a legal action');
  game=reduceGame(game,{type:'action',action:'stand'});
  assert(game.bankroll===990,'no-peek dealer blackjack resolves after player stands');
  game=newGame({...rules,resplitAces:true},[1,6,1,10,1,2,3,4]);
  game=reduceGame(game,{type:'deal'});game=reduceGame(game,{type:'action',action:'split'});
  assert(game.phase==='player' && legalActions(game).includes('split') &&
    !legalActions(game).includes('hit'),'split aces can resplit but cannot hit');
  game=newGame(rules,[10,10,6,7]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'action',action:'stand'});
  assert(game.round.review[0].legal.includes('hit') &&
    Number.isFinite(game.round.review[0].evs.hit) &&
    game.round.review[0].rules.decks===rules.decks,
    'completed decisions retain legal actions, EVs and rules for practice');
  game=newGame(rules,[10,6,5,10]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'action',action:'hit'});
  assert(game.phase==='settled' && game.bankroll===1000 && game.needsShuffle,
    'exhausted shoe refunds wagers');
  game=newGame(rules,[10,6,6,10,10]);
  game=reduceGame(game,{type:'deal'});game=reduceGame(game,{type:'action',action:'stand'});
  assert(game.review.length===1 && game.review[0].best==='stand' &&
    game.round.results[0]==='Win','review records best action and result');
  let session=recordRound(newSession(1000),game.round,game.bankroll);
  assert(session.rounds===1 && session.hands===1 && session.wins===1 &&
    session.optimalDecisions===1 && session.net===10 && session.totalWagered===10,
    'session aggregates a winning round and decision');
  game=newGame(rules,[10,10,6,7]);
  game=reduceGame(game,{type:'deal'});game=reduceGame(game,{type:'action',action:'stand'});
  assert(game.review[0].best==='hit' && game.review[0].evCost>0,
    'review flags a suboptimal stand');
  game=newGame(rules,[8,6,8,10,2,3,10]);
  game=reduceGame(game,{type:'deal'});game=reduceGame(game,{type:'action',action:'split'});
  game=reduceGame(game,{type:'action',action:'stand'});
  game=reduceGame(game,{type:'action',action:'stand'});
  session=recordRound(newSession(1000),game.round,game.bankroll);
  assert(session.hands===2 && session.splits===1 && session.totalWagered===20,
    'split hands and extra stake count in session statistics');
  game=newGame(rules,[10,1,6,10]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'insurance',take:true});
  assert(game.review[0].best==='declineInsurance' && game.review[0].evCost>0,
    'insurance reviewed by expected value, not the realized payout');
  session=recordRound(newSession(1000),game.round,game.bankroll);
  assert(session.insuranceBets===1 && session.net===0 && session.losses===1,
    'insurance statistics preserve main-hand result and round net');
  game=newGame(rules,[1,9,10,7]);game=reduceGame(game,{type:'deal'});
  session=recordRound(newSession(1000),game.round,game.bankroll);
  assert(session.blackjacks===1 && session.wins===1 && session.decisions===0,
    'natural blackjack counts as win without a player decision');
  let coaching=newSession(1000);
  for(let i=0;i<50;i++) {
    const missed=i<5;
    const review=[{kind:'play',chosen:missed?'stand':'hit',best:'hit',
      cards:[10,6],dealerUp:10,handIndex:0,evCost:missed?2:0}];
    coaching=recordRound(coaching,{id:i+1,void:false,net:-10,bet:10,wagered:10,
      results:['Lose'],review,shoeSerial:1},990-i*10);
  }
  assert(coaching.coachReports.length===2 && coaching.coachReports[0].milestone===25 &&
    coaching.coachReports[0].current.topPattern.count===5,
    'coach reports arrive at 25-hand checkpoints');
  assert(coaching.coachReports[1].previous.optimal===20 &&
    coaching.coachReports[1].current.optimal===25,
    'coach compares the current 25 hands with the previous 25');
  let splitCheckpoint=newSession(1000);
  for(let i=0;i<24;i++) splitCheckpoint=recordRound(splitCheckpoint,
    {id:i+1,void:false,net:0,bet:10,wagered:10,results:['Push'],review:[],shoeSerial:1},1000);
  splitCheckpoint=recordRound(splitCheckpoint,{id:25,void:false,net:0,bet:10,wagered:40,
    results:['Push','Push','Push','Push'],review:[],shoeSerial:1},1000);
  assert(splitCheckpoint.hands===28 && splitCheckpoint.coachReports.length===1 &&
    splitCheckpoint.coachReports[0].current.hands===25,
    'split hands count toward the next exact 25-hand block');
  const near=(actual,expected)=>Math.abs(actual-expected)<.00000051;
  // Independent six-decimal reference EVs, Wizard of Odds Appendix 9.
  // Six-deck S17 table, section 6ds17r4 (retrieved October 2026).
  for(const [cards,up,expected] of [
    [[6,5],1,[-.661883,.147596,.129710]],
    [[1,2],5,[-.159409,.137333,.139852]],
    [[10,2],4,[-.211115,-.210364,-.420729]],
    [[9,3],4,[-.208039,-.215390,-.430780]]]){
    const evs=solverFor(rules,up,true,cards).actions(cards);
    ['stand','hit','double'].forEach((action,i)=>assert(near(evs[action],expected[i]),'published EV '+cards+' vs '+up+' '+action));
  }
  const oneEV=solverFor({...rules,decks:1},1,true,[6,5]).actions([6,5]);
  assert(near(oneEV.hit,.172946)&&near(oneEV.double,.240259),'published single-deck 6+5 vs A EV');
  assert(choice([6,5],6,rules,{funds:0})==='hit','unaffordable double falls back to hit');
  assert(!('split' in solverFor(rules,6,true,[8,8]).actions([8,8],{funds:0})), 'unaffordable split excluded');
  assert(decisionOptimal({chosen:'hit',best:'stand',chosenEV:.1,bestEV:.1}), 'equal EV choices are not mistakes');
  assert(normalizeRules({decks:3,soft17:'false',maxHands:0,minBet:NaN}).decks===6,
    'invalid stored rule values fall back safely');
  const face={rank:11,suit:0},queen={rank:12,suit:1},king={rank:13,suit:2};
  assert(handValue([face,queen]).total===20&&handValue([1,king]).blackjack&&hiLo(king)===-1,
    'J/Q/K have ten value and count correctly');
  assert(isPair([face,king]),'mixed ten-value cards may split');
  game=newGame(rules,[face,6,queen,10,10]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'action',action:'stand'});
  session=recordRound(newSession(1000),game.round,game.bankroll);
  assert(session.twoFaceHands===1&&session.twoTenValueHands===1&&session.exposedCards===5&&
    session.rankCounts[10]===1&&session.rankCounts[11]===1&&session.dealerBusts===1,
    'face-card frequencies and bust statistics retain real ranks');
  game=newGame(rules,[face,6,king,10,2,10,3,10]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'action',action:'split'});
  assert(game.position===5&&game.hands[1].cards.length===1,'second split hand waits its turn to receive a card');
  game=reduceGame(game,{type:'action',action:'hit'});
  assert(game.active===1&&game.hands[0].result===undefined&&game.hands[1].cards[1]===3,
    'split first hand consumes its hit before next hand gets a card');
  game=reduceGame(game,{type:'action',action:'stand'});
  assert(game.bankroll===1000&&game.round.results.join(',')==='Bust,Win','split ledger and bust result');
  game=newGame(rules,[1,6,1,10,king,9,10]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'action',action:'split'});
  assert(game.phase==='settled'&&game.bankroll===1020&&game.hands.every(h=>h.cards.length===2)&&
    game.round.results.every(r=>r==='Win'),'split aces receive one card; split 21 pays even money');
  game=newGame(rules,[8,6,8,10,8,8,8,2,3,4,10]);game=reduceGame(game,{type:'deal'});
  for(let i=0;i<3;i++)game=reduceGame(game,{type:'action',action:'split'});
  assert(game.hands.length===4&&!legalActions(game).includes('split'),'global four-hand split limit');
  while(game.phase==='player')game=reduceGame(game,{type:'action',action:'stand'});
  assert(game.round.wagered===40&&game.bankroll===1040,'all resplit stakes settle exactly once');
  game=newGame({...rules,startingBankroll:10},[8,6,8,10,10]);game=reduceGame(game,{type:'deal'});
  assert(!legalActions(game).includes('double')&&!legalActions(game).includes('split'),'insufficient bankroll disables extra wagers');
  game=newGame({...rules,das:false},[8,6,8,10,3,2,10]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'action',action:'split'});
  assert(!legalActions(game).includes('double'),'no-DAS rule enforced');
  game=newGame({...rules,doubleRule:'9-11'},[1,6,6,10]);game=reduceGame(game,{type:'deal'});
  assert(!legalActions(game).includes('double'),'restricted doubling excludes soft 17');
  game=newGame(rules,[6,6,5,10,10,10]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'action',action:'double'});
  assert(game.bankroll===1020&&game.round.wagered===20,'double gets exactly one card and double payout');
  game=newGame({...rules,payout:1.2,minBet:11},[1,9,king,8]);game=reduceGame(game,{type:'deal'});
  assert(game.bankroll===1013.2&&game.round.net===13.2,'6:5 payout rounds to currency precision');
  game=newGame(rules,[1,1,king,queen]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'insurance',take:false});
  assert(game.bankroll===1000&&game.round.results[0]==='Push','both naturals push');
  game=newGame(rules,[1,1,king,queen]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'insurance',take:true});
  assert(game.bankroll===1010&&game.round.net===10,'natural push with winning insurance');
  game=newGame(rules,[10,1,9,7]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'insurance',take:true});game=reduceGame(game,{type:'action',action:'stand'});
  assert(game.bankroll===1005&&game.round.wagered===15,'losing insurance deducted alongside winning main hand');
  for(const soft17 of [false,true]){
    game=newGame({...rules,soft17},[10,1,8,6,2]);game=reduceGame(game,{type:'deal'});
    game=reduceGame(game,{type:'insurance',take:false});game=reduceGame(game,{type:'action',action:'stand'});
    assert(game.position===(soft17?5:4)&&game.bankroll===(soft17?990:1010),'dealer '+(soft17?'H17':'S17')+' enforced');
  }
  game=newGame({...rules,peek:false},[6,1,5,queen,10]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'insurance',take:false});game=reduceGame(game,{type:'action',action:'double'});
  assert(game.bankroll===980&&game.round.net===-20,'no peek: dealer blackjack takes doubled stake');
  game=newGame({...rules,peek:false},[8,queen,8,1,3,2]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'action',action:'split'});
  while(game.phase==='player')game=reduceGame(game,{type:'action',action:'stand'});
  assert(game.bankroll===980,'no peek: dealer blackjack takes all split wagers');
  game=newGame(rules,[10,6,6,10,10,2,3,4]);game=reduceGame(game,{type:'deal'});
  game=reduceGame(game,{type:'rules',rules:{...rules,decks:1}});
  assert(game.rules.decks===6&&game.pendingRules.decks===1,'rule changes deferred during current hand');
  game=reduceGame(game,{type:'action',action:'stand'});
  game=reduceGame(game,{type:'deal',shoe:[10,9,10,8,2,3,4,5]});
  assert(game.rules.decks===1&&game.shoeSerial===2&&game.position===4&&game.runningCount===-2,'new rules shuffle between hands and reset count');
  game=newGame({...rules,penetration:.5},[10,6,6,10,10,2,3,4]);game=reduceGame(game,{type:'deal'});
  assert(game.shoeSerial===1&&game.position===4,'cut card never interrupts a live hand');
  game=reduceGame(game,{type:'action',action:'stand'});
  assert(game.needsShuffle&&game.position===5,'cut card schedules next-hand shuffle');
  game=reduceGame(game,{type:'deal',shoe:[10,9,10,8,2,3,4,5]});
  assert(game.shoeSerial===2&&game.position===4,'fresh shoe replaces old shoe only between hands');
  // Side-bet categories use actual ranks/suits, independently of blackjack value.
  const sideCard=(rank,suit=0)=>({rank,suit});
  const categoryCases=[
    ['perfectPairs',[[11,0],[11,0]],'perfect'],
    ['perfectPairs',[[12,1],[12,2]],'colored'],
    ['perfectPairs',[[13,0],[13,3]],'colored'],
    ['perfectPairs',[[10,0],[10,1]],'mixed'],
    ['perfectPairs',[[11,0],[12,0]],'lose'],
    ['twentyOneThree',[[7,0],[7,0],[7,0]],'suitedTrips'],
    ['twentyOneThree',[[7,0],[7,1],[7,2]],'trips'],
    ['twentyOneThree',[[1,0],[2,0],[3,0]],'straightFlush'],
    ['twentyOneThree',[[12,0],[13,1],[1,2]],'straight'],
    ['twentyOneThree',[[10,0],[11,1],[12,2]],'straight'],
    ['twentyOneThree',[[13,0],[1,1],[2,2]],'lose'],
    ['twentyOneThree',[[10,0],[11,0],[13,0]],'flush'],
    ['twentyOneThree',[[11,0],[12,1],[13,2]],'straight'],
    ['twentyOneThree',[[11,0],[12,1],[10,2]],'straight'],
    ['twentyOneThree',[[10,0],[12,1],[13,2]],'lose'],
    ['luckyLucky',[[7,0],[7,0],[7,0]],'suited777'],
    ['luckyLucky',[[6,1],[7,1],[8,1]],'suited678'],
    ['luckyLucky',[[7,0],[7,1],[7,2]],'triple777'],
    ['luckyLucky',[[8,0],[6,1],[7,2]],'run678'],
    ['luckyLucky',[[1,0],[11,0],[12,0]],'suited21'],
    ['luckyLucky',[[1,0],[11,1],[13,2]],'total21'],
    ['luckyLucky',[[1,0],[1,1],[9,2]],'total21'],
    ['luckyLucky',[[11,0],[8,1],[2,2]],'total20'],
    ['luckyLucky',[[13,0],[7,1],[2,2]],'total19'],
    ['luckyLucky',[[1,0],[1,1],[8,2]],'total20'],
    ['luckyLucky',[[10,0],[10,1],[2,2]],'lose']
  ];
  for(const [id,values,expected]of categoryCases){
    const cards=values.map(([rank,suit])=>sideCard(rank,suit));
    assert(sideBetCategory(id,cards)===expected&&sideBetCategory(id,[...cards].reverse())===expected,
      id+' category '+expected+' is independent of card order: '+JSON.stringify(values));
  }
  const perfectResult=sideBetResult('perfectPairs','standard',2.5,[sideCard(7),sideCard(7)]);
  assert(perfectResult.paid===65&&perfectResult.net===62.5&&perfectResult.odds===25,
    'x:1 side-bet payout means profit plus the original stake');
  assert(sideBetResult('twentyOneThree','enhanced',1,Array(3).fill(sideCard(7))).paid===101,
    'overlapping categories pay the highest category once, not accumulated payouts');
  assert(sideBetResult('perfectPairs','invalid',1,[sideCard(7),sideCard(7)]).profile==='standard'&&
    normalizeSideProfiles(null).luckyLucky==='standard','invalid stored side profiles fall back safely');
  let invalidSideCards=false;try{sideBetCategory('perfectPairs',[10,10]);}catch{invalidSideCards=true;}
  assert(invalidSideCards,'side bets reject value-only cards instead of inventing suits or ranks');
  for(const decks of [1,2,4,6,8])for(const id of SIDE_BET_IDS){
    const distribution=sideBetDistribution(id,decks);
    assert(Object.values(distribution.counts).reduce((sum,n)=>sum+n,0)===distribution.combinations,
      id+' '+decks+'-deck combinatorial counts exhaust the entire sample space');
    assert(Math.abs(Object.values(distribution.probabilities).reduce((sum,p)=>sum+p,0)-1)<1e-12,
      id+' '+decks+'-deck probabilities sum to one');
    for(const profile of Object.keys(SIDE_BETS[id].profiles))assert(sideBetOdds(id,profile,decks).houseEdge>0,
      id+' '+profile+' '+decks+'-deck preset has a fresh-shoe house advantage');
  }
  assert(sideBetDistribution('perfectPairs',1).counts.perfect===0&&
    sideBetDistribution('twentyOneThree',2).counts.suitedTrips===0&&
    sideBetDistribution('luckyLucky',2).counts.suited777===0,
    'impossible duplicate-card wins have zero probability with insufficient decks');
  // Independent published combination counts and six-decimal EVs, Wizard of Odds.
  const publishedSix={
    perfectPairs:{perfect:780,colored:936,mixed:1872,lose:44928},
    twentyOneThree:{suitedTrips:1040,straightFlush:10368,trips:25272,straight:155520,flush:292896,lose:4528224},
    luckyLucky:{suited777:80,suited678:864,triple777:1944,run678:12960,suited21:26568,
      total21:406296,total20:377568,total19:364320,lose:3822720}
  };
  for(const id of SIDE_BET_IDS)for(const [category,n]of Object.entries(publishedSix[id]))
    assert(sideBetDistribution(id,6).counts[category]===n,'published six-deck '+id+' combinations: '+category);
  for(const [id,profile,expected]of [
    ['perfectPairs','standard',-.041801],['perfectPairs','alternative',-.057878],
    ['perfectPairs','live',-.061093],['twentyOneThree','standard',-.032386],
    ['luckyLucky','standard',-.026556]])
    assert(near(sideBetOdds(id,profile,6).ev,expected),'published six-deck '+id+' '+profile+' EV');
  const enhancedEight={suitedTrips:2912,straightFlush:24576,trips:61568,straight:368640,flush:700928,lose:10753536};
  for(const [category,n]of Object.entries(enhancedEight))
    assert(sideBetDistribution('twentyOneThree',8).counts[category]===n,'published eight-deck 21+3 '+category+' combinations');
  assert(near(sideBetOdds('twentyOneThree','enhanced',8).ev,-.037039),'published enhanced eight-deck 21+3 EV');
  const allSides={perfectPairs:1,twentyOneThree:1,luckyLucky:1};
  const prepareSides=(cards,bets=allSides,changes={})=>reduceGame(newGame({...rules,...changes},cards),
    {type:'sideBets',bets});
  const openingSideShoe=[sideCard(7),sideCard(7),sideCard(7),sideCard(10,3),sideCard(2),sideCard(3)];
  let sideGame=prepareSides(openingSideShoe);
  const beforeSides=sideGame;
  sideGame=reduceGame(sideGame,{type:'deal'});
  assert(beforeSides.bankroll===1000&&beforeSides.position===0&&sideGame.bankroll===1224&&
    sideGame.phase==='player'&&sideGame.sideResults.length===3&&sideGame.runningCount===0,
    'opening side wins credit once before player decisions without mutating input or revealing the hole card');
  assert(reduceGame(sideGame,{type:'sideBets',bets:emptySideBets()})===sideGame,
    'side bets and payout profiles cannot change mid-hand');
  sideGame=reduceGame(sideGame,{type:'action',action:'stand'});
  assert(sideGame.bankroll===1224&&sideGame.round.mainNet===-10&&sideGame.round.sideNet===234&&
    sideGame.round.net===224&&sideGame.round.wagered===13,
    'side wins remain independent of a losing main hand and never pay twice');
  const sideSession=recordRound(newSession(1000),sideGame.round,sideGame.bankroll);
  assert(sideSession.mainNet===-10&&sideSession.sideNet===234&&sideSession.sideWagered===3&&
    sideSession.totalWagered===13&&sideSession.decisions===1&&sideSession.hands===1&&sideSession.losses===1&&
    SIDE_BET_IDS.every(id=>sideSession.sideStats[id].bets===1&&sideSession.sideStats[id].wins===1),
    'side statistics reconcile separately and never inflate blackjack hand or decision accuracy');
  sideGame=prepareSides([sideCard(1),sideCard(9),sideCard(13),sideCard(8,2)]);
  sideGame=reduceGame(sideGame,{type:'deal'});
  assert(sideGame.bankroll===1025&&sideGame.round.mainNet===15&&sideGame.round.sideNet===10,
    'player natural and opening side bets settle independently');
  sideGame=prepareSides([sideCard(10),sideCard(1,2),sideCard(10,1),sideCard(13,3)]);
  sideGame=reduceGame(sideGame,{type:'deal'});
  assert(sideGame.phase==='insurance'&&sideGame.bankroll===997,'side payouts use dealer upcard, not hidden blackjack card');
  sideGame=reduceGame(sideGame,{type:'insurance',take:true});
  assert(sideGame.bankroll===1007&&sideGame.round.mainNet===-10&&sideGame.round.insuranceNet===10&&
    sideGame.round.sideNet===7&&sideGame.round.wagered===18,
    'dealer blackjack preserves opening side wins and resolves insurance separately');
  sideGame=prepareSides([sideCard(8),sideCard(6,1),sideCard(8),sideCard(10,3),
    sideCard(3,3),sideCard(2,3),sideCard(10)]);
  sideGame=reduceGame(sideGame,{type:'deal'});sideGame=reduceGame(sideGame,{type:'action',action:'split'});
  while(sideGame.phase==='player')sideGame=reduceGame(sideGame,{type:'action',action:'stand'});
  assert(sideGame.bankroll===1043&&sideGame.round.mainNet===20&&sideGame.round.sideNet===23&&
    sideGame.round.wagered===23&&sideGame.sideResults.length===3,
    'splitting does not add new side wagers or evaluate split-card combinations');
  sideGame=prepareSides(openingSideShoe,allSides,{startingBankroll:13});
  sideGame=reduceGame(sideGame,{type:'deal'});
  assert(sideGame.bankroll===237&&legalActions(sideGame).includes('split'),
    'opening side winnings become available for casino-style split or double stakes');
  sideGame=prepareSides(openingSideShoe,allSides,{startingBankroll:12});
  sideGame=reduceGame(sideGame,{type:'deal'});
  assert(sideGame.position===0&&sideGame.bankroll===12&&sideGame.phase==='betting',
    'aggregate main-plus-side affordability checked before consuming any cards');
  for(const amount of [-1,NaN,501]){
    const fresh=newGame(rules,openingSideShoe),rejected=reduceGame(fresh,
      {type:'sideBets',bets:{...emptySideBets(),perfectPairs:amount}});
    assert(rejected.sideBets.perfectPairs===0&&rejected.bankroll===1000,'invalid side wager rejected: '+amount);
  }
  for(const length of [3,4]){
    sideGame=prepareSides(openingSideShoe.slice(0,length));
    sideGame=reduceGame(sideGame,{type:'deal'});
    if(sideGame.phase==='player')sideGame=reduceGame(sideGame,{type:'action',action:'hit'});
    const unchangedSession=newSession(1000);
    assert(sideGame.round.void&&sideGame.bankroll===1000&&sideGame.sideResults.length===0&&
      recordRound(unchangedSession,sideGame.round,sideGame.bankroll)===unchangedSession,
      'shoe exhaustion refunds all wagers and reverses paid side winnings: '+length+' cards');
  }
  sideGame=prepareSides(openingSideShoe,{...emptySideBets(),perfectPairs:20});
  sideGame=reduceGame(sideGame,{type:'rules',rules:{...rules,maxBet:10}});
  sideGame=reduceGame(sideGame,{type:'deal',shoe:openingSideShoe});
  assert(sideGame.bankroll===1000&&sideGame.position===0&&sideGame.message.includes('maximum'),
    'a reduced table maximum prevents over-limit side wagers on the next deal');
  // Published 4-8 deck S17, DAS, no-surrender total-dependent chart.
  // 10+2 vs 4 is a composition exception in 4/6 decks, not 8 (Appendix 9).
  function chartAction(cards,up) {
    const v=handValue(cards),t=v.total,pair=cards[0]===cards[1],rank=cards[0];
    if(pair) {
      if(rank===1||rank===8) return 'split';
      if(rank===2||rank===3||rank===7) return up>=2&&up<=7?'split':'hit';
      if(rank===4) return up===5||up===6?'split':'hit';
      if(rank===6) return up>=2&&up<=6?'split':'hit';
      if(rank===9) return up>=2&&up<=6||up===8||up===9?'split':'stand';
    }
    if(v.soft) {
      if(t<=18) {
        const first=t<=14?5:t<=16?4:3;
        if(up>=first&&up<=6) return 'double';
      }
      if(t<=17) return 'hit';
      if(t===18) return up>=9||up===1?'hit':'stand';
      return 'stand';
    }
    if(t===9&&up>=3&&up<=6||t===10&&up>=2&&up<=9||t===11&&up>=2&&up<=10) return 'double';
    if(t<=11) return 'hit';
    if(t===12) return up>=4&&up<=6?'stand':'hit';
    if(t<=16) return up>=2&&up<=6?'stand':'hit';
    return 'stand';
  }
  const chartHands=[];
  for(let total=5;total<=20;total++) {
    const cards=total<=11?[2,total-2]:[10,total-10];
    if(cards[0]!==cards[1]) chartHands.push(cards);
  }
  for(let rank=2;rank<=9;rank++) chartHands.push([1,rank]);
  for(let rank=1;rank<=10;rank++) chartHands.push([rank,rank]);
  for(const decks of [4,6,8]) for(const cards of chartHands)
    for(const up of [2,3,4,5,6,7,8,9,10,1]) {
      const chartRules={...rules,decks};
      const actual=bestAction(solverFor(chartRules,up,true,cards).actions(cards));
      const expected=decks<8&&cards[0]===10&&cards[1]===2&&up===4?'hit':chartAction(cards,up);
      assert(actual===expected,`${decks} decks: ${cards.join('+')} vs ${up}`);
    }
  return 'All '+passed+' self-tests passed.';
}
if(typeof module!=='undefined' && module.exports) module.exports={DEFAULT_RULES,SIDE_BETS,SIDE_BET_IDS,emptySideBets,normalizeSideProfiles,sideBetCategory,sideBetResult,sideBetDistribution,sideBetOdds,normalizeRules,cardRank,cardValue,isPair,decisionOptimal,roundMoney,insuranceExpectedValue,handValue,hiLo,
  countSequence,beginnerShortcut,newBeginnerDrill,answerBeginnerDrill,insuranceShortcut,makeShoe,dealerDistribution,solverFor,bestAction,newGame,legalActions,
  legalEVs,newSession,recordRound,buildCoachReport,trainingFamily,trainingScenarioKey,
  analyzeTraining,reduceGame,runSelfTests};
