import { useMemo, useState } from 'react';
import { FileText, Printer, X, CalendarDays } from 'lucide-react';
import { api } from '../api';
import { fmt, fmtDateTime } from '../lib';

const periodLabel = (p) => p === 'evening' ? 'مسائي' : p === 'morning' ? 'صباحي' : '—';
const cairoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

export function ShiftReports({ shifts = [], sales = [], branches = [], isOwner = false, currentBranchId = '' }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const visibleShifts = useMemo(() => {
    const allowed = isOwner ? shifts : shifts.filter(s => s.branch_id === currentBranchId);
    return [...allowed].sort((a,b) => Date.parse(b.closed_at || b.opened_at) - Date.parse(a.closed_at || a.opened_at));
  }, [shifts, isOwner, currentBranchId]);

  const openReport = async (kind, shiftId = null) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ kind });
      if (shiftId) params.set('shift_id', shiftId);
      if (isOwner && currentBranchId && currentBranchId !== 'all') params.set('branch_id', currentBranchId);
      const r = await api(`closing_report?${params.toString()}`);
      setReport(r.data);
    } catch (e) { setError(e.message || 'تعذر تحميل التقرير'); }
    finally { setLoading(false); }
  };

  return <>
    <div className="grid-3" style={{ marginTop: 20 }}>
      <div className="stat"><p className="tiny">شيفتات مسجلة</p><strong>{visibleShifts.length}</strong></div>
      <div className="stat"><p className="tiny">شيفتات مقفولة</p><strong>{visibleShifts.filter(s => s.closed_at).length}</strong></div>
      <div className="stat"><p className="tiny">مبيعات اليوم</p><strong>{fmt(visibleShifts.filter(s => new Date(s.closed_at || s.opened_at).toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'}) === cairoToday()).reduce((n,s) => n + sales.filter(x=>x.shift_id===s.id && x.status!=='voided').reduce((a,x)=>a+Number(x.total||0),0),0))} ج.م</strong></div>
    </div>
    <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
      <button className="btn-secondary" onClick={() => openReport('day')}><CalendarDays size={14}/> ورقة تقفيل اليوم</button>
      {visibleShifts.filter(s=>s.closed_at).length > 0 && <button className="btn-secondary" onClick={() => openReport('shift', visibleShifts.find(s=>s.closed_at)?.id)}><FileText size={14}/> آخر تقفيل شيفت</button>}
    </div>
    {error && <p className="tiny-bad" style={{marginTop:8}}>{error}</p>}
    {report && <ClosingReportModal report={report} onClose={() => setReport(null)} onPrint={() => window.print()} />}
    {loading && <p className="tiny" style={{marginTop:8}}>بيجهز ورقة التقفيل...</p>}
  </>;
}

function ClosingReportModal({ report, onClose, onPrint }) {
  const isDay = report.kind === 'day';
  return <div className="modal-overlay no-print-overlay" onClick={onClose}>
    <div className="modal closing-report-modal" onClick={e=>e.stopPropagation()}>
      <div className="modal-head no-print"><button className="icon-btn" onClick={onClose}><X size={20}/></button><h3>{isDay ? 'ورقة تقفيل اليوم' : 'ورقة تقفيل الشيفت'}</h3></div>
      <div className="closing-report" dir="rtl">
        <header className="closing-head">
          <h1>بن الشريب</h1>
          <h2>{isDay ? 'تقرير تقفيل اليوم' : 'تقرير تقفيل الشيفت'}</h2>
          <p>{report.branch_name || 'كل الفروع'} · {report.date_label}</p>
          {!isDay && <p>{periodLabel(report.shift?.shift_period)} · {report.shift?.user_name || '—'}</p>}
        </header>

        <section className="closing-summary">
          <Summary label="إجمالي المبيعات" value={report.summary.sales_total}/>
          <Summary label="إجمالي المصروفات" value={report.summary.expenses_total}/>
          <Summary label="النقدية المتوقعة" value={report.summary.expected_cash}/>
          <Summary label="النقدية الفعلية" value={report.summary.actual_cash}/>
          <Summary label="فرق النقدية" value={report.summary.difference}/>
          <Summary label="عدد الفواتير" value={report.summary.invoice_count} money={false}/>
        </section>

        <ReportTable title="الأصناف المباعة" headers={['الصنف','الكمية','سعر البيع','الإجمالي']} rows={report.products.map(p=>[p.name,p.qty_label,fmt(p.sell_price),fmt(p.total)])} total={report.summary.sales_total}/>

        <ReportTable title="المصروفات" headers={['البيان','المبلغ']} rows={report.expenses.map(e=>[e.description,fmt(e.amount)])} total={report.summary.expenses_total} empty="لا توجد مصروفات" />

        <ReportTable title="الفواتير الملغاة (Void)" headers={['الفاتورة','الإجمالي','السبب']} rows={report.voids.map(v=>[v.invoice_label,fmt(v.total),v.reason || '—'])} total={report.summary.void_total} empty="لا توجد فواتير ملغاة" />

        {isDay && report.shifts?.length > 0 && <ReportTable title="ملخص الشيفتات" headers={['الفرع','الشيفت','المبيعات','المصروفات','الفرق']} rows={report.shifts.map(s=>[s.branch_name,periodLabel(s.shift_period),fmt(s.sales_total),fmt(s.expenses_total),fmt(s.difference)])} />}
        <footer className="closing-foot">تم إنشاء التقرير: {fmtDateTime(Date.now())}</footer>
      </div>
      <div className="closing-actions no-print"><button className="btn btn-primary" onClick={onPrint}><Printer size={15}/> طباعة الورقة</button><button className="btn-secondary" onClick={onClose}>إغلاق</button></div>
    </div>
    <style>{`\n      .closing-report-modal{max-width:760px!important;width:min(760px,96vw)}\n      .closing-report{background:#fff;color:#111;padding:22px;border-radius:12px;font-family:Arial,sans-serif}\n      .closing-head{text-align:center;border-bottom:2px solid #222;padding-bottom:12px;margin-bottom:14px}\n      .closing-head h1{margin:0;font-size:25px}.closing-head h2{margin:5px 0;font-size:18px}.closing-head p{margin:3px 0;font-size:12px}\n      .closing-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}\n      .closing-summary>div{border:1px solid #bbb;padding:8px;border-radius:7px;text-align:center}.closing-summary b{display:block;font-size:15px;margin-top:3px}\n      .closing-section{margin:14px 0}.closing-section h3{font-size:15px;margin:0 0 6px}\n      .closing-table{width:100%;border-collapse:collapse;font-size:12px}.closing-table th,.closing-table td{border:1px solid #aaa;padding:6px}.closing-table th{font-weight:700}.closing-total td{font-weight:700}\n      .closing-foot{border-top:1px solid #aaa;margin-top:16px;padding-top:8px;font-size:10px;text-align:center}\n      .closing-actions{display:flex;gap:8px;margin-top:10px}.no-print-overlay{}\n      @media print{body *{visibility:hidden!important}.closing-report,.closing-report *{visibility:visible!important}.closing-report{position:absolute;inset:0;width:auto!important;padding:10mm!important;border-radius:0!important}.no-print{display:none!important}.no-print-overlay{position:static!important;background:none!important}.closing-report-modal{max-width:none!important;width:auto!important;box-shadow:none!important;background:none!important}.closing-summary{grid-template-columns:repeat(3,1fr)}}\n      @media(max-width:600px){.closing-summary{grid-template-columns:repeat(2,1fr)}}\n    `}</style>
  </div>;
}

function Summary({label,value,money=true}) { return <div><span>{label}</span><b>{fmt(value)}{money ? ' ج.م' : ''}</b></div>; }
function ReportTable({title,headers,rows,total,empty='لا توجد بيانات'}) { return <section className="closing-section"><h3>{title}</h3>{rows.length ? <table className="closing-table"><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}{total !== undefined && <tr className="closing-total"><td colSpan={headers.length-1}>الإجمالي</td><td>{fmt(total)}{title==='الأصناف المباعة'||title==='المصروفات'||title.includes('Void') ? ' ج.م' : ''}</td></tr>}</tbody></table> : <p className="tiny">{empty}</p>}</section>; }
