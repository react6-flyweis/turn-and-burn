const {msg}=require('./decode.cjs');
const g=n=>n.guid.sessionID+':'+n.guid.localID;
const map=new Map();msg.nodeChanges.forEach(n=>map.set(g(n),n));
const kids=new Map();msg.nodeChanges.forEach(n=>{if(n.parentIndex){const p=n.parentIndex.guid.sessionID+':'+n.parentIndex.guid.localID;(kids.get(p)||kids.set(p,[]).get(p)).push(n)}});
module.exports={map,kids,g};
if(require.main===module){
 for(const id of process.argv.slice(2)){const n=map.get(id);if(!n){console.log(id,'MISSING');continue}
  const s=JSON.stringify(n,(k,v)=>v instanceof Uint8Array?`<${v.length}b>`:v);
  console.log(id,n.type,n.name,'kids',(kids.get(id)||[]).map(c=>g(c)+' '+c.type+' '+c.name).join(' | '));console.log(s.slice(0,1500));}
}
