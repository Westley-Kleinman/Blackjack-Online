const e=require('./engine.js');
const r={...e.DEFAULT_RULES,decks:Number(process.env.BJ_DECKS||6)};
function expected(cards,up){
  const value=e.handValue(cards),total=value.total,pair=cards[0]===cards[1],rank=cards[0];
  if(pair){
    if(rank===1||rank===8)return 'split';
    if(rank===2||rank===3)return up>=2&&up<=7?'split':'hit';
    if(rank===4)return up===5||up===6?'split':'hit';
    if(rank===6)return up>=2&&up<=6?'split':'hit';
    if(rank===7)return up>=2&&up<=7?'split':'hit';
    if(rank===9)return up>=2&&up<=6||up===8||up===9?'split':'stand';
  }
  if(value.soft){
    if(total<=18){
      const low=total<=14?5:total<=16?4:3;
      if(up>=low&&up<=6)return 'double';
    }
    if(total<=17)return 'hit';
    if(total===18)return up>=9||up===1?'hit':'stand';
    return 'stand';
  }
  if(total===9&&up>=3&&up<=6)return 'double';
  if(total===10&&up>=2&&up<=9)return 'double';
  if(total===11&&up>=2&&up<=10)return 'double';
  if(total<=11)return 'hit';
  if(total===12)return up>=4&&up<=6?'stand':'hit';
  if(total<=16)return up>=2&&up<=6?'stand':'hit';
  return 'stand';
}
let count=0,diffs=[];
const hands=[];
for(let total=5;total<=20;total++){
  const cards=total<=11?[2,total-2]:[10,total-10];
  if(cards[0]>=1&&cards[1]>=1&&cards[1]<=10&&cards[0]!==cards[1])hands.push(cards);
}
for(let high=2;high<=9;high++)hands.push([1,high]);
for(let rank=1;rank<=10;rank++)hands.push([rank,rank]);
for(const cards of hands)for(const up of [2,3,4,5,6,7,8,9,10,1]){
  const actual=e.bestAction(e.solverFor(r,up,r.peek,cards).actions(cards));
  const want=expected(cards,up);count++;
  if(actual!==want)diffs.push(`${cards.join('+')} vs ${up}: ${actual}, chart ${want}`);
}
console.log(`${count} comparisons; ${diffs.length} differences`);
console.log(diffs.join('\n'));
