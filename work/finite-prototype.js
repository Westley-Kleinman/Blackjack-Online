const e=require('./engine.js');
function finite(cards,up,decks=6,h17=false){
 const counts=[4,4,4,4,4,4,4,4,4,16].map(n=>n*decks);
 for(const c of [...cards,up])counts[c-1]--;
 const dcache=new Map(),scache=new Map(),pcache=new Map();
 const terminal=Array.from({length:6},(_,i)=>Array.from({length:6},(_,j)=>Number(i===j)));
 const excluded=up===1?9:up===10?0:-1;
 function dealer(total,soft,n){
  if(total>21)return terminal[0];
  if(total>17||total===17&&(!soft||!h17))return terminal[total-16];
  const key=counts.join(',')+':'+total+':'+soft;
  if(dcache.has(key))return dcache.get(key);
  const out=[0,0,0,0,0,0];
  for(let i=0;i<10;i++)if(counts[i]){
   const p=counts[i]/n,r=i+1;
   let t=total+r,s=soft;
   if(r===1&&t+10<=21){t+=10;s=true}else if(t>21&&s){t-=10;s=false}
   counts[i]--;const branch=dealer(t,s,n-1);counts[i]++;
   for(let k=0;k<6;k++)out[k]+=p*branch[k];
  }
  dcache.set(key,out);return out;
 }
 function dist(n){const key=counts.join(',');if(scache.has(key))return scache.get(key);
  const out=[0,0,0,0,0,0],den=n-(excluded>=0?counts[excluded]:0);
  for(let i=0;i<10;i++)if(i!==excluded&&counts[i]){
   const p=counts[i]/den,v=e.handValue([up,i+1]);counts[i]--;
   const branch=dealer(v.total,v.soft,n-1);counts[i]++;
   for(let k=0;k<6;k++)out[k]+=p*branch[k];
  }
  scache.set(key,out);return out;
 }
 function stand(v,n){if(v.total>21)return -1;const d=dist(n);let out=d[0];
  for(let k=1;k<6;k++)out+=d[k]*Math.sign(v.total-(k+16));return out;
 }
 function draws(v,n,doubled=false){let out=0,den=n-(excluded>=0?counts[excluded]:0);
  for(let i=0;i<10;i++)if(counts[i]){
   const hole=i===excluded?0:counts[i]/den,p=(counts[i]-hole)/(n-1),r=i+1;
   let t=v.total+r,s=v.soft;
   if(r===1&&t+10<=21){t+=10;s=true}else if(t>21&&s){t-=10;s=false}
   counts[i]--;out+=p*(doubled?2*stand({total:t,soft:s},n-1):best({total:t,soft:s},n-1));counts[i]++;
  }return out;
 }
 function best(v,n){if(v.total>21)return -1;if(v.total===21)return stand(v,n);
  const key=counts.join(',')+':'+v.total+':'+v.soft;if(pcache.has(key))return pcache.get(key);
  const out=Math.max(stand(v,n),draws(v,n));pcache.set(key,out);return out;
 }
 const n=counts.reduce((a,b)=>a+b,0),v=e.handValue(cards),start=Date.now();
 const result={stand:stand(v,n),hit:draws(v,n),double:draws(v,n,true)};
 return {result,ms:Date.now()-start,dcache:dcache.size,pcache:pcache.size};
}
for(const [cards,up] of [[[1,2],5],[[1,4],4],[[6,5],1],[[9,2],1],[[10,6],10]])console.log(cards,up,finite(cards,up));
