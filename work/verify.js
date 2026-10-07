const fs=require('fs');
const html=fs.readFileSync('outputs/blackjack.html','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if(scripts.length!==1) throw new Error('Expected one inline script');
const mod={exports:{}};
new Function('module','exports',scripts[0][1])(mod,mod.exports);
console.log(mod.exports.runSelfTests());
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
const references=[...scripts[0][1].matchAll(/\$\('([^']+)'\)/g)].map(match=>match[1]);
const missing=[...new Set(references.filter(id=>!ids.has(id)))];
if(missing.length) throw new Error('Missing UI IDs: '+missing.join(', '));
if(/<script[^>]+src=|<link[^>]+href=/.test(html))
  throw new Error('Unexpected external dependency');
if(!html.includes("const MULTIPLAYER_ENDPOINT='__MULTIPLAYER_ENDPOINT__'") && !/https?:\/\/[a-z0-9.-]+\.workers\.dev/.test(html))
  throw new Error('Multiplayer endpoint is not configured with the expected Cloudflare Worker host');
console.log(`All ${references.length} UI ID references resolve; no CDN or script dependencies.`);
