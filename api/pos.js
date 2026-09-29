// Secure Vercel API for Bin Alshareeb POS. All sensitive Supabase access stays server-side.
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COOKIE = 'bs_pos_session';
const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('SESSION_SECRET must be configured with at least 32 characters');

function b64(v) { return Buffer.from(v).toString('base64url'); }
function sign(payload) { const p = b64(JSON.stringify(payload)); const s = crypto.createHmac('sha256', SECRET || 'missing').update(p).digest('base64url'); return `${p}.${s}`; }
function verify(token) {
  try {
    const [p, s] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET || 'missing').update(p).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(p, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function setCookie(res, token) { res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`); }
function clearCookie(res) { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`); }
function json(res, status, body) { res.statusCode = status; res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store, max-age=0'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','same-origin'); res.end(JSON.stringify(body)); }
async function body(req) { return new Promise((resolve,reject)=>{ let d=''; let size=0; req.on('data',c=>{ size+=c.length; if(size>1024*1024){ reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'),{status:413})); req.destroy(); return; } d+=c; }); req.on('end',()=>{ try{resolve(d?JSON.parse(d):{})}catch(e){reject(Object.assign(new Error('INVALID_JSON'),{status:400}))} }); req.on('error',reject); }); }
async function getUser(req) {
  const cookies = req.headers.cookie || '';
  const token = cookies.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  const session = token && verify(token);
  if (!session?.uid) return null;
  const { data } = await supabase.from('app_users').select('id,name,role,branch_id,shift_period,active').eq('id',session.uid).maybeSingle();
  return data?.active === false ? null : data;
}
function allowedBranch(user, branchId) { return user.role === 'owner' || user.branch_id === branchId; }
function assertRole(user, roles) { if (!user || !roles.includes(user.role)) { const e=new Error('FORBIDDEN'); e.status=403; throw e; } }
function nowCairoDate(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function clientKey(req){ const ip=(req.headers['x-forwarded-for']||req.headers['x-real-ip']||'unknown').toString().split(',')[0].trim(); return crypto.createHash('sha256').update(`${SECRET||'missing'}|${ip}`).digest('hex'); }

async function bootstrap(user) {
  let branchesQ = supabase.from('branches').select('*').order('id');
  if (user.role !== 'owner') branchesQ = branchesQ.eq('id', user.branch_id);
  let stockQ = supabase.from('stock').select('*');
  if (user.role !== 'owner') stockQ = stockQ.eq('branch_id', user.branch_id);
  let salesQ = supabase.from('sales').select('*').order('ts',{ascending:false}).limit(2000);
  if (user.role !== 'owner') salesQ = salesQ.eq('branch_id', user.branch_id);
  let shiftsQ = supabase.from('shifts').select('*').order('opened_at',{ascending:false}).limit(100);
  if (user.role !== 'owner') shiftsQ = shiftsQ.eq('branch_id', user.branch_id);
  const [b,p,s,users,sales,shifts] = await Promise.all([
    branchesQ, supabase.from('products').select('*').eq('active',true).order('name'), stockQ,
    user.role==='owner' ? supabase.from('app_users').select('id,name,role,branch_id,shift_period,active').order('name') : Promise.resolve({data:[]}), salesQ, shiftsQ
  ]);
  const rawSales=sales.data||[];
  const safeSales=user.role==='manager' ? rawSales.map(({cost,profit,...sale})=>sale) : rawSales;
  const safeProducts=user.role==='manager' ? (p.data||[]).map(({cost_price,...product})=>product) : (p.data||[]);
  return { user, branches:b.data||[], products:safeProducts, stock:s.data||[], users:users.data||[], sales:safeSales, shifts:shifts.data||[] };
}

async function login(req,res, pin) {
  if (!/^\d{4,6}$/.test(String(pin||''))) return json(res,400,{error:'PIN غير صالح'});
  const key=clientKey(req);
  const guard=await supabase.rpc('pos_login_check',{p_key:key});
  if (guard.error) return json(res,500,{error:'تعذر التحقق من تسجيل الدخول'});
  if (guard.data?.allowed===false) return json(res,429,{error:'محاولات دخول كثيرة. جرّب بعد قليل.'});
  const { data: users, error } = await supabase.from('app_users').select('id,name,role,branch_id,shift_period,active,pin_hash').eq('active',true);
  if (error) return json(res,500,{error:'تعذر تسجيل الدخول'});
  let found = null;
  for (const u of users||[]) if (u.pin_hash && await bcrypt.compare(String(pin),u.pin_hash)) { found=u; break; }
  if (!found) { await supabase.rpc('pos_login_record',{p_key:key,p_success:false}); return json(res,401,{error:'الرقم السري غلط'}); }
  await supabase.rpc('pos_login_record',{p_key:key,p_success:true});
  setCookie(res, sign({uid:found.id,exp:Date.now()+8*60*60*1000,iat:Date.now()}));
  return json(res,200,{user:{id:found.id,name:found.name,role:found.role,branch_id:found.branch_id,shift_period:found.shift_period,active:found.active}});
}

function fmtQty(v){ const n=Number(v||0); return Number.isInteger(n)?String(n):n.toFixed(3).replace(/0+$/,'').replace(/\.$/,''); }

export default async function handler(req,res){
  try {
    const action = new URL(req.url, 'https://vercel.local').searchParams.get('action');
    if (action==='login' && req.method==='POST') { const b=await body(req); return login(req,res,b.pin); }
    if (action==='logout') { clearCookie(res); return json(res,200,{ok:true}); }
    if (action==='status' && req.method==='GET') { const u=await getUser(req); if(u) return json(res,200,{user:u,hasUsers:true}); const {count}=await supabase.from('app_users').select('id',{count:'exact',head:true}); return json(res,200,{user:null,hasUsers:(count||0)>0}); }
    if (action==='setup_owner' && req.method==='POST') {
      const {count}=await supabase.from('app_users').select('id',{count:'exact',head:true});
      if ((count||0)>0) return json(res,409,{error:'تم إنشاء المستخدمين بالفعل'});
      const b=await body(req); if(!String(b.name||'').trim()||!/^\d{4,6}$/.test(String(b.pin))) return json(res,400,{error:'بيانات غير صحيحة'});
      const id=crypto.randomUUID(); const hash=await bcrypt.hash(String(b.pin),12);
      const {error}=await supabase.from('app_users').insert({id,name:String(b.name).trim(),pin_hash:hash,role:'owner',branch_id:null,shift_period:null,active:true});
      if(error) return json(res,400,{error:error.message});
      setCookie(res,sign({uid:id,exp:Date.now()+8*60*60*1000})); return json(res,200,{ok:true});
    }
    const user=await getUser(req); if(!user) return json(res,401,{error:'انتهت الجلسة، سجل الدخول من جديد'});
    if (req.method==='GET' && action==='bootstrap') return json(res,200,await bootstrap(user));
    const b=await body(req);

    if(action==='save_product'){ assertRole(user,['owner']); const payload={...b,id:b.id||crypto.randomUUID(),name:String(b.name).trim(),sell_price:Number(b.sell_price),cost_price:Number(b.cost_price||0),package_weight:b.package_weight?Number(b.package_weight):null,reorder_point:Number(b.reorder_point||0),track_stock:b.track_stock!==false,active:true}; const {error}=await supabase.from('products').upsert(payload); if(error) throw Object.assign(new Error(error.message),{status:400}); return json(res,200,{ok:true}); }
    if(action==='archive_product'){ assertRole(user,['owner']); const {id}=b; const {data:used}=await supabase.from('sales').select('id').contains('items',[{productId:id}]).limit(1); if(used?.length) return json(res,409,{error:'المنتج مستخدم في فواتير سابقة، تم منع حذفه. عطّله بدل الحذف.'}); const {error}=await supabase.from('products').update({active:false}).eq('id',id); if(error) throw Object.assign(new Error(error.message),{status:400}); return json(res,200,{ok:true}); }
    if(action==='save_user'){ assertRole(user,['owner']); const id=b.id||crypto.randomUUID(); const role=['owner','manager','cashier'].includes(b.role)?b.role:'cashier'; if(role==='owner'){ const {count}=await supabase.from('app_users').select('id',{count:'exact',head:true}).eq('role','owner').neq('id',id); if((count||0)>0) return json(res,409,{error:'مسموح Owner واحد فقط'}); } if(role!=='owner'&&!b.branch_id) return json(res,400,{error:'لازم تختار الفرع'}); if(role==='cashier'&&!['morning','evening'].includes(b.shift_period)) return json(res,400,{error:'حدد الشيفت صباحي أو مسائي'}); const patch={id,name:String(b.name).trim(),role,branch_id:role==='owner'?null:b.branch_id,shift_period:role==='cashier'?b.shift_period:null,active:b.active!==false}; if(b.pin) patch.pin_hash=await bcrypt.hash(String(b.pin),12); const {error}=await supabase.from('app_users').upsert(patch); if(error) throw Object.assign(new Error(error.message),{status:400}); return json(res,200,{ok:true}); }
    if(action==='delete_user'){ assertRole(user,['owner']); if(b.id===user.id) return json(res,400,{error:'لا يمكن حذف الحساب الحالي'}); const {error}=await supabase.from('app_users').update({active:false}).eq('id',b.id); if(error) throw Object.assign(new Error(error.message),{status:400}); return json(res,200,{ok:true}); }
    if(action==='rename_branches'){ assertRole(user,['owner']); const list=Array.isArray(b.list)?b.list:[]; for(const x of list){ if(!x.id||!String(x.name).trim()) continue; const {error}=await supabase.from('branches').update({name:String(x.name).trim()}).eq('id',x.id); if(error) throw Object.assign(new Error(error.message),{status:400}); } return json(res,200,{ok:true}); }
    if(action==='restock'){ assertRole(user,['owner']); if(!allowedBranch(user,b.branch_id)) return json(res,403,{error:'غير مسموح'}); const delta=Number(b.delta); if(!(delta>0)) return json(res,400,{error:'الكمية يجب أن تكون أكبر من صفر'}); const {data,error}=await supabase.rpc('pos_restock',{p_branch_id:b.branch_id,p_product_id:b.product_id,p_delta:delta,p_user_id:user.id}); if(error) throw Object.assign(new Error(error.message),{status:400}); return json(res,200,{ok:true,data}); }
    if(action==='open_shift'){ assertRole(user,['cashier','owner']); const branchId=user.role==='owner'?b.branch_id:user.branch_id; if(!branchId) return json(res,400,{error:'الحساب غير مربوط بفرع'}); if(user.role==='cashier' && user.shift_period!==b.shift_period) return json(res,403,{error:'ده مش الشيفت المخصص ليك'}); const {data,error}=await supabase.rpc('pos_open_shift_v2',{p_branch_id:branchId,p_user_id:user.id,p_shift_period:b.shift_period||(user.role==='cashier'?user.shift_period:'morning'),p_opening_cash:Number(b.opening_cash||0)}); if(error) throw Object.assign(new Error(error.message),{status:400}); return json(res,200,{ok:true,shift:data}); }
    if(action==='close_shift'){
      assertRole(user,['manager','owner']);
      let data,error;
      if(Array.isArray(b.notes)){
        ({data,error}=await supabase.rpc('pos_close_shift_v3',{p_shift_id:b.shift_id,p_actual_cash:Number(b.actual_cash||0),p_expenses:b.notes,p_closed_by:user.id}));
        if(error) throw Object.assign(new Error(error.message),{status:400});
        return json(res,200,{ok:true,shift:data.shift,expense_total:data.expense_total});
      }
      ({data,error}=await supabase.rpc('pos_close_shift',{p_shift_id:b.shift_id,p_actual_cash:Number(b.actual_cash||0),p_notes:b.notes||null,p_closed_by:user.id}));
      if(error) throw Object.assign(new Error(error.message),{status:400});
      return json(res,200,{ok:true,shift:data});
    }
    if(action==='create_sale'){ assertRole(user,['cashier','owner']); const branchId=user.role==='owner'?b.branch_id:user.branch_id; if(!branchId) return json(res,403,{error:'الحساب غير مربوط بفرع'}); const requestId=String(b.request_id||'').trim(); if(!requestId) return json(res,400,{error:'رقم العملية مفقود، حاول مرة أخرى'}); const {data,error}=await supabase.rpc('pos_create_sale_v2',{p_branch_id:branchId,p_cashier_id:user.id,p_items:b.items,p_customer_name:b.customer_name||null,p_customer_phone:b.customer_phone||null,p_payment_method:b.payment_method||'cash',p_request_id:requestId}); if(error) throw Object.assign(new Error(error.message),{status:400}); return json(res,200,{ok:true,sale:data}); }
    if(action==='void_sale'){ assertRole(user,['owner']); const {data,error}=await supabase.rpc('pos_void_sale',{p_sale_id:b.sale_id,p_reason:String(b.reason||'').trim(),p_actor_id:user.id}); if(error) throw Object.assign(new Error(error.message),{status:400}); return json(res,200,{ok:true,sale:data}); }
    if(action==='update_sale'){ assertRole(user,['owner']); const {data,error}=await supabase.rpc('pos_update_sale_v2',{p_sale_id:b.sale_id,p_items:b.items,p_reason:String(b.reason||'').trim(),p_actor_id:user.id}); if(error) throw Object.assign(new Error(error.message),{status:400}); return json(res,200,{ok:true,sale:data}); }
    if(action==='report_summary' && req.method==='GET'){ assertRole(user,['manager','owner']); const branchId=user.role==='owner'?(new URL(req.url,'https://vercel.local').searchParams.get('branch_id')||null):user.branch_id; const {data,error}=await supabase.rpc('pos_report_summary',{p_branch_id:branchId}); if(error) throw Object.assign(new Error(error.message),{status:400}); if(user.role==='manager' && data){ const clean={...data,all:{...(data.all||{})},perBranch:{...(data.perBranch||{})},perUser:{...(data.perUser||{})}}; delete clean.all.cost; delete clean.all.profit; delete clean.all.profitToday; for(const k of Object.keys(clean.perBranch)){ delete clean.perBranch[k].cost; delete clean.perBranch[k].profit; delete clean.perBranch[k].profitToday; } for(const k of Object.keys(clean.perUser)){ delete clean.perUser[k].cost; delete clean.perUser[k].profit; } return json(res,200,{data:clean}); } return json(res,200,{data}); }
    if(action==='daily_finance'){ assertRole(user,['manager','owner']); const {data,error}=await supabase.rpc('pos_daily_finance_v2',{p_branch_id:user.role==='owner'?(b.branch_id||null):user.branch_id,p_date:b.date||nowCairoDate()}); if(error) throw Object.assign(new Error(error.message),{status:400}); if(user.role==='manager' && data){ const clean={...data}; delete clean.cost; delete clean.profit; return json(res,200,{ok:true,data:clean}); } return json(res,200,{ok:true,data}); }
    if(action==='closing_report' && req.method==='GET'){
      assertRole(user,['manager','owner']);
      const url=new URL(req.url,'https://vercel.local');
      const kind=url.searchParams.get('kind')==='shift'?'shift':'day';
      const requestedShift=url.searchParams.get('shift_id');
      const requestedBranch=user.role==='owner'?(url.searchParams.get('branch_id')||null):user.branch_id;
      let shifts=[];
      if(kind==='shift' && requestedShift){
        const q=await supabase.from('shifts').select('*').eq('id',requestedShift).maybeSingle();
        if(q.error) throw Object.assign(new Error(q.error.message),{status:400});
        if(q.data && (!requestedBranch || q.data.branch_id===requestedBranch)) shifts=[q.data];
      }else{
        const q=await supabase.from('shifts').select('*').order('opened_at',{ascending:false}).limit(500);
        if(q.error) throw Object.assign(new Error(q.error.message),{status:400});
        const date=url.searchParams.get('date')||nowCairoDate();
        shifts=(q.data||[]).filter(s=>(!requestedBranch||s.branch_id===requestedBranch) && new Date(s.closed_at||s.opened_at).toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'})===date);
      }
      if(!shifts.length) return json(res,200,{data:{kind,date_label:kind==='day'?(url.searchParams.get('date')||nowCairoDate()):'—',branch_name:requestedBranch?'':null,summary:{sales_total:0,expenses_total:0,expected_cash:0,actual_cash:0,difference:0,invoice_count:0,void_total:0},products:[],expenses:[],voids:[],shifts:[]}});
      const ids=shifts.map(s=>s.id);
      const [salesQ,expQ]=await Promise.all([
        supabase.from('sales').select('*').in('shift_id',ids).order('ts',{ascending:true}),
        supabase.from('shift_expenses').select('*').in('shift_id',ids).order('created_at',{ascending:true})
      ]);
      if(salesQ.error) throw Object.assign(new Error(salesQ.error.message),{status:400});
      if(expQ.error) throw Object.assign(new Error(expQ.error.message),{status:400});
      const allSales=salesQ.data||[], expenses=expQ.data||[];
      const completed=allSales.filter(s=>s.status==='completed');
      const voids=allSales.filter(s=>s.status==='voided');
      const productMap=new Map();
      for(const sale of completed){
        for(const it of sale.items||[]){
          const key=it.productId||it.name;
          const qty=Number(it.qty||0);
          const prev=productMap.get(key)||{name:it.name||'—',qty:0,total:0,sell_price:Number(it.sellPrice||0),type:it.type};
          prev.qty+=qty;
          prev.total+=Number(it.lineRevenue ?? (it.type==='bulk' ? (qty/1000)*Number(it.sellPrice||0) : qty*Number(it.sellPrice||0)));
          productMap.set(key,prev);
        }
      }
      const salesTotal=completed.reduce((n,s)=>n+Number(s.total||0),0);
      const expenseTotal=expenses.reduce((n,e)=>n+Number(e.amount||0),0);
      const expected=shifts.reduce((n,s)=>n+Number(s.expected_cash||0),0);
      const actual=shifts.filter(s=>s.closed_at).reduce((n,s)=>n+Number(s.actual_cash||0),0);
      const difference=shifts.filter(s=>s.closed_at).reduce((n,s)=>n+Number(s.difference||0),0);
      const branchNames=[...new Set(shifts.map(s=>s.branch_name).filter(Boolean))];
      const dayLabel=kind==='day' ? (url.searchParams.get('date')||nowCairoDate()) : new Date(shifts[0].closed_at||shifts[0].opened_at).toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});
      const shiftRows=shifts.map(s=>{const ss=completed.filter(x=>x.shift_id===s.id);const ee=expenses.filter(x=>x.shift_id===s.id);return {id:s.id,branch_name:s.branch_name||'—',shift_period:s.shift_period,sales_total:ss.reduce((n,x)=>n+Number(x.total||0),0),expenses_total:ee.reduce((n,x)=>n+Number(x.amount||0),0),difference:Number(s.difference||0)};});
      return json(res,200,{data:{kind,date_label:dayLabel,branch_name:branchNames.length===1?branchNames[0]:(requestedBranch?'—':'كل الفروع'),shift:kind==='shift'?shifts[0]:null,summary:{sales_total:salesTotal,expenses_total:expenseTotal,expected_cash:expected,actual_cash:actual,difference,invoice_count:completed.length,void_total:voids.reduce((n,s)=>n+Number(s.total||0),0)},products:[...productMap.values()].map(p=>({...p,qty_label:p.type==='bulk'?`${fmtQty(p.qty)} جم`:fmtQty(p.qty)})).sort((a,b)=>b.total-a.total),expenses:expenses.map(e=>({description:e.description,amount:Number(e.amount||0)})),voids:voids.map(v=>({invoice_label:v.id?.slice(0,8)||'—',total:Number(v.total||0),reason:v.void_reason||'—'})),shifts:shiftRows}});
    }
    if(action==='audit_log'){ assertRole(user,['owner']); const {data,error}=await supabase.from('audit_log').select('*').order('created_at',{ascending:false}).limit(500); if(error) throw Object.assign(new Error(error.message),{status:400}); return json(res,200,{data:data||[]}); }
    return json(res,404,{error:'Action not found'});
  } catch(e){ console.error(e); return json(res,e.status||500,{error:e.message||'Server error'}); }
}
