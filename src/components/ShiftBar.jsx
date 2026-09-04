import { useState } from "react";
import { X, Clock, Wallet } from "lucide-react";
import { fmt, fmtDateTime } from "../lib";

export function ShiftBar({ activeShift, branchName, onOpen, onClose, shiftPeriod='morning', canChooseShiftPeriod=false, canOpen=true, canClose=true }) {
  const [openingModal, setOpeningModal] = useState(false);
  const [closingModal, setClosingModal] = useState(false);

  if (!activeShift) {
    return (
      <div className="branch-row" style={{ marginBottom: 12, background: "#3A241C", border: "1px solid #C94F3E66" }}>
        {canOpen ? <button className="btn-secondary" style={{ background: "var(--accent)", color: "var(--bg)" }} onClick={() => setOpeningModal(true)}>ابدأ الشيفت</button> : <span className="tiny">في انتظار الكاشير لبدء الشيفت</span>}
        <div style={{ textAlign: "right" }}>
          <p style={{ fontWeight: 700, fontSize: 13 }}>لسه مفيش شيفت مفتوح في {branchName}</p>
          <p className="tiny">افتح شيفت عشان تسجل النقدية الافتتاحية وتقفلها آخر اليوم</p>
        </div>
        {canOpen && openingModal && <OpenShiftModal shiftPeriod={shiftPeriod} canChooseShiftPeriod={canChooseShiftPeriod} onClose={() => setOpeningModal(false)} onOpen={(cash, period) => { onOpen(cash, period); setOpeningModal(false); }} />}
      </div>
    );
  }

  return (
    <div className="branch-row" style={{ marginBottom: 12 }}>
      {canClose && <button className="btn-secondary" onClick={() => setClosingModal(true)}>إنهاء الشيفت</button>}
      <div style={{ textAlign: "right" }}>
        <p style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
          <Clock size={12} /> شيفت مفتوح من {fmtDateTime(Date.parse(activeShift.opened_at))}
        </p>
        <p className="tiny">النقدية الافتتاحية: {fmt(activeShift.opening_cash)} ج.م</p>
      </div>
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
  const [notes, setNotes] = useState("");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><button className="icon-btn" onClick={onClose}><X size={20} /></button><h3>إنهاء الشيفت</h3></div>
        <p className="tiny" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 4 }}><Wallet size={14} /> عد الكاش الموجود فعليًا في الدرج واكتبه هنا</p>
        <input className="text-input" type="number" placeholder="النقدية الفعلية في الدرج" value={cash} onChange={(e) => setCash(e.target.value)} />
        <input className="text-input" placeholder="ملاحظات (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button className="btn btn-primary" disabled={cash === ""} onClick={() => onConfirm(Number(cash) || 0, notes)}>تأكيد الإقفال</button>
      </div>
    </div>
  );
}
