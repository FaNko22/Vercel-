import { useState } from 'react';
import { Coffee, Lock } from 'lucide-react';
import { api } from '../api';

export function FirstSetup({ onCreated }) {
  const [name,setName]=useState(''); const [pin,setPin]=useState(''); const [err,setErr]=useState('');
  const valid=name.trim() && /^\d{4,6}$/.test(pin);
  const submit=async()=>{try{await api('setup_owner',{method:'POST',body:{name:name.trim(),pin}}); onCreated();}catch(e){setErr(e.message)}};
  return <div className="center-screen"><div className="center-card"><Coffee size={36} color="var(--accent)" style={{margin:'0 auto',display:'block'}}/><h1 className="disp" style={{fontSize:26}}>بن الشريب</h1><p className="tiny" style={{fontSize:13}}>إنشاء حساب الـ Owner الأساسي</p><input className="text-input" style={{width:'100%',textAlign:'center'}} placeholder="اسم صاحب النظام" value={name} onChange={e=>setName(e.target.value)}/><input className="text-input" style={{width:'100%',textAlign:'center',letterSpacing:4}} placeholder="رقم سري من 4 لـ 6 أرقام" inputMode="numeric" type="password" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))}/>{err&&<p className="tiny-bad">{err}</p>}<button className="btn btn-primary" disabled={!valid} onClick={submit}>إنشاء الحساب والدخول</button><p className="tiny">الـ Owner هو المستخدم الوحيد صاحب كل الصلاحيات.</p></div></div>;
}
export function LoginScreen({ onLogin }) {
  const [pin,setPin]=useState(''); const [err,setErr]=useState(''); const [busy,setBusy]=useState(false);
  const submit=async()=>{setBusy(true);setErr('');try{const r=await api('login',{method:'POST',body:{pin}});onLogin(r.user);}catch(e){setErr(e.message)}finally{setBusy(false)}};
  return <div className="center-screen"><div className="center-card"><Coffee size={36} color="var(--accent)" style={{margin:'0 auto',display:'block'}}/><h1 className="disp" style={{fontSize:26}}>بن الشريب</h1><p className="tiny" style={{fontSize:13}}>ادخل الرقم السري</p><input className="text-input" style={{width:'100%',textAlign:'center',letterSpacing:8,fontSize:18}} type="password" inputMode="numeric" autoFocus placeholder="الرقم السري" value={pin} onChange={e=>{setPin(e.target.value.replace(/\D/g,''));setErr('')}} onKeyDown={e=>e.key==='Enter'&&submit()}/>{err&&<p style={{color:'var(--bad)',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Lock size={13}/>{err}</p>}<button className="btn btn-primary" disabled={busy||!pin} onClick={submit}>{busy?'جاري التحقق…':'دخول'}</button></div></div>;
}
