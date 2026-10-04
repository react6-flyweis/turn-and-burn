const fs=require('fs'),zlib=require('zlib');
const d=fs.readFileSync(process.env.FIG_CANVAS || 'figma-export/canvas.fig');
let off=12;const chunks=[];
while(off<d.length){const n=d.readUInt32LE(off);chunks.push(d.subarray(off+4,off+4+n));off+=4+n;}
const dec=b=> (b[0]==0x28&&b[1]==0xb5)?zlib.zstdDecompressSync(b):zlib.inflateRawSync(b);
const schemaBuf=dec(chunks[0]), dataBuf=dec(chunks[1]);
class R{constructor(b){this.b=b;this.i=0}
 byte(){return this.b[this.i++]}
 vu(){let r=0,s=0,c;do{c=this.b[this.i++];r|=(c&127)<<s;s+=7}while(c&128&&s<35);return r>>>0}
 vi(){const v=this.vu();return (v&1)?~(v>>>1):(v>>>1)}
 vf(){const f=this.b[this.i];if(f===0){this.i++;return 0}
  let bits=this.b[this.i]|(this.b[this.i+1]<<8)|(this.b[this.i+2]<<16)|(this.b[this.i+3]<<24);this.i+=4;
  bits=(bits<<23)|(bits>>>9);const ab=new DataView(new ArrayBuffer(4));ab.setInt32(0,bits,true);return ab.getFloat32(0,true)}
 str(){let s=this.i;while(this.b[this.i]!==0)this.i++;const r=this.b.toString('utf8',s,this.i);this.i++;return r}
 vu64(){let r=0n,s=0n,c;do{c=this.b[this.i++];r|=BigInt(c&127)<<s;s+=7n}while(c&128);return r}
}
const sr=new R(schemaBuf);const defs=[];const nd=sr.vu();
for(let k=0;k<nd;k++){const name=sr.str(),kind=sr.byte(),fc=sr.vu(),fields=[];
 for(let j=0;j<fc;j++){fields.push({name:sr.str(),type:sr.vi(),arr:sr.byte(),value:sr.vu()})}
 defs.push({name,kind,fields,byVal:Object.fromEntries(fields.map(f=>[f.value,f]))});}
const byName=Object.fromEntries(defs.map(x=>[x.name,x]));
const r=new R(dataBuf);
function readType(t){switch(t){case -1:return !!r.byte();case -2:return r.byte();case -3:return r.vi();case -4:return r.vu();case -5:return r.vf();case -6:return r.str();case -7:return Number(r.vu64());case -8:return Number(r.vu64());}
 return readDef(defs[t])}
function readField(f){if(f.arr){const n=r.vu();if(f.type===-2){const v=r.b.subarray(r.i,r.i+n);r.i+=n;return v}const a=new Array(n);for(let i=0;i<n;i++)a[i]=readType(f.type);return a}return readType(f.type)}
function readDef(def){if(def.kind===0){const v=r.vu();return def.byVal[v]?.name??v}
 const o={};if(def.kind===1){for(const f of def.fields)o[f.name]=readField(f);return o}
 while(true){const id=r.vu();if(id===0)return o;const f=def.byVal[id];if(!f)throw new Error('bad field '+id+' in '+def.name);o[f.name]=readField(f)}}
const msg=readDef(byName.Message);
module.exports={msg};
if(require.main===module){console.log(Object.keys(msg),msg.nodeChanges.length,msg.blobs.length);}
