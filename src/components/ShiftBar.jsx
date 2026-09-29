import { useState } from "react";
import { X, Clock, Wallet } from "lucide-react";
import { fmt, fmtDateTime } from "../lib";

export function ShiftBar({ activeShift, branchName, onOpen, onClose, shiftPeriod='morning', canChooseShiftPeriod=false, canOpen=true, canClose=true }) {
  const [openingModal, setOpeningModal] = useState(false);
  const [closingModal, setClosingModal] = useState(false);

  if (!activeShift) {
    return (
      <div className="shift-banner">
        {canOpen ? <button className="button button-primary" onClick={() => setOpeningModal(true)}>ابدأ الشيفت</button> : <span className="tiny">في انتظار الكاشير لبدء الشيفت</span>}
        <div><strong>لا يوجد شيفت مفتوح في {branchName || "هذا الفرع"}</strong><p> {canOpen ? "ابدأ الشيفت لتسجيل النقدية الافتتاحية قبل البيع." : "في انتظار الكاشير لبدء الشيفت."}</p></div>
        {canOpen && openingModal && <OpenShiftModal shiftPeriod={shiftPeriod} canChooseShiftPeriod={canChooseShiftPeriod} onClose={() => setOpeningModal(false)} onOpen={(cash, period) => { onOpen(cash, period); setOpeningModal(false); }} />}
      </div>
    );
  }

  return (
    <div className="shift-banner">
      {canClose && <button className="button button-secondary" onClick={() => setClosingModal(true)}>إنهاء الشيفت</button>}
      <div><strong><Clock size={12} style={{verticalAlign:"middle",marginLeft:4}}/> الشيفت مفتوح · {branchName}</strong><p>بدأ {fmtDateTime(Date.parse(activeShift.opened_at))} · افتتاحي {fmt(activeShift.opening_cash)} ج.م</p></div>
      {canClose && closingModal && <CloseShiftModal shift={activeShift} onClose={() => setClosingModal(false)} onConfirm={(cash, notes) => { onClose(cash, notes); setClosingModal(false); }} />}
    </div>
  );
}

function OpenShiftModal({ onClose, onOpen, shiftPeriod, canChooseShiftPeriod }) {
  const [cash, setCash] = useState("");
  const [period, setPeriod] = useState(shiftPeriod);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><button className="icon-btn" onClick={onClose}><X size={20} /></button><h3>بدء الشيفت</h3></div>
        <p className="tiny" style={{ marginBottom: 10 }}>اكتب النقدية الموجودة في الدرج دلوقتي قبل ما تبدأ البيع</p>
        {canChooseShiftPeriod && <select className="select" style={{width:'100%',marginBottom:8}} value={period} onChange={(e) => setPeriod(e.target.value)}><option value="morning">صباحي</option><option value="evening">مسائي</option></select>}
        <input className="text-input" type="number" placeholder="النقدية الافتتاحية" value={cash} onChange={(e) => setCash(e.target.value)} />
        <button className="btn btn-primary" disabled={cash === ""} onClick={() => onOpen(Number(cash) || 0, period)}>بدء الشيفت</button>
      </div>
    </div>
  );
}

function CloseShiftModal({ shift, onClose, onConfirm }) {
  const [cash, setCash] = useState("");
  const [expenses, setExpenses] = useState([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  const addExpense = () => {
    const value = Number(amount);
    const label = description.trim();
    if (!(value > 0) || !label) return;
    setExpenses(list => [...list, { description: label, amount: value }]);
    setDescription(""); setAmount("");
  };
  const removeExpense = (idx) => setExpenses(list => list.filter((_,i)=>i!==idx));
  const expenseTotal = expenses.reduce((n,e)=>n+Number(e.amount||0),0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><button className="icon-btn" onClick={onClose}><X size={20} /></button><h3>إنهاء الشيفت</h3></div>
        <p className="tiny" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 4 }}><Wallet size={14} /> عد الكاش الموجود فعليًا في الدرج واكتبه هنا</p>
        <input className="text-input" type="number" placeholder="النقدية الفعلية في الدرج" value={cash} onChange={(e) => setCash(e.target.value)} />

        <div style={{marginTop:12,paddingTop:10,borderTop:'1px solid var(--border)'}}>
          <p style={{fontWeight:700,marginBottom:7}}>مصروفات الشيفت</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 120px auto',gap:6}}>
            <input className="text-input" placeholder="البيان — مثال: كهرباء" value={description} onChange={e=>setDescription(e.target.value)} />
            <input className="text-input" type="number" min="0" placeholder="المبلغ" value={amount} onChange={e=>setAmount(e.target.value)} />
            <button className="btn-secondary" type="button" onClick={addExpense}>إضافة</button>
          </div>
          {expenses.map((e,i)=><div key={i} className="branch-row" style={{marginTop:6,padding:'7px 9px'}}><button style={{color:'var(--bad)'}} onClick={()=>removeExpense(i)}><X size={14}/></button><span>{fmt(e.amount)} ج.م</span><strong>{e.description}</strong></div>)}
          <p className="tiny" style={{marginTop:7}}>إجمالي المصروفات: <b>{fmt(expenseTotal)} ج.م</b></p>
        </div>

        <button className="btn btn-primary" disabled={cash === ""} onClick={() => onConfirm(Number(cash) || 0, expenses)}>تأكيد الإقفال</button>
      </div>
    </div>
  );
}
