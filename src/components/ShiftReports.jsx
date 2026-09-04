import { useMemo, useState } from 'react';
import { Download, FileText, X } from 'lucide-react';
import { fmt, fmtDateTime, downloadCSV } from '../lib';

const periodLabel = (p) => p === 'evening' ? 'مسائي' : p === 'morning' ? 'صباحي' : '—';

export function ShiftReports({ shifts = [], sales = [], branches = [], isOwner = false, currentBranchId = '' }) {
  const [open, setOpen] = useState(false);
  const visibleShifts = useMemo(() => {
    const allowed = isOwner ? shifts : shifts.filter(s => s.branch_id === currentBranchId);
    return [...allowed].sort((a,b) => Date.parse(b.closed_at || b.opened_at) - Date.parse(a.closed_at || a.opened_at));
  }, [shifts, isOwner, currentBranchId]);
  const branchName = (id) => branches.find(b => b.id === id)?.name || '—';
  const rows = visibleShifts.map(s => {
    const shiftSales = sales.filter(x => x.shift_id === s.id && x.status !== 'voided');
    const total = shiftSales.reduce((n,x) => n + Number(x.total || 0), 0);
    return { ...s, invoiceCount: shiftSales.length, salesTotal: total };
  });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const todayRows = rows.filter(s => new Date(s.closed_at || s.opened_at).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }) === today);
  const openCount = rows.filter(s => !s.closed_at).length;
  const todaySales = todayRows.reduce((n,s) => n + s.salesTotal, 0);
  const todayExpected = todayRows.reduce((n,s) => n + Number(s.expected_cash || 0), 0);
  const todayActual = todayRows.reduce((n,s) => n + Number(s.actual_cash || 0), 0);
  const exportShifts = () => downloadCSV(`تقفيلات-الشيفتات-${today}.csv`, rows.map(s => ({
    التاريخ: fmtDateTime(Date.parse(s.closed_at || s.opened_at)),
    الفرع: branchName(s.branch_id),
    الشيفت: periodLabel(s.shift_period),
    'فتح بواسطة': s.user_name || '—',
    'وقت الفتح': fmtDateTime(Date.parse(s.opened_at)),
    'وقت القفل': s.closed_at ? fmtDateTime(Date.parse(s.closed_at)) : 'مفتوح',
    'بداية النقدية': Number(s.opening_cash || 0),
    'عدد الفواتير': s.invoiceCount,
    'إجمالي المبيعات': s.salesTotal,
    'المتوقع نقدي': Number(s.expected_cash || 0),
    'النقدية الفعلية': Number(s.actual_cash || 0),
    'العجز/الزيادة': Number(s.difference || 0),
    'قفل بواسطة': s.closed_by || '—',
    'ملاحظات القفل': s.notes || ''
  })));
  return <>
    <div className="grid-3" style={{ marginTop: 20 }}>
      <div className="stat"><p className="tiny">شيفتات مقفولة النهارده</p><strong>{todayRows.filter(s=>s.closed_at).length}</strong></div>
      <div className="stat"><p className="tiny">مبيعات شيفتات النهارده</p><strong>{fmt(todaySales)} ج.م</strong></div>
      <div className="stat"><p className="tiny">شيفتات مفتوحة</p><strong>{openCount}</strong></div>
    </div>
    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
      <button className="btn-secondary" onClick={()=>setOpen(true)}><FileText size={14}/> تقفيلات الشيفتات + اليومية</button>
      {rows.length > 0 && <button className="btn-secondary" onClick={exportShifts}><Download size={14}/> تصدير تقفيلات CSV</button>}
    </div>
    {open && <div className="modal-overlay" onClick={()=>setOpen(false)}>
      <div className="modal" style={{maxWidth:560}} onClick={e=>e.stopPropagation()}>
        <div className="modal-head"><button className="icon-btn" onClick={()=>setOpen(false)}><X size={20}/></button><h3>تقفيلات الشيفتات واليومية</h3></div>
        <div className="grid-2" style={{marginBottom:12}}>
          <div className="stat"><p className="tiny">مبيعات اليومية</p><strong>{fmt(todaySales)} ج.م</strong></div>
          <div className="stat"><p className="tiny">فرق النقدية</p><strong>{fmt(todayActual - todayExpected)} ج.م</strong></div>
        </div>
        <div style={{maxHeight:'58vh',overflowY:'auto'}}>
          {rows.map(s=><div key={s.id} className="branch-row" style={{display:'block'}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <strong>{branchName(s.branch_id)} · {periodLabel(s.shift_period)}</strong>
              <span className="tiny">{s.closed_at ? 'مقفول' : 'مفتوح'}</span>
            </div>
            <p className="tiny" style={{marginTop:5}}>فتح بواسطة: <b>{s.user_name || '—'}</b> · {fmtDateTime(Date.parse(s.opened_at))}</p>
            <p className="tiny">القفل: {s.closed_at ? `${fmtDateTime(Date.parse(s.closed_at))} · بواسطة ${s.closed_by || '—'}` : 'لم يُقفل بعد'}</p>
            <p className="tiny">الفواتير: {s.invoiceCount} · المبيعات: {fmt(s.salesTotal)} ج.م · المتوقع: {fmt(s.expected_cash || 0)} · الفعلي: {fmt(s.actual_cash || 0)} · الفرق: {fmt(s.difference || 0)}</p>
            {s.notes && <p style={{marginTop:6,padding:7,borderRadius:8,background:'var(--bg)'}}><b>ملاحظات القفل:</b> {s.notes}</p>}
          </div>)}
          {!rows.length && <p className="tiny">مفيش شيفتات مسجلة للفترة دي.</p>}
        </div>
      </div>
    </div>}
  </>;
}
