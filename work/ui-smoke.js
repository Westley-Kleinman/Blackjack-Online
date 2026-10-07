'use strict';
// Unit-level UI smoke test with a minimal DOM double; not a visual browser test.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const html=fs.readFileSync('outputs/blackjack.html','utf8');
const markup=html.split('<script>')[0],markupIds=[...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(markupIds.length,new Set(markupIds).size,'HTML IDs must be unique');
const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
assert.equal([...css].filter(c=>c==='{').length,[...css].filter(c=>c==='}').length,'CSS braces must balance');
assert(!/hintBtn|hintPanel|view-hints|renderHint|showHint/.test(html),'hint controls and implementation removed');
// Verify nesting in the delivered markup, not just the presence of betting controls.
const tagStack=[],voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const detailOnlyIds=new Set(['sideStakeSummary','sideKeyboardHelp','sideTotalStake','clearSideBets',
  ...['sidePerfect','sideThree','sideLucky'].flatMap(prefix=>['Stake','Profile','Description','Odds','Pays','State'].map(suffix=>prefix+suffix))]);
for(const match of html.replace(/<script>[\s\S]*?<\/script>/g,'').matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*?)>/gi)){
  const tag=match[2].toLowerCase();
  if(match[1]){assert.equal(tagStack.pop()?.tag,tag,'balanced closing tag '+tag);continue;}
  const id=match[3].match(/\bid="([^"]+)"/)?.[1];
  if(id==='sideBetPanel')assert(tagStack.some(parent=>parent.id==='feltTable'),'side-bet section is on the felt table');
  if(detailOnlyIds.has(id))assert(tagStack.some(parent=>parent.id==='sideBetDetails'),id+' belongs below the table');
  if(['sidePerfectToggle','sideThreeToggle','sideLuckyToggle'].includes(id))
    assert(tagStack.some(parent=>parent.id==='sideBetPanel'),id+' is a numbered table spot');
  if(!voidTags.has(tag))tagStack.push({tag,id});
}
assert.equal(tagStack.length,0,'all markup elements closed');
assert(markup.indexOf('id="reviewPanel"')<markup.indexOf('id="sideBetDetails"'),
  'hand review is shown before the longer payout guide');
function boot(storageBlocked=false,savedEntries=[]){
  const elements=[],byId=new Map(),byName=new Map(),listeners=new Map();
  let document;
  function element(tag,attributes={}){
    const classes=new Set((attributes.class||'').split(/\s+/));
    const el={id:attributes.id||'',tagName:tag.toUpperCase(),dataset:{},style:{},children:[],
      textContent:'',innerHTML:'',value:attributes.value||'',type:attributes.type||'',checked:false,disabled:false,
      classList:{contains:c=>classes.has(c),add(...names){names.forEach(c=>classes.add(c))},remove(...names){names.forEach(c=>classes.delete(c))},toggle(c,on){if(on===undefined)on=!classes.has(c);on?classes.add(c):classes.delete(c);return on}},
      handlers:new Map(),queries:new Map(),
      addEventListener(type,fn){this.handlers.set(type,fn)},
      querySelector(selector){if(!this.queries.has(selector))this.queries.set(selector,element('span'));return this.queries.get(selector)},
      appendChild(child){child.parent=this;return child},
      setAttribute(name,value){this[name]=value},focus(){document.activeElement=this},checkValidity(){return Number.isFinite(Number(this.value))},
      fire(type,extra={}){this.handlers.get(type)?.({target:this,preventDefault(){},...extra})}};
    for(const [name,value]of Object.entries(attributes))if(name.startsWith('data-'))
      el.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
    elements.push(el);if(el.id)byId.set(el.id,el);if(attributes.name)byName.set(attributes.name,el);
    return el;
  }
  for(const match of html.split('<script>')[0].matchAll(/<([a-z][\w-]*)\b([^>]*?)>/gi)){
    const attributes=Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    element(match[1],attributes);
  }
  document={activeElement:element('body'),getElementById:id=>{assert(byId.has(id),'missing '+id);return byId.get(id)},
    querySelectorAll:selector=>elements.filter(el=>selector.startsWith('.')?el.classList.contains(selector.slice(1)):
      selector.startsWith('[data-')?Object.hasOwn(el.dataset,selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())):false),
    addEventListener(type,fn){listeners.set(type,fn)}};
  byId.get('settingsForm').elements={namedItem:name=>byName.get(name)};
  byId.get('lessonDots').children=Array.from({length:4},()=>element('span'));
  const saved=new Map(savedEntries),context={document,console,crypto:webcrypto,Uint32Array,
    localStorage:{getItem(key){if(storageBlocked)throw Error('blocked');return saved.get(key)??null},
      setItem(key,value){if(storageBlocked)throw Error('blocked');saved.set(key,value)}},
    setTimeout(){return 1},clearTimeout(){},alert(){},confirm(){return true}};
  context.window=context;
  let script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  script=script.replace('moveSurface();render();renderLesson();renderBeginner();',
    `globalThis.testUI={get game(){return game},get session(){return session},get beginner(){return beginner},
      setup(rules,shoe){game=newGame(rules,shoe);session=newSession(game.bankroll);lastRecordedRoundId=0;lastVisual.roundId=-1;switchTab('play')},
      apply,switchTab,switchTrainer,startBeginner,answerTraining,openSettings,closeSettings,deal,resetFullSession};moveSurface();render();renderLesson();renderBeginner();`);
  vm.runInNewContext(script,context,{timeout:10000});
  return {ui:context.testUI,ids:byId,context,key:(key,extra={})=>listeners.get('keydown')({key,preventDefault(){},...extra})};
}
const {ui,ids,key}=boot(),rules=ui.game.rules;
const j={rank:11,suit:0},q={rank:12,suit:1},k={rank:13,suit:2};
ui.setup(rules,[j,6,q,10,10]);ui.apply({type:'deal'});
assert(ids.get('hands').innerHTML.includes('J of spades'));
assert(ids.get('hands').innerHTML.includes('Q of hearts'));
assert(ids.get('hands').innerHTML.includes('card red'));
assert(!ids.has('view-hints')&&!ids.has('hintBtn')&&!ids.has('hintPanel'));
key('s');ui.switchTab('stats');
assert.equal(ids.get('statWinRate').textContent,'100.0%');
assert(ids.get('dealStats').innerHTML.includes('1 / 1 · 100.0%'));
assert.equal((ids.get('rankFrequencies').innerHTML.match(/class="rank-frequency"/g)||[]).length,13);
ui.setup(rules,[k,j,6,7]);ui.apply({type:'deal'});key('s');ui.switchTab('training');
assert.equal(ids.get('trainingMisses').textContent,'1');
assert(ids.get('trainingPlayer').innerHTML.includes('K of diamonds'));
ui.answerTraining('hit');assert(ids.get('trainingFeedback').innerHTML.includes('Correct.'));
ui.setup(rules,[10,1,6,q]);ui.apply({type:'deal'});key('a');
assert.equal(ui.game.phase,'settled');assert.equal(ui.game.bankroll,1000);
ui.setup(rules,[6,1,5,7,10]);ui.apply({type:'deal'});key('d');
assert.equal(ui.game.phase,'player');assert.equal(ui.game.insurance,0);
key('d');assert.equal(ui.game.phase,'settled');assert.equal(ui.game.hands[0].wager,20);
ui.setup(rules,[10,6,6,10,10,2,3,4]);ui.apply({type:'deal'});
ui.apply({type:'rules',rules:{...rules,decks:1}});key('s');
assert(ui.game.needsShuffle);ui.deal();assert.equal(ui.game.shoeSerial,2);assert.equal(ui.game.rules.decks,1);
ui.resetFullSession();assert.equal(ui.session.rounds,0);assert.equal(ui.game.bankroll,1000);
ui.setup(rules,[j,9,q,10]);ui.apply({type:'deal'});key('s');ui.switchTab('stats');
assert.equal(ids.get('statWinRate').textContent,'100.0%');
const blocked=boot(true);assert(blocked.ids.get('message').textContent.includes('Storage unavailable'));
const engine=require('./engine.js');
// Actual UI inputs and handlers, with separate side settlement/statistics.
const sideCard=(rank,suit=0)=>({rank,suit});
const winningSides=[sideCard(7),sideCard(7),sideCard(7),sideCard(10,3),sideCard(2),sideCard(3)];
ui.setup(rules,winningSides);
assert(ids.get('sidePerfectChip').classList.contains('hidden'),'inactive table spots show only a number and name');
for(const prefix of ['sidePerfect','sideThree','sideLucky']){
  const input=ids.get(prefix+'Stake');assert.equal(Number(input.value),0);input.focus();input.value='1';input.fire('change');
}
ids.get('dealBtn').focus();
assert.equal(ids.get('sideStakeSummary').textContent,'£3.00');
assert(ids.get('sideTotalStake').textContent.includes('£13.00'));
assert(ids.get('sidePerfectOdds').textContent.includes('4.18%'));
ui.deal();assert.equal(ui.game.bankroll,1224);
assert(!ids.get('sideBetPanel').classList.contains('hidden'),'betting spots stay visible during the hand');
assert(ids.get('sidePerfectToggle').disabled&&ids.get('sidePerfectStake').disabled);
assert(ids.get('sidePerfectState').textContent.includes('Won +£25.00'));
assert(!ids.get('sideResultPanel').classList.contains('hidden'));
assert(ids.get('sideResults').innerHTML.includes('Suited 7-7-7'));
key('s');ui.switchTab('stats');
assert.equal(ui.session.sideNet,234);assert.equal(ui.session.mainNet,-10);
assert.equal(ids.get('statWinRate').textContent,'0.0%');
assert(ids.get('sideStatsTotals').innerHTML.includes('+£234.00'));
assert(ids.get('sideStatsCards').innerHTML.includes('1 / 1'));
ui.switchTab('play');ids.get('sideThreeProfile').value='enhanced';ids.get('sideThreeProfile').fire('change');
assert.equal(ui.game.sideProfiles.twentyOneThree,'enhanced');
assert(ids.get('sideThreeOdds').textContent.includes('4.62%'));
ui.resetFullSession();
assert.equal(ui.game.sideProfiles.twentyOneThree,'enhanced');
assert.equal(ui.session.sideWagered,0);assert.equal(Number(ids.get('sideThreeStake').value),0);
const restoredProfiles=boot(false,[['blackjack.sideProfiles.v1',JSON.stringify({perfectPairs:'live',twentyOneThree:'enhanced'})]]);
assert.equal(restoredProfiles.ui.game.sideProfiles.perfectPairs,'live');
assert.equal(restoredProfiles.ids.get('sideThreeProfile').value,'enhanced');
assert.equal(Number(restoredProfiles.ids.get('sideThreeStake').value),0,'reload never restores side-bet stakes');
assert.equal(boot(false,[['blackjack.sideProfiles.v1','not json']]).ui.game.sideProfiles.perfectPairs,'standard');
ui.setup({...rules,startingBankroll:12},winningSides);
ids.get('sidePerfectStake').focus();ids.get('sidePerfectStake').value='3';ids.get('sidePerfectStake').fire('input');
assert(ids.get('dealBtn').disabled);assert(ids.get('sideTotalStake').textContent.includes('Exceeds your bankroll'));
ids.get('sidePerfectStake').fire('change');ids.get('dealBtn').focus();ui.deal();
assert.equal(ui.game.bankroll,12);assert.equal(ui.game.position,0);
ids.get('clearSideBets').fire('click');assert.equal(ui.game.sideBets.perfectPairs,0);assert(!ids.get('dealBtn').disabled);
ui.setup(rules,winningSides);
// The on-table chip buttons and keyboard toggles share the same wager logic.
ui.resetFullSession();ui.setup(rules,winningSides);ids.get('dealBtn').focus();
key('1');assert.equal(ui.game.sideBets.perfectPairs,5);
assert.equal(ids.get('sidePerfectChip').textContent,'£5.00');
assert(!ids.get('sidePerfectChip').classList.contains('hidden'),'placed wagers show their chip amount on the felt');
assert.equal(ids.get('sidePerfectToggle')['aria-pressed'],'true');
key('1',{repeat:true});assert.equal(ui.game.sideBets.perfectPairs,5,'holding a key does not repeatedly toggle');
key('1');assert.equal(ui.game.sideBets.perfectPairs,0);
assert(ids.get('sidePerfectChip').classList.contains('hidden'),'removing a wager restores the uncluttered spot');
ids.get('sidePerfectToggle').fire('click');assert.equal(ui.game.sideBets.perfectPairs,5);
ids.get('sidePerfectStake').focus();ids.get('sidePerfectStake').value='2.5';ids.get('sidePerfectStake').fire('change');
ids.get('sidePerfectToggle').focus();key('1');assert.equal(ui.game.sideBets.perfectPairs,0);
key('1');assert.equal(ui.game.sideBets.perfectPairs,2.5,'shortcut restores a custom stake');
key('2');key('3');assert.equal(ui.game.sideBets.twentyOneThree,5);assert.equal(ui.game.sideBets.luckyLucky,5);
key('x');assert(Object.values(ui.game.sideBets).every(amount=>amount===0));
key('1',{ctrlKey:true});key('2',{altKey:true});key('3',{metaKey:true});
assert(Object.values(ui.game.sideBets).every(amount=>amount===0),'browser/OS shortcuts never place bets');
ids.get('betInput').focus();key('1');assert.equal(ui.game.sideBets.perfectPairs,0,'numeric typing in main wager is safe');
ids.get('sideLuckyStake').focus();key('3');assert.equal(ui.game.sideBets.luckyLucky,0,'numeric typing in side wager is safe');
ids.get('sideThreeProfile').focus();key('2');assert.equal(ui.game.sideBets.twentyOneThree,0,'select controls retain native keys');
ids.get('dealBtn').focus();ids.get('dealBtn').isContentEditable=true;key('1');
assert.equal(ui.game.sideBets.perfectPairs,0,'editable content retains numeric input');ids.get('dealBtn').isContentEditable=false;
ids.get('dealBtn').focus();ui.openSettings();key('1');assert.equal(ui.game.sideBets.perfectPairs,0);ui.closeSettings();
ui.switchTab('stats');key('1');assert.equal(ui.game.sideBets.perfectPairs,0);
ui.switchTab('training');key('2');assert.equal(ui.game.sideBets.twentyOneThree,0);
ui.switchTab('trainer');ui.switchTrainer('learn');key('3');assert.equal(ui.game.sideBets.luckyLucky,0);
ui.switchTrainer('live');key('1');assert.equal(ui.game.sideBets.perfectPairs,2.5,'live play supports table shortcuts');
key('x');ui.switchTab('play');
ids.get('sideThreeStake').focus();ids.get('sideThreeStake').value='1';key('n');
assert.equal(ui.game.phase,'player');assert.equal(ui.game.sideBets.twentyOneThree,1,'N deals from a side wager field');
ids.get('dealBtn').focus();const lockedBets=JSON.stringify(ui.game.sideBets);
key('1');key('2');key('3');key('x');ids.get('sidePerfectToggle').fire('click');
assert.equal(JSON.stringify(ui.game.sideBets),lockedBets,'mid-hand shortcuts and clicks never change bets');
assert(!ids.get('sideBetPanel').classList.contains('hidden'));key('s');
ui.setup({...rules,startingBankroll:12},winningSides);ids.get('dealBtn').focus();key('1');
assert.equal(ui.game.sideBets.perfectPairs,0,'shortcut never places an unaffordable wager');
assert.equal(ui.game.bankroll,12);assert(ids.get('sidePerfectToggle').disabled);
assert(ids.get('message').textContent.includes('Not enough bankroll'));
ui.resetFullSession();assert.equal(ui.game.sideBets.perfectPairs,0);
ui.setup(rules,winningSides);ids.get('dealBtn').focus();key('1');
assert.equal(ui.game.sideBets.perfectPairs,5,'full reset clears remembered custom stakes');
key('x');
const lowLimit=boot(false,[['blackjack.rules.v1',JSON.stringify({...rules,minBet:1,maxBet:3})]]);
lowLimit.key('1');assert.equal(lowLimit.ui.game.sideBets.perfectPairs,3,'quick wager respects a table maximum below £5');
const insured=boot();insured.ui.setup(rules,[sideCard(10),sideCard(1,2),sideCard(10,1),sideCard(13,3)]);
insured.ids.get('dealBtn').focus();insured.key('1');insured.key('n');
assert.equal(insured.ui.game.phase,'insurance');const insuredBefore=JSON.stringify(insured.ui.game.sideBets);
insured.key('x');insured.key('2');assert.equal(JSON.stringify(insured.ui.game.sideBets),insuredBefore,'insurance phase also locks side bets');
insured.key('d');assert.equal(insured.ui.game.phase,'settled');
ui.switchTab('trainer');ui.switchTrainer('beginner');
assert(!ids.get('trainerBeginner').classList.contains('hidden'));
assert(ids.get('trainerLearn').classList.contains('hidden'));
const beforePractice=JSON.stringify(ui.game);
ids.get('beginnerDecks').value='2';ids.get('beginnerStart').fire('click');
assert.equal(ui.beginner.cards.length,104);assert(!ids.get('beginnerPlus').disabled);
assert(ids.get('beginnerStage').innerHTML.includes('of '));
key('ArrowUp',{repeat:true});assert.equal(ui.beginner.answered,0);
ids.get('beginnerDecks').focus();key('ArrowDown');assert.equal(ui.beginner.answered,0);
ids.get('beginnerPlus').focus();ui.openSettings();key('ArrowDown');assert.equal(ui.beginner.answered,0);ui.closeSettings();
const firstExpected=engine.hiLo(ui.beginner.cards[0]);
ids.get('beginnerDecks').value='4';ids.get('beginnerDecks').fire('change');
assert.equal(ui.beginner.cards.length,104,'deck selection takes effect only on next run');
key(firstExpected===0?'ArrowUp':'ArrowLeft');assert.equal(ui.beginner.correct,0);
assert.equal(ui.beginner.count,firstExpected);assert(ids.get('beginnerFeedback').classList.contains('wrong'));
while(!ui.beginner.complete){const value=engine.hiLo(ui.beginner.cards[ui.beginner.answered]);
  key(value===1?'ArrowUp':value===-1?'ArrowDown':ui.beginner.answered%2?'ArrowLeft':'ArrowRight')}
assert.equal(ui.beginner.answered,104);assert.equal(ui.beginner.correct,103);assert.equal(ui.beginner.count,0);
assert.equal(ids.get('beginnerProgress').style.width,'100%');assert(ids.get('beginnerPlus').disabled);
assert(ids.get('beginnerStage').innerHTML.includes('Deck complete'));key('ArrowDown');assert.equal(ui.beginner.answered,104);
assert.equal(JSON.stringify(ui.game),beforePractice,'beginner drill leaves live shoe and bankroll untouched');
for(const decks of [1,2,4,6,8]){
  ids.get('beginnerDecks').value=String(decks);ids.get('beginnerStart').fire('click');
  assert.equal(ui.beginner.cards.length,52*decks);
  const value=engine.hiLo(ui.beginner.cards[0]);ids.get(value===1?'beginnerPlus':value===-1?'beginnerMinus':'beginnerZero').fire('click');
  assert.equal(ui.beginner.answered,1);assert.equal(ui.beginner.correct,1);
}
ui.switchTrainer('learn');key('ArrowUp');assert.equal(ui.beginner.answered,1,'arrows only apply in beginner mode');
ui.switchTrainer('beginner');ui.switchTab('stats');
assert(ids.get('countStats').innerHTML.includes('Beginner cards answered'));
ui.resetFullSession();assert.equal(ui.beginner,null);assert.equal(ids.get('beginnerSessionAccuracy').textContent,'—');
blocked.ui.switchTab('trainer');blocked.ids.get('beginnerStart').fire('click');assert.equal(blocked.ui.beginner.cards.length,52);
const restored=boot(false,[['blackjack.beginnerDecks.v1','6']]);assert.equal(restored.ids.get('beginnerDecks').value,'6');
const invalidSaved=boot(false,[['blackjack.beginnerDecks.v1','999']]);assert.equal(invalidSaved.ids.get('beginnerDecks').value,'1');
invalidSaved.ids.get('beginnerDecks').value='invalid';invalidSaved.ids.get('beginnerStart').fire('click');
assert.equal(invalidSaved.ui.beginner.cards.length,52,'invalid deck choice safely falls back to one deck');
console.log('UI smoke tests passed: on-table betting spots; click/1/2/3/X shortcuts; custom wager recall, affordability, typing/modifier/tab/modal/mid-hand guards; side payouts, statistics and reset; existing blackjack and count training intact.');
