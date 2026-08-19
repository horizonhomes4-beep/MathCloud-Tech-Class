import React, {useEffect, useMemo, useState} from "react";
import {createRoot} from "react-dom/client";
import {onValue, ref, set, update, get, runTransaction, serverTimestamp} from "firebase/database";
import {onAuthStateChanged, signInWithEmailAndPassword, signOut} from "firebase/auth";
import * as XLSX from "xlsx";
import {db, auth} from "./firebase";
import "./styles.css";

const BRAND = {
  name:"MathCloud Tutorial", owner:"Marshall Jacob",
  email:"marshall12340@gmail.com", phone:"+2349129225442", whatsapp:"+2348102341648"
};

const SUBJECTS = [
 "English Language","General Mathematics","Biology","Chemistry","Physics","Agricultural Science",
 "Further Mathematics","Geography","Technical Drawing","Government","Christian Religious Studies",
 "Islamic Studies","Literature-in-English","Economics","Accounting","Commerce","Marketing",
 "Nigerian History","French","Arabic","Hausa","Igbo","Yoruba","Visual Art","Music",
 "Home Management","Catering Craft","Physical Education","Health Education","Foods & Nutrition",
 "Fashion Design and Garment Making","Livestock Farming","Beauty and Cosmetology",
 "Computer Hardware and GSM Repairs","Solar Photovoltaic Installation and Maintenance",
 "Horticulture and Crop Production"
];

const seedQuestions = [
 {id:"MATH-001",subject:"General Mathematics",topic:"Algebra",subtopic:"Linear equations",difficulty:"Basic",type:"single",question:"Solve \\(3x+5=20\\).",options:["3","5","7","15"],answer:"5",explanation:"Subtract 5: \\(3x=15\\). Divide by 3: \\(x=5\\).",skill:"Algebraic manipulation"},
 {id:"MATH-002",subject:"General Mathematics",topic:"Mensuration",subtopic:"Area",difficulty:"Basic",type:"single",question:"A rectangle is 8 cm long and 5 cm wide. What is its area?",options:["13 cm²","26 cm²","40 cm²","80 cm²"],answer:"40 cm²",explanation:"Area = length × width = \\(8\\times5=40\\text{ cm}^2\\).",skill:"Formula application"},
 {id:"BIO-001",subject:"Biology",topic:"Cell Biology",subtopic:"Cell structures",difficulty:"Basic",type:"single",question:"Which organelle is primarily responsible for aerobic respiration?",options:["Ribosome","Mitochondrion","Nucleus","Vacuole"],answer:"Mitochondrion",explanation:"Mitochondria contain the machinery for aerobic cellular respiration and ATP production.",skill:"Recall + application"},
 {id:"CHEM-001",subject:"Chemistry",topic:"Atomic Structure",subtopic:"Particles",difficulty:"Basic",type:"single",question:"Which particle has a negative charge?",options:["Proton","Neutron","Electron","Nucleus"],answer:"Electron",explanation:"Electrons carry negative electric charge; protons are positive and neutrons are neutral.",skill:"Concept identification"},
 {id:"PHY-001",subject:"Physics",topic:"Mechanics",subtopic:"Speed",difficulty:"Basic",type:"single",question:"A car travels 120 km in 2 h. What is its average speed?",options:["30 km/h","60 km/h","120 km/h","240 km/h"],answer:"60 km/h",explanation:"Average speed = distance/time = \\(120/2=60\\text{ km h}^{-1}\\).",skill:"Quantitative reasoning"},
 {id:"ENG-001",subject:"English Language",topic:"Grammar",subtopic:"Subject-verb agreement",difficulty:"Basic",type:"single",question:"Choose the correct sentence.",options:["The boys is ready.","The boys are ready.","The boys was ready.","The boys be ready."],answer:"The boys are ready.",explanation:"The plural subject 'boys' takes the plural verb 'are'.",skill:"Language accuracy"},
 {id:"ECON-001",subject:"Economics",topic:"Demand and Supply",subtopic:"Demand",difficulty:"Basic",type:"single",question:"Other things being equal, an increase in price generally causes quantity demanded to:",options:["Increase","Decrease","Remain fixed","Become infinite"],answer:"Decrease",explanation:"The law of demand states that, ceteris paribus, quantity demanded falls as price rises.",skill:"Economic reasoning"},
 {id:"GOV-001",subject:"Government",topic:"Political Systems",subtopic:"Separation of powers",difficulty:"Basic",type:"single",question:"Separation of powers is mainly intended to:",options:["Concentrate power","Prevent abuse of power","Abolish elections","Remove courts"],answer:"Prevent abuse of power",explanation:"Separating legislative, executive and judicial functions creates checks and balances.",skill:"Civic reasoning"}
];

const seedTopics = [
 {subject:"General Mathematics",topic:"Algebra",summary:"Algebra uses symbols to represent numbers and relationships.",objectives:["Solve linear equations","Simplify expressions","Translate word problems into equations"],formula:"\\(ax+b=c\\Rightarrow x=\\frac{c-b}{a}\\)"},
 {subject:"General Mathematics",topic:"Mensuration",summary:"Mensuration deals with lengths, areas, surface areas and volumes.",objectives:["Use standard area formulas","Convert units","Solve contextual measurement problems"],formula:"Rectangle: \\(A=lw\\), Triangle: \\(A=\\frac12bh\\)"},
 {subject:"Biology",topic:"Cell Biology",summary:"Cells are the basic structural and functional units of living organisms.",objectives:["Identify cell organelles","Relate structure to function","Compare plant and animal cells"],formula:"Use labelled diagrams and structure–function relationships."},
 {subject:"Chemistry",topic:"Atomic Structure",summary:"Matter is composed of atoms containing protons, neutrons and electrons.",objectives:["Describe subatomic particles","Determine atomic number","Interpret simple electron arrangements"],formula:"Atomic number = number of protons."},
 {subject:"Physics",topic:"Mechanics",summary:"Mechanics studies motion, forces and interactions.",objectives:["Calculate speed","Distinguish distance and displacement","Interpret motion data"],formula:"\\(v=\\frac{d}{t}\\)"},
];

function greet(){
  const h=new Date().getHours();
  return h<12?"Good morning":h<17?"Good afternoon":"Good evening";
}
function deviceId(){
  let id=localStorage.getItem("mc_device_id");
  if(!id){id=crypto.randomUUID();localStorage.setItem("mc_device_id",id);}
  return id;
}
async function hashPassword(password, salt){
  const enc=new TextEncoder();
  const material=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode(salt),iterations:150000,hash:"SHA-256"},material,256);
  return [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function Modal({title,children,onClose,wide=false}){
 return <div className="modalBackdrop"><div className={"modal "+(wide?"wide":"")}><button className="modalClose" onClick={onClose}>×</button><h2>{title}</h2>{children}</div></div>
}
function MathText({children}){ useEffect(()=>window.MathJax?.typesetPromise?.(),[children]); return <span dangerouslySetInnerHTML={{__html:children}}/> }
function speak(text){
  if(!("speechSynthesis" in window)){alert("Read aloud is not available in this browser.");return;}
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text.replace(/\\\\\(|\\\\\)|\\\\\[|\\\\\]|\$\$?/g," "));
  u.rate=.92; u.pitch=1;
  const voices=window.speechSynthesis.getVoices();
  const preferred=voices.find(v=>/en-NG|en-GB|en-US/i.test(v.lang)&&/natural|neural|premium|enhanced/i.test(v.name))||voices.find(v=>/^en/i.test(v.lang));
  if(preferred)u.voice=preferred;
  window.speechSynthesis.speak(u);
}
function OfflineBanner(){const [offline,setOffline]=useState(!navigator.onLine);useEffect(()=>{const a=()=>setOffline(false),b=()=>setOffline(true);addEventListener("online",a);addEventListener("offline",b);return()=>{removeEventListener("online",a);removeEventListener("offline",b)}},[]);return offline?<div className="offline"><strong>You are offline.</strong> Your cached lessons and practice data remain available where possible. Changes will sync when connection returns.</div>:null}

function StudentLogin({onLogin,onAdmin}){
 const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 async function submit(e){e.preventDefault();setBusy(true);setErr("");try{
   const snap=await get(ref(db,"studentsByEmail/"+email.trim().toLowerCase().replace(/[.#$[\]/]/g,"_")));
   if(!snap.exists()) throw Error("No student account was found.");
   const s=snap.val(), h=await hashPassword(password,s.salt);
   if(h!==s.passwordHash) throw Error("Incorrect email or password.");
   if(s.status==="suspended") throw Error("Your account is suspended. Contact MathCloud Tutorial.");
   const did=deviceId();
   const lock=await runTransaction(ref(db,"studentDevices/"+s.uid),cur=>{
     if(!cur) return {deviceId:did,claimedAt:Date.now(),lastSeen:Date.now()};
     if(cur.deviceId===did) return {...cur,lastSeen:Date.now()};
     return; // abort
   });
   if(!lock.committed) {setErr("This account is already linked to another device. Please contact MathCloud Tutorial for assistance.");return;}
   localStorage.setItem("mc_student_uid",s.uid);onLogin(s);
 }catch(x){setErr(x.message||"Login failed.")}finally{setBusy(false)}}
 return <AuthShell><form className="authCard" onSubmit={submit}><img src="/logo.png" className="logo"/><h1>{BRAND.name}</h1><p>{greet()} — ready for your WASSCE preparation?</p>{err&&<div className="alert">{err}</div>}<label>Email<input value={email} onChange={e=>setEmail(e.target.value)} required type="email"/></label><label>Password<input value={password} onChange={e=>setPassword(e.target.value)} required type="password"/></label><button className="primary" disabled={busy}>{busy?"Checking…":"Student sign in"}</button><button type="button" className="linkBtn" onClick={onAdmin}>Admin portal</button><small>One-device policy is enforced for each student account.</small></form></AuthShell>
}
function AuthShell({children}){return <div className="authPage"><div className="heroGlow"/>{children}<footer>{BRAND.name} · {BRAND.owner} · {BRAND.email} · {BRAND.phone}</footer></div>}

function StudentApp({student,onLogout}){
 const [tab,setTab]=useState("dashboard"),[questions,setQuestions]=useState(seedQuestions),[topics,setTopics]=useState(seedTopics),[assigned,setAssigned]=useState({}),[results,setResults]=useState([]),[subscription,setSubscription]=useState(null),[question,setQuestion]=useState(null),[showHelp,setShowHelp]=useState(false),[showPayment,setShowPayment]=useState(false);
 useEffect(()=>{const u=student.uid;
   const un=onValue(ref(db,"assignments/"+u),s=>setAssigned(s.val()||{}));
   const ur=onValue(ref(db,"results/"+u),s=>setResults(Object.values(s.val()||{})));
   const us=onValue(ref(db,"subscriptions/"+u),s=>setSubscription(s.val()||null));
   return()=>{un();ur();us()}
 },[student.uid]);
 useEffect(()=>{const uq=onValue(ref(db,"questions"),s=>{if(s.exists())setQuestions(Object.values(s.val()))});
   const ut=onValue(ref(db,"topics"),s=>{if(s.exists())setTopics(Object.values(s.val()))});
   return()=>{uq();ut()}
 },[]);
 const allowed=useMemo(()=>Object.keys(assigned).length?questions.filter(q=>assigned[q.subject]===true):questions,[questions,assigned]);
 const stats={attempts:results.length,correct:results.reduce((a,r)=>a+r.score,0),answered:results.reduce((a,r)=>a+r.total,0)};
 const expiresAt=Number(subscription?.expiresAt||0), active=expiresAt>Date.now() && subscription?.status==="active";
 const remaining=Math.max(0,expiresAt-Date.now());
 const days=Math.floor(remaining/86400000),hours=Math.floor((remaining%86400000)/3600000),mins=Math.floor((remaining%3600000)/60000);
 async function saveResult(r){if(!active){setShowPayment(true);return}await set(ref(db,`results/${student.uid}/${Date.now()}`),r)}
 return <div className="app"><OfflineBanner/><header className="topbar"><div className="brand"><img src="/logo.png"/><span>{BRAND.name}</span></div><div className="topActions"><span>{greet()}, {student.name||student.email}</span><button onClick={()=>setShowHelp(true)}>Help</button><button onClick={onLogout}>Sign out</button></div></header>
 <div className="layout"><aside>
   <button className={tab==="dashboard"?"active":""} onClick={()=>setTab("dashboard")}>Dashboard</button>
   <button disabled={!active} className={tab==="practice"?"active":""} onClick={()=>active&&setTab("practice")}>Practice</button>
   <button disabled={!active} className={tab==="diagnostic"?"active":""} onClick={()=>active&&setTab("diagnostic")}>Diagnostics</button>
   <button disabled={!active} className={tab==="topics"?"active":""} onClick={()=>active&&setTab("topics")}>Topics</button>
   <button className={tab==="results"?"active":""} onClick={()=>setTab("results")}>Results</button>
 </aside>
 <main>
 {!active&&<section className="subscriptionExpired"><h2>Your MathCloud subscription has expired</h2><p>Question practice, diagnostics and notes are locked until your subscription is renewed and confirmed by the administrator.</p><button className="primary" onClick={()=>setShowPayment(true)}>Renew subscription</button></section>}
 {active&&<section className="subscriptionBar"><div><b>Subscription active</b><span>{days}d {hours}h {mins}m remaining</span></div><button onClick={()=>setShowPayment(true)}>Add months</button></section>}
 {tab==="dashboard"&&<><h1>WASSCE preparation dashboard</h1><div className="cards"><div><b>{stats.attempts}</b><span>Sessions</span></div><div><b>{stats.answered?Math.round(stats.correct/stats.answered*100):0}%</b><span>Accuracy</span></div><div><b>{allowed.length}</b><span>Available questions</span></div><div><b>{Object.keys(assigned).length||"All"}</b><span>Assigned subjects</span></div></div><section className="panel"><h2>Smart next steps</h2><p>{active?"Use Diagnostics first to identify weak subjects, then practise by topic and review explanations after every attempt.":"Renew your subscription to unlock questions, diagnostics and notes."}</p><div className="quick"><button disabled={!active} onClick={()=>active&&setTab("diagnostic")}>Start diagnostic</button><button disabled={!active} onClick={()=>active&&setTab("practice")}>Practise questions</button><button disabled={!active} onClick={()=>active&&setTab("topics")}>Study topics</button></div></section></>}
 {tab==="practice"&&active&&<Practice questions={allowed} onResult={saveResult}/>}
 {tab==="diagnostic"&&active&&<Diagnostic questions={allowed} onResult={saveResult}/>}
 {tab==="topics"&&active&&<Topics topics={topics.filter(t=>!Object.keys(assigned).length||assigned[t.subject])}/>}
 {tab==="results"&&<Results results={results}/>}
 </main></div>
 {showPayment&&<Modal title="Renew MathCloud subscription" onClose={()=>setShowPayment(false)}><div className="paymentBox"><h3>₦3,000 per month</h3><p>You may pay for one month or multiple months.</p><p><b>Bank:</b> Opay<br/><b>Account number:</b> 9129225442<br/><b>Account name:</b> Marshall Jacob</p><p>After payment, send your receipt to WhatsApp for confirmation.</p><a className="whatsappBtn" href={"https://wa.me/2348102341648?text="+encodeURIComponent("Hello MathCloud Tutorial, I have paid for my WASSCE subscription. Student: "+(student.name||student.email))} target="_blank" rel="noreferrer">Send receipt on WhatsApp</a><p className="muted">Your subscription will become active after payment is confirmed by MathCloud Tutorial.</p></div></Modal>}
 {showHelp&&<Modal title="Contact MathCloud Tutorial" onClose={()=>setShowHelp(false)}><p>If you are locked out of your device or need account/subscription assistance, contact the tutorial centre.</p><div className="contact"><b>Owner:</b> {BRAND.owner}<br/><b>Email:</b> {BRAND.email}<br/><b>Phone:</b> {BRAND.phone}<br/><b>WhatsApp:</b> {BRAND.whatsapp}</div><button className="primary" onClick={()=>setShowHelp(false)}>Close</button></Modal>}</div>
}
function Practice({questions,onResult}){
 const [filters,setFilters]=useState({subject:"All",topic:"All",difficulty:"All"}),[idx,setIdx]=useState(0),[sel,setSel]=useState(""),[done,setDone]=useState(false),[score,setScore]=useState(0),[started,setStarted]=useState(false);
 const pool=questions.filter(q=>(filters.subject==="All"||q.subject===filters.subject)&&(filters.topic==="All"||q.topic===filters.topic)&&(filters.difficulty==="All"||q.difficulty===filters.difficulty));
 function start(){setIdx(0);setScore(0);setSel("");setDone(false);setStarted(true)}
 async function answer(){if(!sel)return;const q=pool[idx],ok=sel===q.answer;setScore(s=>s+(ok?1:0));if(idx===pool.length-1){const final=score+(ok?1:0);setDone(true);await onResult({mode:"practice",score:final,total:pool.length,subject:q.subject,createdAt:Date.now()})}else{setIdx(i=>i+1);setSel("")}}
 if(!started||!pool.length)return <><h1>Practice bank</h1><section className="panel"><div className="grid3"><label>Subject<select value={filters.subject} onChange={e=>setFilters({...filters,subject:e.target.value,topic:"All"})}><option>All</option>{[...new Set(questions.map(q=>q.subject))].map(x=><option key={x}>{x}</option>)}</select></label><label>Topic<select value={filters.topic} onChange={e=>setFilters({...filters,topic:e.target.value})}><option>All</option>{[...new Set(questions.filter(q=>filters.subject==="All"||q.subject===filters.subject).map(q=>q.topic))].map(x=><option key={x}>{x}</option>)}</select></label><label>Difficulty<select value={filters.difficulty} onChange={e=>setFilters({...filters,difficulty:e.target.value})}><option>All</option><option>Basic</option><option>Intermediate</option><option>Advanced</option></select></label></div><p>{pool.length} questions match your selection.</p><button className="primary" onClick={start}>Start random practice</button></section></>
 if(done)return <section className="panel center"><h1>Session complete</h1><div className="bigScore">{score}/{pool.length}</div><p>{Math.round(score/pool.length*100)}% accuracy. Review the topic explanations before your next session.</p><button className="primary" onClick={()=>setStarted(false)}>New session</button></section>
 const q=pool[idx];return <section className="panel questionCard"><div className="qmeta">Question {idx+1} of {pool.length} · {q.subject} · {q.topic} · {q.difficulty}</div><h2><MathText>{q.question}</MathText></h2><div className="options">{q.options.map(o=><button className={sel===o?"selected":""} key={o} onClick={()=>setSel(o)}>{o}</button>)}</div><div className="questionFooter"><span>UCAT-inspired adaptive style · WASSCE curriculum content</span><button onClick={()=>speak(q.question)} className="quickRead">🔊 Read aloud</button><button className="primary" onClick={answer}>{idx===pool.length-1?"Finish":"Next"}</button></div></section>
}
function Diagnostic({questions,onResult}){
 const [start,setStart]=useState(false),[idx,setIdx]=useState(0),[answers,setAnswers]=useState([]),[done,setDone]=useState(false);
 const pool=[...questions].sort(()=>Math.random()-.5).slice(0,Math.min(12,questions.length));
 async function finish(a){const score=a.filter(x=>x).length;const subjectScores={};pool.forEach((q,i)=>{subjectScores[q.subject]??={correct:0,total:0};subjectScores[q.subject].total++;if(a[i])subjectScores[q.subject].correct++});await onResult({mode:"diagnostic",score,total:pool.length,subjectScores,createdAt:Date.now()});setDone(true)}
 if(!start)return <section className="panel"><h1>Baseline diagnostic</h1><p>This short diagnostic samples your assigned WASSCE content. It measures accuracy across subjects and gives you a starting point for targeted revision.</p><ul><li>12 mixed questions</li><li>Timed-question interface inspired by aptitude-test platforms</li><li>Immediate performance breakdown</li><li>No negative marking</li></ul><button className="primary" onClick={()=>setStart(true)}>Begin diagnostic</button></section>
 if(done)return <section className="panel center"><h1>Diagnostic complete</h1><p>Your baseline has been recorded. Go to Results for your subject-by-subject breakdown.</p><button className="primary" onClick={()=>{setStart(false);setDone(false);setIdx(0);setAnswers([])}}>Run again</button></section>
 const q=pool[idx];function pick(o){const a=[...answers];a[idx]=o===q.answer;setAnswers(a);if(idx===pool.length-1)finish(a);else setIdx(i=>i+1)}
 return <section className="panel questionCard"><div className="qmeta">Diagnostic {idx+1}/{pool.length} · {q.subject}</div><h2><MathText>{q.question}</MathText></h2><div className="options">{q.options.map(o=><button key={o} onClick={()=>pick(o)}>{o}</button>)}</div></section>
}
function Topics({topics}){const [open,setOpen]=useState(null);return <><h1>Topic library</h1><div className="topicGrid">{topics.map((t,i)=><article className="topic" key={i} onClick={()=>setOpen(t)}><span>{t.subject}</span><h2>{t.topic}</h2><p>{t.summary}</p></article>)}</div>{open&&<Modal wide title={`${open.subject} — ${open.topic}`} onClose={()=>setOpen(null)}><p>{open.summary}</p><h3>Learning objectives</h3><ul>{open.objectives.map(x=><li key={x}>{x}</li>)}</ul><div className="formula"><MathText>{open.formula}</MathText></div><button className="quickRead" onClick={()=>speak(open.summary+" Learning objectives: "+open.objectives.join(". "))}>🔊 Read lesson aloud</button>{open.pdfData&&<p><a href={open.pdfData} target="_blank" rel="noreferrer">Open attached PDF lesson</a></p>}</Modal>}</>}
function Results({results}){return <><h1>Performance analytics</h1><div className="cards"><div><b>{results.length}</b><span>Sessions</span></div><div><b>{results.length?Math.round(results.reduce((a,r)=>a+r.score,0)/results.reduce((a,r)=>a+r.total,0)*100):0}%</b><span>Overall accuracy</span></div></div><section className="panel"><h2>Recent sessions</h2>{results.slice(-10).reverse().map((r,i)=><div className="resultRow" key={i}><span>{new Date(r.createdAt||Date.now()).toLocaleString()}</span><span>{r.mode}</span><b>{r.score}/{r.total}</b></div>)}</section></>}

function AdminLogin({onBack,onLogin}){const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[err,setErr]=useState("");async function go(e){e.preventDefault();try{await signInWithEmailAndPassword(auth,email,password);onLogin()}catch(x){setErr(x.message)}}return <AuthShell><form className="authCard" onSubmit={go}><img src="/logo.png" className="logo"/><h1>Admin portal</h1>{err&&<div className="alert">{err}</div>}<label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary">Admin sign in</button><button type="button" className="linkBtn" onClick={onBack}>Student login</button></form></AuthShell>}

function AdminApp({onLogout}){const [tab,setTab]=useState("overview"),[students,setStudents]=useState([]),[questions,setQuestions]=useState([]),[topics,setTopics]=useState([]),[msg,setMsg]=useState("");useEffect(()=>{const a=onValue(ref(db,"students"),s=>setStudents(Object.values(s.val()||{})));const b=onValue(ref(db,"questions"),s=>setQuestions(Object.values(s.val()||{})));const c=onValue(ref(db,"topics"),s=>setTopics(Object.values(s.val()||{})));return()=>{a();b();c()}},[]);
 async function seed(){const q={};seedQuestions.forEach(x=>q[x.id]=x);const t={};seedTopics.forEach((x,i)=>t[`topic-${i}`]=x);await update(ref(db),{questions:q,topics:t});setMsg("Seed content installed.");}
 async function createStudent(e){e.preventDefault();const f=new FormData(e.currentTarget),email=f.get("email").toString().trim().toLowerCase(),name=f.get("name").toString().trim(),password=f.get("password").toString(),uid=crypto.randomUUID(),salt=crypto.randomUUID(),passwordHash=await hashPassword(password,salt);const key=email.replace(/[.#$[\]/]/g,"_");await set(ref(db,`students/${uid}`),{uid,email,name,salt,passwordHash,status:"active",createdAt:Date.now()});await set(ref(db,`studentsByEmail/${key}`),{uid,email,name,salt,passwordHash,status:"active"});setMsg(`Student ${email} created.`);e.currentTarget.reset();}
 async function importExcel(e){const file=e.target.files[0];if(!file)return;const data=await file.arrayBuffer(),wb=XLSX.read(data),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:""});const updates={};rows.forEach((r,i)=>{const id=r.id||`IMP-${Date.now()}-${i}`;updates[`questions/${id}`]={id,subject:r.subject,topic:r.topic,subtopic:r.subtopic,difficulty:r.difficulty||"Basic",type:r.type||"single",question:r.question,options:[r.optionA,r.optionB,r.optionC,r.optionD].filter(Boolean),answer:r.answer,explanation:r.explanation,skill:r.skill||""}});await update(ref(db),updates);setMsg(`${rows.length} questions imported.`);}
 async function revoke(uid){await set(ref(db,`studentDevices/${uid}`),null);setMsg("Device lock revoked. The student can claim the next device used to sign in.");}
 async function toggle(uid,status){await update(ref(db,`students/${uid}`),{status});const s=students.find(x=>x.uid===uid);if(s)await update(ref(db,`studentsByEmail/${s.email.replace(/[.#$[\]/]/g,"_")}`),{status});}
 return <div className="app"><header className="topbar"><div className="brand"><img src="/logo.png"/><span>{BRAND.name} Admin</span></div><div className="topActions"><button onClick={onLogout}>Sign out</button></div></header><div className="layout"><aside><button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>Overview</button><button className={tab==="students"?"active":""} onClick={()=>setTab("students")}>Students</button><button className={tab==="content"?"active":""} onClick={()=>setTab("content")}>Question bank</button><button className={tab==="topics"?"active":""} onClick={()=>setTab("topics")}>Topics</button><button className={tab==="assign"?"active":""} onClick={()=>setTab("assign")}>Assignments</button><button className={tab==="subscriptions"?"active":""} onClick={()=>setTab("subscriptions")}>Subscriptions</button></aside><main>
 {msg&&<div className="toast">{msg}<button onClick={()=>setMsg("")}>×</button></div>}
 {tab==="overview"&&<><h1>Admin command centre</h1><div className="cards"><div><b>{students.length}</b><span>Students</span></div><div><b>{questions.length}</b><span>Questions</span></div><div><b>{topics.length}</b><span>Topics</span></div><div><b>{SUBJECTS.length}</b><span>Subjects catalogued</span></div></div><section className="panel"><h2>Initial setup</h2><p>Install the included starter WASSCE content, then continue expanding the bank using the Excel template.</p><button className="primary" onClick={seed}>Install starter content</button></section></>}
 {tab==="students"&&<><h1>Student accounts</h1><section className="panel"><h2>Create student</h2><form onSubmit={createStudent} className="grid3"><input name="name" placeholder="Full name" required/><input name="email" placeholder="Email" type="email" required/><input name="password" placeholder="Temporary password" minLength="8" required/><button className="primary">Create</button></form></section><section className="panel"><h2>Manage devices & accounts</h2>{students.map(s=><div className="studentRow" key={s.uid}><div><b>{s.name||s.email}</b><small>{s.email} · {s.status}</small></div><div><button onClick={()=>revoke(s.uid)}>Revoke device</button><button onClick={()=>toggle(s.uid,s.status==="active"?"suspended":"active")}>{s.status==="active"?"Suspend":"Activate"}</button></div></div>)}</section></>}
 {tab==="content"&&<><h1>Question bank</h1><section className="panel"><p>Upload the supplied Excel template. Each row becomes one WASSCE question with options, answer, explanation, topic, difficulty and skill metadata.</p><input type="file" accept=".xlsx,.xls,.csv" onChange={importExcel}/><p><a href="/sample-wassce-questions.xlsx" download>Download sample Excel template</a></p></section><section className="panel"><h2>Current questions: {questions.length}</h2>{questions.slice(0,20).map(q=><div className="questionList" key={q.id}><b>{q.id}</b><span>{q.subject} · {q.topic}</span><span>{q.difficulty}</span></div>)}</section></>}
 {tab==="topics"&&<><h1>Topic curriculum</h1><section className="panel"><p>Attach a small PDF directly to a topic. Because this build is constrained to Realtime Database, the PDF is stored as a base64 data URL; keep uploads small. For large production PDFs, Firebase Storage is strongly recommended.</p><TopicPdf topics={topics}/></section><section className="panel">{topics.map((t,i)=><div className="questionList" key={i}><b>{t.subject}</b><span>{t.topic}</span><span>{t.pdfData?"PDF attached":"No PDF"}</span></div>)}</section></>}
 {tab==="assign"&&<Assignment students={students}/>}
 {tab==="subscriptions"&&<SubscriptionAdmin students={students}/>}
 </main></div></div>
}
function TopicPdf({topics}){
 const [idx,setIdx]=useState(0),[file,setFile]=useState(null),[msg,setMsg]=useState("");
 async function save(){
   if(!file||!topics[idx])return;
   if(file.size>3*1024*1024){setMsg("For this RTDB-only build, keep PDFs below 3 MB.");return;}
   const reader=new FileReader(); reader.onload=async()=>{const t=topics[idx]; await update(ref(db,`topics/${t.topic.replace(/[^a-zA-Z0-9_-]/g,"_")}`),{pdfData:reader.result,pdfName:file.name});setMsg("PDF attached.");}; reader.readAsDataURL(file);
 }
 return <div className="grid3"><select value={idx} onChange={e=>setIdx(Number(e.target.value))}>{topics.map((t,i)=><option key={i} value={i}>{t.subject} — {t.topic}</option>)}</select><input type="file" accept="application/pdf" onChange={e=>setFile(e.target.files[0])}/><button className="primary" onClick={save}>Attach PDF</button>{msg&&<span>{msg}</span>}</div>
}

function Assignment({students}){const [uid,setUid]=useState(""),[subject,setSubject]=useState("General Mathematics"),[value,setValue]=useState(true),[msg,setMsg]=useState("");async function save(e){e.preventDefault();await set(ref(db,`assignments/${uid}/${subject}`),value);setMsg("Assignment saved.");}return <section className="panel"><h1>Assign subjects</h1><form onSubmit={save} className="grid3"><select value={uid} onChange={e=>setUid(e.target.value)} required><option value="">Choose student</option>{students.map(s=><option value={s.uid} key={s.uid}>{s.name||s.email}</option>)}</select><select value={subject} onChange={e=>setSubject(e.target.value)}>{SUBJECTS.map(s=><option key={s}>{s}</option>)}</select><select value={String(value)} onChange={e=>setValue(e.target.value==="true")}><option value="true">Assigned</option><option value="false">Removed</option></select><button className="primary">Save assignment</button></form>{msg&&<p>{msg}</p>}<p className="muted">For group assignments, create a group path and bulk-write the same subject map to each student UID. This starter UI keeps individual assignment transparent and easy to audit.</p></section>}

function SubscriptionAdmin({students}){
 const [uid,setUid]=useState(""),[months,setMonths]=useState(1),[receipt,setReceipt]=useState(""),[msg,setMsg]=useState("");
 const [subs,setSubs]=useState({});
 useEffect(()=>onValue(ref(db,"subscriptions"),s=>setSubs(s.val()||{})),[]);
 async function activate(e){e.preventDefault();if(!uid)return;const now=Date.now(),current=Math.max(now,Number(subs[uid]?.expiresAt||0)),expires=current+Number(months)*30*86400000;await set(ref(db,`subscriptions/${uid}`),{status:"active",months:Number(months),amount:Number(months)*3000,activatedAt:now,expiresAt:expires,receiptNote:receipt||"",confirmedBy:auth.currentUser?.uid||"admin"});setMsg("Subscription activated/extended.");}
 async function expire(uid){await update(ref(db,`subscriptions/${uid}`),{status:"expired",expiresAt:Date.now()});setMsg("Subscription marked expired.");}
 return <section className="panel"><h1>Subscription management</h1><p>Monthly subscription: <b>₦3,000</b>. Payment is made to Opay account <b>9129225442</b>, Marshall Jacob. Admin confirms payment after receipt is sent to WhatsApp.</p>
 <form onSubmit={activate} className="grid3"><select value={uid} onChange={e=>setUid(e.target.value)} required><option value="">Choose student</option>{students.map(s=><option value={s.uid} key={s.uid}>{s.name||s.email}</option>)}</select><input type="number" min="1" max="24" value={months} onChange={e=>setMonths(e.target.value)} placeholder="Months"/><input value={receipt} onChange={e=>setReceipt(e.target.value)} placeholder="Receipt/reference note"/><button className="primary">Confirm payment & activate</button></form>
 {msg&&<p>{msg}</p>}
 <div className="subscriptionTable">{students.map(s=>{const x=subs[s.uid],ex=Number(x?.expiresAt||0),ok=ex>Date.now()&&x?.status==="active";return <div className="studentRow" key={s.uid}><div><b>{s.name||s.email}</b><small>{s.email}</small></div><div><b>{ok?"ACTIVE":"EXPIRED"}</b><small>{ex?new Date(ex).toLocaleString():"No subscription"}</small></div><div><button onClick={()=>expire(s.uid)}>Expire</button></div></div>})}</div></section>
}

function App(){const [mode,setMode]=useState(localStorage.getItem("mc_mode")||"student"),[student,setStudent]=useState(null),[admin,setAdmin]=useState(!!auth.currentUser);useEffect(()=>onAuthStateChanged(auth,u=>setAdmin(!!u)),[]);useEffect(()=>{const uid=localStorage.getItem("mc_student_uid");if(uid)get(ref(db,`students/${uid}`)).then(s=>s.exists()&&setStudent(s.val()))},[]);
 function logout(){localStorage.removeItem("mc_student_uid");setStudent(null);signOut(auth);setAdmin(false);setMode("student");localStorage.setItem("mc_mode","student")}
 if(mode==="admin"&&admin)return <AdminApp onLogout={logout}/>;
 if(mode==="admin")return <AdminLogin onBack={()=>setMode("student")} onLogin={()=>{localStorage.setItem("mc_mode","admin");setAdmin(true)}}/>;
 if(student)return <StudentApp student={student} onLogout={logout}/>;
 return <StudentLogin onLogin={setStudent} onAdmin={()=>{setMode("admin");localStorage.setItem("mc_mode","admin")}}/>
}
createRoot(document.getElementById("root")).render(<App/>);
