/** 常驻区切分明细：哪些 critical 卡进了、哪些被 1200 上限挤掉（只读） */
require('dotenv').config();
const mongoose = require('mongoose');
const Memory = require('../models/Memory');

function est(t){const c=(t.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)||[]).length;return Math.round(c+(t.length-c)*0.5);}
function fmt(m){
  let line=`[${m.kind||'core'}/${m.priority||'normal'}] ${m.content||''}`;
  if(m.title) line+=`（${m.title}）`;
  if(m.lumiThought) line+=` Lumi想法：${m.lumiThought}`;
  const em=(m.emotions||[]).slice(-3).map(e=>`${e.emotion}${e.intensity!=null?`(${e.intensity}/10)`:''}`).join('、');
  if(em) line+=` 情绪：${em}`;
  const tl=(m.timeline||[]).slice(-3).map(t=>`${t.date} ${t.event}`).join('；');
  if(tl) line+=` 时间线：${tl}`;
  return line;
}
(async()=>{
  await mongoose.connect(process.env.DATABASE_URL,{serverSelectionTimeoutMS:8000});
  const list=await Memory.find({sessionId:'default',kind:'core',priority:'critical',supersededBy:null,contradicted:false,archived:false}).select('-embedding').sort({updatedAt:-1}).limit(10).lean();
  console.log('critical 候选共',list.length,'张（按 updatedAt 倒序，取前10）\n');
  const CAP=parseInt(process.env.RESIDENT_TOKEN_CAP)||1200;
  let sum=0;
  list.forEach((m,i)=>{
    const t=est(fmt(m)+'\n');
    const willFit=sum+t<=CAP;
    if(willFit) sum+=t;
    console.log(`${String(i+1).padStart(2)}. ${willFit?'进  ':'挤出'} ${String(t).padStart(4)}t  累计${sum}  ${(m.title||String(m.content).slice(0,34))}`);
  });
  console.log('\n上限',CAP,'| 实际占用',sum,'t');
  await mongoose.disconnect();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
