// Indexed SRT extraction. A complete subtitle cue index and matching track frame
// statistics are required; unsupported layouts fall back to FFmpeg.
function vint(buf,pos,id=false){
 if(pos>=buf.length)throw Error('Truncated EBML');let mask=128,n=1;
 while(n<=8&&!(buf[pos]&mask)){mask>>=1;n++;}
 if(n>8||pos+n>buf.length||id&&n>4)throw Error('Invalid EBML');
 let value=BigInt(id?buf[pos]:buf[pos]&(mask-1));for(let i=1;i<n;i++)value=(value<<8n)|BigInt(buf[pos+i]);
 const unknown=!id&&value===(1n<<BigInt(n*7))-1n;
 if(!unknown&&value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Large EBML offset');
 return {n,value:unknown?Infinity:Number(value)};
}
function header(buf,pos=0){const id=vint(buf,pos,true),size=vint(buf,pos+id.n);const start=pos+id.n+size.n;return {id:id.value,start,end:start+size.value,size:size.value};}
function* children(buf,start=0,end=buf.length){for(let pos=start;pos<end;){const e=header(buf,pos);if(!Number.isFinite(e.end)||e.end>end)throw Error('Incomplete EBML element');yield e;pos=e.end;}}
const field=(buf,e,id)=>[...children(buf,e.start,e.end)].find(x=>x.id===id);
const uint=(buf,e)=>{if(!e||e.size>8)throw Error('Missing EBML integer');let n=0n;for(const b of buf.subarray(e.start,e.end))n=n*256n+BigInt(b);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Large EBML integer');return Number(n);};
const uid=(buf,e)=>{if(e.size<1||e.size>8)throw Error('Invalid track identity');return BigInt('0x'+buf.subarray(e.start,e.end).toString('hex')).toString(16);};
const string=(buf,e)=>e?buf.toString('utf8',e.start,e.end):'';
const stamp=ms=>{if(!Number.isFinite(ms)||ms<0||ms>86400000)throw Error('Invalid subtitle time');ms=Math.round(ms);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
export async function extractIndexed(job,onProgress=()=>{},{fetcher=fetch,maxBytes=24000000,concurrency=4,timeoutMs=600000}={}){
 const start=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);let bytes=0,requests=0,totalSize;
 async function range(offset,length){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>8000000)throw Error('Invalid range');
  if(totalSize!==undefined)length=Math.min(length,totalSize-offset);if(length<1||bytes+length>maxBytes)throw Error('Range budget exceeded');
  for(let attempt=0;attempt<6;attempt++){
   try{
    requests++;const r=await fetcher(job.url,{headers:{Range:'bytes='+offset+'-'+(offset+length-1)},redirect:'manual',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
    if([429,502,503,504].includes(r.status)){await r.body?.cancel();throw Error('Retryable response');}
    if(r.status!==206){await r.body?.cancel();throw Object.assign(Error('Partial requests unavailable'),{fatal:true});}
    const cr=r.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if(!cr||Number(cr[1])!==offset||Number(cr[2])!==offset+length-1||totalSize!==undefined&&Number(cr[3])!==totalSize){await r.body?.cancel();throw Object.assign(Error('Inconsistent range'),{fatal:true});}
    totalSize=Number(cr[3]);if(!Number.isSafeInteger(totalSize))throw Object.assign(Error('Invalid file size'),{fatal:true});
    const parts=[];let size=0;for await(const part of r.body){size+=part.length;bytes+=part.length;if(size>length||bytes>maxBytes){controller.abort();throw Error('Range budget exceeded');}parts.push(part);}
    if(size!==length)throw Error('Incomplete range response');return Buffer.concat(parts,size);
   }catch(e){
    if(e.fatal||controller.signal.aborted||attempt===5)throw e.fatal||controller.signal.aborted?e:Error('Range network error at '+offset+' length '+length+': '+(e.cause?.code||e.name));
    await new Promise(resolve=>setTimeout(resolve,Math.min(4000,250*2**attempt)));
   }
  }
 }
 async function element(pos,limit){const prefix=await range(pos,16),h=header(prefix);if(!Number.isFinite(h.size)||h.end>limit)throw Error('Unsupported index size');return await range(pos,h.end);}
 try{
  const head=await range(0,65536);if(head.readUInt32BE(0)!==0x1a45dfa3)throw Error('Not Matroska');
  const ebml=header(head),segment=header(head,ebml.end);if(segment.id!==0x18538067)throw Error('No Matroska segment');const segmentStart=segment.start;
  let seek;for(let p=segmentStart;p<head.length;){const e=header(head,p);if(e.end>head.length)break;if(e.id===0x114d9b74){seek=e;break;}p=e.end;}
  if(!seek)throw Error('No seek index');const positions=new Map();
  for(const e of children(head,seek.start,seek.end)){if(e.id!==0x4dbb)continue;const id=uint(head,field(head,e,0x53ab)),pos=uint(head,field(head,e,0x53ac));positions.set(id,segmentStart+pos);}
  for(const id of [0x1549a966,0x1654ae6b,0x1c53bb6b,0x1254c367])if(!positions.has(id))throw Error('Incomplete indexed metadata');
  const [info,tracks,tags,cues]=await Promise.all([element(positions.get(0x1549a966),100000),element(positions.get(0x1654ae6b),1000000),element(positions.get(0x1254c367),1000000),element(positions.get(0x1c53bb6b),8000000)]);
  const infoRoot=header(info),scaleElement=field(info,infoRoot,0x2ad7b1),scale=scaleElement?uint(info,scaleElement):1000000;
  if(scale<1||scale>1000000000)throw Error('Unsupported time scale');
  const trackEntries=[...children(tracks,header(tracks).start)].filter(e=>e.id===0xae),index=Number(job.stream.split(':')[1]),track=trackEntries[index];
  if(!track||uint(tracks,field(tracks,track,0x83))!==17||string(tracks,field(tracks,track,0x86))!=='S_TEXT/UTF8'||field(tracks,track,0x6d80)||field(tracks,track,0x23314f))throw Error('Unsupported subtitle track');
  const delay=field(tracks,track,0x56aa);if(delay&&uint(tracks,delay)!==0)throw Error('Unsupported codec delay');
  const trackNumber=uint(tracks,field(tracks,track,0xd7)),trackUid=field(tracks,track,0x73c5);if(!trackUid)throw Error('Missing track identity');const wantedUid=uid(tracks,trackUid);
  let expectedFrames;
  for(const tag of children(tags,header(tags).start)){if(tag.id!==0x7373)continue;const target=field(tags,tag,0x63c0),targetUid=target&&field(tags,target,0x63c5);if(!targetUid||uid(tags,targetUid)!==wantedUid)continue;
   for(const entry of children(tags,tag.start,tag.end)){if(entry.id===0x67c8&&string(tags,field(tags,entry,0x45a3))==='NUMBER_OF_FRAMES')expectedFrames=Number(string(tags,field(tags,entry,0x4487)));}
  }
  if(!Number.isSafeInteger(expectedFrames)||expectedFrames<1||expectedFrames>20000)throw Error('No complete track statistics');
  const points=[],seen=new Set();
  for(const point of children(cues,header(cues).start)){if(point.id!==0xbb)continue;const time=uint(cues,field(cues,point,0xb3));
   for(const position of children(cues,point.start,point.end)){if(position.id!==0xb7||uint(cues,field(cues,position,0xf7))!==trackNumber)continue;
    const relative=field(cues,position,0xf0);if(!relative)throw Error('Missing direct cue position');const cluster=segmentStart+uint(cues,field(cues,position,0xf1)),offset=uint(cues,relative),identity=cluster+':'+offset;
    if(seen.has(identity))throw Error('Duplicate cue position');seen.add(identity);points.push({time,cluster,offset});
   }
  }
  if(points.length!==expectedFrames)throw Error('Sparse subtitle index');
  const clusters=new Map(),output=new Array(points.length);let next=0,done=0,textSize=0;
  async function cluster(pos){let promise=clusters.get(pos);if(!promise){promise=(async()=>{const data=await range(pos,128),h=header(data);if(h.id!==0x1f43b675)throw Error('Invalid cluster');let time;
    for(let p=h.start;p<data.length;){const e=header(data,p);if(e.id===0xe7&&e.end<=data.length){time=uint(data,e);break;}if(e.end>data.length)break;p=e.end;}
    if(time===undefined)throw Error('Missing cluster timestamp');return {start:pos+h.start,time,end:pos+h.end};})();clusters.set(pos,promise);}return promise;}
  async function worker(){while(next<points.length){const i=next++,point=points[i],c=await cluster(point.cluster),position=c.start+point.offset;
    if(position>=c.end)throw Error('Cue outside cluster');let buf=await range(position,512),group=header(buf);if(group.id!==0xa0||!Number.isFinite(group.end)||group.end>65536)throw Error('Unsupported subtitle block');if(group.end>buf.length)buf=await range(position,group.end);if(position+group.end>c.end)throw Error('Block outside cluster');
    const block=field(buf,group,0xa1),duration=field(buf,group,0x9b);if(!block||!duration)throw Error('Missing subtitle duration');
    const number=vint(buf,block.start),payload=block.start+number.n;if(number.value!==trackNumber||payload+3>block.end||buf[payload+2]&6)throw Error('Invalid subtitle block');
    const time=c.time+buf.readInt16BE(payload);if(time!==point.time)throw Error('Cue timestamp mismatch');const length=uint(buf,duration);if(length<=0)throw Error('Invalid subtitle duration');
    const text=buf.toString('utf8',payload+3,block.end);if(!text.trim()||text.includes('\uFFFD'))throw Error('Invalid subtitle text');
    textSize+=Buffer.byteLength(text)+70;if(textSize>750000)throw Error('Subtitle too large');output[i]={time,position,text,start:stamp(time*scale/1000000),end:stamp((time+length)*scale/1000000)};done++;onProgress(done/points.length*job.duration);
  }}
  let firstFailure;await Promise.allSettled(Array.from({length:Math.min(concurrency,points.length)},()=>worker().catch(e=>{firstFailure??=e;controller.abort();throw e;})));if(firstFailure)throw firstFailure;
  output.sort((a,b)=>a.time-b.time||a.position-b.position);const text=output.map((c,i)=>`${i+1}\n${c.start} --> ${c.end}\n${c.text}`).join('\n\n')+'\n';
  return {text,method:'indexed-mkv',bytesRead:bytes,requests,cueCount:output.length,elapsedMs:Date.now()-start};
 }finally{clearTimeout(timer);controller.abort();}
}
