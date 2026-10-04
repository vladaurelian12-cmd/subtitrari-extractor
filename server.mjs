import http from 'node:http';
import {spawn} from 'node:child_process';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {extractIndexed} from './matroska.mjs';

export function mediaUrl(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!/(^|\.)(real-debrid\.com|rdcontent\.net|torbox\.app)$/.test(u.hostname))throw Error('Invalid media host');
 return u.href;
}
export function createExtractor({secret,runner=runExtraction,maxJobs=8}={}){
 if(typeof secret!=='string'||secret.length<32)throw Error('EXTRACTION_SERVICE_SECRET must contain at least 32 characters');
 const jobs=new Map();let running=0;
 const pump=()=>{if(running)return;const job=[...jobs.values()].find(j=>j.status==='queued');if(!job)return;running++;job.status='extracting';
  runner(job,(seconds)=>{job.progress=Math.min(99,Math.max(0,Math.floor(seconds/job.duration*100)));}).then(text=>{
   if(!/\d\d:\d\d:[\d.,]+\s*-->/.test(text)||Buffer.byteLength(text)>750000)throw Error('No usable subtitle');
   job.text=text;job.status='ready';job.progress=100;
  }).catch(()=>{job.status='error';job.error='Pista nu a putut fi extrasă. Verifică accesul serviciului cloud la fișier.';}).finally(()=>{job.updated=Date.now();delete job.url;running--;pump();});};
 const respond=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/health'){respond(res,200,{ok:true});return;}
  const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+secret);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){respond(res,401,{error:'Unauthorized'});return;}
  if(req.method!=='POST'||req.url!=='/extract'){respond(res,404,{error:'Not found'});return;}
  try{
   let raw='';for await(const part of req){raw+=part;if(raw.length>12000){respond(res,413,{error:'Request too large'});return;}}
   const data=JSON.parse(raw);if(!/^[a-f0-9]{64}$/.test(data.id)||!/^0:\d{1,3}$/.test(data.stream)||!(data.duration>0&&data.duration<=21600))throw Error('Invalid input');
   const url=mediaUrl(data.url),identity=data.id+':'+data.stream;
   for(const [id,job] of jobs)if(job.status==='error'||['ready'].includes(job.status)&&Date.now()-job.updated>15*60*1000)jobs.delete(id);
   let job=jobs.get(identity);
   if(!job){if(jobs.size>=maxJobs){respond(res,429,{error:'Extractor ocupat. Încearcă din nou.'});return;}job={url,stream:data.stream,duration:data.duration,status:'queued',progress:0,updated:Date.now()};jobs.set(identity,job);pump();}
   respond(res,job.status==='ready'?200:202,{status:job.status,progress:job.progress,...(job.method?{method:job.method}:{}),...(job.bytesRead?{bytesRead:job.bytesRead,requests:job.requests}:{}),...(job.text?{text:job.text}:{}),...(job.error?{error:job.error}:{})});
  }catch{respond(res,400,{error:'Invalid extraction request'});}
 });
 return server;
}
export async function runExtraction(job,onProgress){
 try{job.method='indexed-mkv';const result=await extractIndexed(job,onProgress);job.method=result.method;job.bytesRead=result.bytesRead;job.requests=result.requests;job.elapsedMs=result.elapsedMs;return result.text;}
 catch{job.method='ffmpeg';onProgress(0);return await runFfmpeg(job,onProgress);}
}
export function runFfmpeg(job,onProgress){return new Promise((resolve,reject)=>{
 const child=spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-copyts','-protocol_whitelist','https,tls,tcp,crypto','-rw_timeout','30000000','-i',job.url,'-map',job.stream,'-c:s','srt','-avoid_negative_ts','disabled','-f','srt','-progress','pipe:2','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const chunks=[];let size=0,progress='';const timer=setTimeout(()=>child.kill(),20*60*1000);
 child.stdout.on('data',chunk=>{size+=chunk.length;if(size>750000)child.kill();else chunks.push(chunk);});
 child.stderr.on('data',chunk=>{progress+=chunk.toString();const lines=progress.split('\n');progress=lines.pop().slice(-1024);for(const line of lines){const m=line.match(/^out_time_us=(\d+)$/);if(m)onProgress(Number(m[1])/1000000);}});
 child.on('error',()=>{clearTimeout(timer);reject(Error('FFmpeg unavailable'));});
 child.on('close',code=>{clearTimeout(timer);code===0&&size<=750000?resolve(Buffer.concat(chunks).toString('utf8')):reject(Error('Extraction failed'));});
 });}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const server=createExtractor({secret:process.env.EXTRACTION_SERVICE_SECRET});server.listen(Number(process.env.PORT)||10000,'0.0.0.0');
}
