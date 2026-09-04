import { useState, useEffect } from "react";
import { api } from "../api";
import { Store, User, Pencil, Trash2, X, Plus, Minus, Receipt, Printer, Search, Download } from "lucide-react";
import { fmt, fmtDateTime, lineTotal, downloadCSV } from "../lib";
import { Stat } from "../components/Nav";
import { ReceiptModal } from "../components/Receipt";

export function ReportsTab({ reportsData, branches, sales, isOwner, deleteSale, updateSale }) {
  const [showLog, setShowLog] = useState(false);
  const [finance,setFinance]=useState(null);
  const [summary,setSummary]=useState(null);
  const fallback = reportsData; const perBranch = summary ? summary.perBranch || {} : fallback.perBranch; const perUser = summary ? summary.perUser || {} : fallback.perUser; const all = summary ? summary.all || fallback.all : fallback.all; const topProducts = summary ? summary.topProducts || fallback.topProducts : fallback.topProducts; const bottomProducts = summary ? summary.bottomProducts || fallback.bottomProducts || [] : fallback.bottomProducts || [];
  useEffect(()=>{api('report_summary').then(r=>setSummary(r.data)).catch(()=>{}); api('daily_finance',{method:'POST',body:{branch_id:branches.length===1?branches[0].id:null}}).then(r=>setFinance(r.data)).catch(()=>{});},[branches]);

  const now = Date.now();
  const DAY = 86400000;
  const sumRange = (start, end) => sales.filter((s) => { const t = Date.parse(s.ts); return t >= start && t < end; }).reduce((sum, s) => sum + Number(s.total), 0);
  const thisWeek = summary ? Number(summary.all?.thisWeek||0) : sumRange(now - 7 * DAY, now);
  const lastWeek = summary ? Number(summary.all?.lastWeek||0) : sumRange(now - 14 * DAY, now - 7 * DAY);
  const weekDiff = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : null;

  const cashTotal = summary ? Number(summary.payments?.cash||0) : sales.filter((s) => (s.payment_method || "cash") === "cash").reduce((sum, s) => sum + Number(s.total), 0);
  const vfCashTotal = summary ? Number(summary.payments?.vodafone_cash||0) : sales.filter((s) => s.payment_method === "vodafone_cash").reduce((sum, s) => sum + Number(s.total), 0);

  const todayStamp = () => new Date().toISOString().slice(0, 10);
  const exportCSV = () => {
    const rows = [...sales].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).map((s) => ({
      التاريخ: fmtDateTime(Date.parse(s.ts)),
      الفرع: s.branch_name,
      الكاشير: s.cashier_name,
      العميل: s.customer_name || "",
      "موبايل العميل": s.customer_phone || "",
      "طريقة الدفع": s.payment_method === "vodafone_cash" ? "فودافون كاش" : "نقدي",
      الإجمالي: s.total,
      التكلفة: s.cost,
      الربح: s.profit,
    }));
    downloadCSV(`مبيعات-بن-الشريب-${todayStamp()}.csv`, rows);
  };

  return (
    <div>
      {finance && <><p className="tiny" style={{ marginBottom: 8 }}>المالية اليومية من قاعدة البيانات</p><div className="grid-3"><Stat label="مبيعات اليوم" value={fmt(finance.revenue)} sub="ج.م"/><Stat label="نقدي" value={fmt(finance.cash)} sub="ج.م"/><Stat label="فودافون كاش" value={fmt(finance.vodafone_cash)} sub="ج.م"/></div></>}
      <p className="tiny" style={{ marginBottom: 8 }}>كل الفروع مجتمعة</p>
      <div className="grid-3">
        <Stat label="مبيعات النهارده" value={fmt(all.revToday)} sub="ج.م" />
        <Stat label="ربح النهارده" value={fmt(all.profitToday)} sub="ج.م" tone={all.profitToday >= 0 ? "up" : "down"} />
        <Stat label="عدد الفواتير" value={all.count} sub="إجمالي" />
      </div>
      <div className="grid-2" style={{ marginTop: 8 }}>
        <Stat label="إجمالي المبيعات (كل الوقت)" value={fmt(all.revenue)} sub="ج.م" />
        <Stat label="صافي الربح (كل الوقت)" value={fmt(all.profit)} sub="ج.م" tone={all.profit >= 0 ? "up" : "down"} />
      </div>

      <p className="tiny" style={{ margin: "20px 0 8px" }}>الأسبوع ده مقابل اللي فات</p>
      <div className="grid-2">
        <Stat label="آخر 7 أيام" value={fmt(thisWeek)} sub="ج.م" />
        <Stat
          label="التغيير عن الأسبوع اللي فات"
          value={weekDiff === null ? "—" : `${weekDiff >= 0 ? "+" : ""}${fmt(weekDiff)}%`}
          sub={`قبلها: ${fmt(lastWeek)} ج.م`}
          tone={weekDiff === null ? undefined : weekDiff >= 0 ? "up" : "down"}
        />
      </div>

      <p className="tiny" style={{ margin: "20px 0 8px" }}>حسب طريقة الدفع (كل الوقت)</p>
      <div className="grid-2">
        <Stat label="نقدي" value={fmt(cashTotal)} sub="ج.م" />
        <Stat label="فودافون كاش" value={fmt(vfCashTotal)} sub="ج.م" />
      </div>

      <p className="tiny" style={{ margin: "20px 0 8px" }}>أداء كل فرع</p>
      {branches.map((b) => {
        const d = perBranch[b.id] || { revenue: 0, profit: 0, count: 0, revToday: 0 };
        return (
          <div key={b.id} className="branch-row">
            <div style={{ textAlign: "left" }}>
              <p style={{ fontWeight: 700, color: "var(--accent)" }}>{fmt(d.revenue)} ج.م</p>
              <p className="tiny">النهارده: {fmt(d.revToday)} ج.م</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Store size={16} color="var(--muted)" />
              <div>
                <p style={{ fontWeight: 700 }}>{b.name}</p>
                <p className="tiny">{d.count} فاتورة · ربح {fmt(d.profit)} ج.م</p>
              </div>
            </div>
          </div>
        );
      })}

      {Object.keys(perUser).length > 0 && (
        <>
          <p className="tiny" style={{ margin: "20px 0 8px" }}>الأداء حسب اليوزر / الشفت</p>
          {Object.entries(perUser).map(([name, d]) => (
            <div key={name} className="branch-row">
              <div style={{ textAlign: "left" }}>
                <p style={{ fontWeight: 700, color: "var(--accent)" }}>{fmt(d.revenue)} ج.م</p>
                <p className="tiny">{d.count} فاتورة</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <User size={16} color="var(--muted)" />
                <p style={{ fontWeight: 700 }}>{d.name || name}</p>
              </div>
            </div>
          ))}
        </>
      )}

      {topProducts.length > 0 && (
        <>
          <p className="tiny" style={{ margin: "20px 0 8px" }}>الأكتر مبيعًا</p>
          {topProducts.map(([name, qty], i) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", background: "var(--surface)", borderRadius: 10, padding: "8px 12px", fontSize: 14, marginBottom: 6 }}>
              <span className="tiny">{fmt(qty)}</span>
              <span style={{ display: "flex", gap: 8 }}><span className="tiny">{i + 1}.</span>{name}</span>
            </div>
          ))}
        </>
      )}

      {bottomProducts.length > 0 && (
        <>
          <p className="tiny" style={{ margin: "20px 0 8px" }}>الأقل مبيعًا</p>
          {bottomProducts.map(([name, qty], i) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", background: "var(--surface)", borderRadius: 10, padding: "8px 12px", fontSize: 14, marginBottom: 6 }}>
              <span className="tiny">{fmt(qty)}</span>
              <span style={{ display: "flex", gap: 8 }}><span className="tiny">{i + 1}.</span>{name}</span>
            </div>
          ))}
        </>
      )}

      {isOwner && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
            <button className="btn-secondary" style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={() => setShowLog(true)}>
              <Receipt size={14} /> سجل الفواتير (تعديل / إلغاء)
            </button>
            <button className="btn-secondary" style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={exportCSV}>
              <Download size={14} /> تصدير كل المبيعات CSV
            </button>
          </div>
          {showLog && <SalesLog sales={sales} onClose={() => setShowLog(false)} deleteSale={deleteSale} updateSale={updateSale} />}
        </>
      )}
    </div>
  );
}

function SalesLog({ sales, onClose, deleteSale, updateSale }) {
  const [editingSale, setEditingSale] = useState(null);
  const [printingSale, setPrintingSale] = useState(null);
  const [query, setQuery] = useState("");

  const sorted = sales.filter(s=>s.status!=='voided').sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  const q = query.trim().toLowerCase();
  const list = q
    ? sorted.filter((s) => (s.customer_phone || "").includes(q) || (s.customer_name || "").toLowerCase().includes(q))
    : sorted.slice(0, 50);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><button className="icon-btn" onClick={onClose}><X size={20} /></button><h3>سجل الفواتير</h3></div>

        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={16} style={{ position: "absolute", right: 12, top: 12, color: "var(--dim)" }} />
          <input
            className="text-input"
            style={{ width: "100%", paddingRight: 36 }}
            placeholder="دور برقم موبايل العميل أو اسمه..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
          {list.map((s) => (
            <div key={s.id} className="branch-row">
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ color: "var(--bad)" }} onClick={() => { if (window.confirm("متأكد إنك عايز تلغي الفاتورة دي؟ هيترجع المخزون تلقائيًا وسيتسجل السبب.")) deleteSale(s); }}><Trash2 size={16} /></button>
                <button style={{ color: "var(--muted)" }} onClick={() => setEditingSale(s)}><Pencil size={16} /></button>
                <button style={{ color: "var(--accent)" }} onClick={() => setPrintingSale({ ...s, ts: Date.parse(s.ts) })}><Printer size={16} /></button>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontWeight: 700 }}>{fmt(s.total)} ج.م — {s.branch_name}</p>
                <p className="tiny">{fmtDateTime(Date.parse(s.ts))} · {s.cashier_name}</p>
                {(s.customer_name || s.customer_phone) && (
                  <p className="tiny">{s.customer_name || "—"}{s.customer_phone ? ` · ${s.customer_phone}` : ""}</p>
                )}
              </div>
            </div>
          ))}
          {!list.length && <p className="tiny">{q ? "مفيش فواتير للعميل ده." : "لسه مفيش فواتير."}</p>}
        </div>

        {editingSale && (
          <EditSaleModal
            sale={editingSale}
            onClose={() => setEditingSale(null)}
            onSave={(items) => { updateSale(editingSale, items); setEditingSale(null); }}
          />
        )}
        {printingSale && <ReceiptModal sale={printingSale} onClose={() => setPrintingSale(null)} />}
      </div>
    </div>
  );
}

function EditSaleModal({ sale, onClose, onSave }) {
  const [items, setItems] = useState(sale.items.map((i) => ({ ...i })));

  const setQty = (idx, qty) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, qty: Math.max(0, qty) } : it)));
  const removeItem = (idx) => setItems((list) => list.filter((_, i) => i !== idx));

  const total = items.reduce((s, i) => s + lineTotal(i), 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><button className="icon-btn" onClick={onClose}><X size={20} /></button><h3>تعديل الفاتورة</h3></div>
        {items.map((it, idx) => (
          <div key={idx} className="cart-row" style={{ alignItems: "center" }}>
            <button style={{ color: "var(--bad)" }} onClick={() => removeItem(idx)}><Trash2 size={14} /></button>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="qty-btn" style={{ width: 28, height: 28 }} onClick={() => setQty(idx, it.qty - (it.type === "bulk" ? 50 : 1))}><Minus size={12} /></button>
              <input
                type="number"
                value={it.qty}
                onChange={(e) => setQty(idx, Number(e.target.value) || 0)}
                style={{ width: 60, textAlign: "center", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "2px 4px" }}
              />
              <button className="qty-btn" style={{ width: 28, height: 28 }} onClick={() => setQty(idx, it.qty + (it.type === "bulk" ? 50 : 1))}><Plus size={12} /></button>
            </div>
            <span>{it.name}{it.type === "bulk" ? " (جم)" : ""}</span>
          </div>
        ))}
        {!items.length && <p className="tiny" style={{ marginBottom: 10 }}>هتتصفر الفاتورة دي بالكامل لو محذوفش كل الأصناف — احذفها من سجل الفواتير بدل كده.</p>}
        <div className="cart-total" style={{ marginTop: 10 }}>
          <span style={{ color: "var(--accent)" }}>{fmt(total)} ج.م</span>
          <span>الإجمالي الجديد</span>
        </div>
        <button className="btn btn-primary" disabled={!items.filter((i) => i.qty > 0).length} onClick={() => onSave(items.filter((i) => i.qty > 0))}>حفظ التعديل</button>
      </div>
    </div>
  );
}
