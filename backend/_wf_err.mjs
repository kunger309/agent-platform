const BASE='http://localhost:3000';
async function login(){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'123456'})});return (await r.json()).data.accessToken;}
async function createWf(t,g){const r=await fetch(`${BASE}/api/workflows`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${t}`},body:JSON.stringify({name:'err-wf',status:'draft',graphJson:g})});return (await r.json()).data.id;}
async function runWf(t,id,input){const r=await fetch(`${BASE}/api/workflows/${id}/runs`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${t}`},body:JSON.stringify({input})});const t2=await r.text();return t2.split('\n').map(l=>l.trim()).filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6).trim()));}
const tok=await login();
// 测1: code 节点抛错
const g1={nodes:[{id:'c1',type:'code',data:{config:{code:"throw new Error('boom')"}}},{id:'a1',type:'answer',data:{config:{template:'{{c1.output}}'}}}],edges:[{source:'c1',target:'a1'}]};
const w1=await createWf(tok,g1);
const e1=await runWf(tok,w1,'x');
console.log('CODE报错序列:',e1.map(e=>e.type+(e.nodeId?':'+e.nodeId:'')).join(' '));
const errEv=e1.find(e=>e.type==='error');
console.log('error事件message:',errEv?.message);
// 测2: http 节点连不可达地址
const g2={nodes:[{id:'h1',type:'http',data:{config:{method:'GET',url:'http://127.0.0.1:1/xx'}}}],edges:[]};
const w2=await createWf(tok,g2);
const e2=await runWf(tok,w2,'x');
const errEv2=e2.find(e=>e.type==='error');
console.log('HTTP报错序列:',e2.map(e=>e.type+(e.nodeId?':'+e.nodeId:'')).join(' '));
console.log('HTTP error message:',errEv2?.message?.slice(0,80));
