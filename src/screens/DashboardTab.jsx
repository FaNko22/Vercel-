import { useMemo } from 'react';
import { Activity, AlertTriangle, BarChart3, Clock3, Package, ReceiptText, TrendingUp, WalletCards } from 'lucide-react';
import { fmt, fmtDateTime, todayKey } from '../lib';

export function DashboardTab({ isOwner=false, user, branchName, branchId, branches, sales, products, stock, activeShift, reportsData, onGo }) {
  const today = todayKey(Date.now());
  const branchSales = useMemo(() => branchId === 'all' ? sales.filter((sale) => sale.status !== 'voided') : sales.filter((sale) => sale.branch_id === branchId && sale.status !== 'voided'), [sales, branchId]);
  const todaySales = useMemo(() => branchSales.filter((sale) => todayKey(sale.ts || sale.created_at) === today), [branchSales, today]);
  const branchStock = useMemo(() => { const rows = branchId === 'all' ? stock : stock.filter((row) => row.branch_id === branchId); const m = {}; for (const row of rows) m[row.product_id] = (m[row.product_id] || 0) + Number(row.qty); return m; }, [stock, branchId]);
  const lowStock = useMemo(() => products.filter((p) => p.active !== false && p.track_stock && (branchStock[p.id] || 0) <= Number(p.reorder_point || 0)), [products, branchStock]);
  const topProducts = useMemo(() => {
    const agg = {};
    for (const sale of branchSales) for (const item of sale.items || []) {
      const key = item.productId || item.product_id || item.name;
      if (!agg[key]) agg[key] = { name: item.name, qty: 0 };
      agg[key].qty += item.type === 'bulk' ? Number(item.qty) / 1000 : Number(item.qty);
    }
    return Object.values(agg).sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [branchSales]);
  const todayRevenue = todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const todayProfit = todaySales.reduce((sum, sale) => sum + Number(sale.profit || 0), 0);
  const todayCount = todaySales.length;
  const roleLabel = user.role === 'owner' ? 'Owner' : user.role === 'manager' ? 'مدير' : `كاشير · ${user.shift_period === 'evening' ? 'مسائي' : 'صباحي'}`;
  const greeting = user.role === 'owner' ? 'لوحة تحكم المالك' : user.role === 'manager' ? 'متابعة الفرع اليوم' : 'جاهز للشيفت؟';
  const selectedSummary = branchId === 'all' ? reportsData.all : (reportsData.perBranch[branchId] || { revenue: 0, profit: 0, count: 0 });
  const recent = [...branchSales].sort((a, b) => Date.parse(b.ts || b.created_at) - Date.parse(a.ts || a.created_at)).slice(0, 5);

  return <div className="dashboard">
    <section className="dashboard-hero">
      <div>
        <span className="eyebrow">مساحة التشغيل · {roleLabel}</span>
        <h1 className="page-title">{greeting}</h1>
        <p className="page-subtitle">أهلاً {user.name} — كل أرقام الشاشة دي معروضة من بيانات النظام الحالية، من غير إضافة أي بيانات جديدة.</p>
      </div>
      <div className={`shift-status ${activeShift ? 'open' : 'closed'}`}>
        <span className="status-dot" />
        <div><strong>{activeShift ? 'الشيفت مفتوح' : 'لا يوجد شيفت مفتوح'}</strong><small>{branchName || 'الفرع الحالي'}{activeShift ? ` · ${activeShift.shift_period === 'evening' ? 'مسائي' : 'صباحي'}` : ''}</small></div>
      </div>
    </section>

    <div className="grid-stats dashboard-stats">
      <Metric icon={WalletCards} label="مبيعات اليوم" value={`${fmt(todayRevenue)} ج.م`} hint={`${todayCount} فاتورة`} />
      {isOwner && <Metric icon={TrendingUp} label="ربح اليوم" value={`${fmt(todayProfit)} ج.م`} hint="بعد التكلفة" />}
      <Metric icon={ReceiptText} label="فواتير اليوم" value={fmt(todayCount)} hint="غير الملغاة" />
      <Metric icon={Package} label="مخزون يحتاج متابعة" value={fmt(lowStock.length)} hint="حسب حد إعادة الطلب" tone={lowStock.length ? 'warn' : 'good'} />
    </div>

    <div className="dashboard-grid">
      <section className="card dashboard-card">
        <div className="card-title"><div><h2>ملخص الفرع</h2><p>{branchName || 'الفرع الحالي'} · إجمالي السجلات المتاحة</p></div><BarChart3 size={18} /></div>
        <div className="mini-metrics"><MiniMetric label="الإيراد" value={`${fmt(selectedSummary.revenue)} ج.م`} />{isOwner && <MiniMetric label="الربح" value={`${fmt(selectedSummary.profit)} ج.م`} />}<MiniMetric label="الفواتير" value={fmt(selectedSummary.count)} /></div>
        <button className="button button-secondary button-wide" onClick={() => onGo('reports')}>فتح التقارير</button>
      </section>

      <section className="card dashboard-card">
        <div className="card-title"><div><h2>حالة الشيفت</h2><p>المتابعة السريعة</p></div><Clock3 size={18} /></div>
        {branchId === 'all' ? <div className="dashboard-empty"><BarChart3 size={18} /><span>أنت بتراجع كل الفروع. اختار فرع من الأعلى لفتح الشيفت أو البيع.</span></div> : activeShift ? <div className="dashboard-list"><Row label="الحالة" value="مفتوح" good /><Row label="البداية" value={fmtDateTime(Date.parse(activeShift.opened_at))} /><Row label="النقدية الافتتاحية" value={`${fmt(activeShift.opening_cash)} ج.م`} /></div> : <div className="dashboard-empty"><Activity size={18} /><span>مفيش شيفت مفتوح حاليًا.</span></div>}
        <button className="button button-primary button-wide" onClick={() => onGo('sell')}>{activeShift ? 'الذهاب للكاشير' : 'فتح شاشة الشيفت'}</button>
      </section>

      <section className="card dashboard-card">
        <div className="card-title"><div><h2>الأكثر حركة</h2><p>من مبيعات الفرع الحالية</p></div><TrendingUp size={18} /></div>
        {topProducts.length ? <div className="rank-list">{topProducts.map((item, index) => <div className="rank-row" key={`${item.name}-${index}`}><b>{index + 1}</b><span>{item.name}</span><strong>{fmt(item.qty)}</strong></div>)}</div> : <div className="dashboard-empty"><Package size={18} /><span>لسه مفيش مبيعات لعرضها.</span></div>}
      </section>

      <section className="card dashboard-card">
        <div className="card-title"><div><h2>تنبيهات المخزون</h2><p>حسب الفرع المحدد</p></div><AlertTriangle size={18} /></div>
        {lowStock.length ? <div className="rank-list">{lowStock.slice(0, 5).map((product) => <div className="rank-row" key={product.id}><span>{product.name}</span><strong className="danger-text">{fmt(branchStock[product.id] || 0)}</strong></div>)}</div> : <div className="dashboard-empty"><Package size={18} /><span>المخزون تمام، مفيش تنبيهات حاليًا.</span></div>}
        {lowStock.length > 5 && <button className="text-link" onClick={() => onGo('inventory')}>عرض كل التنبيهات</button>}
      </section>

      <section className="card dashboard-card dashboard-recent">
        <div className="card-title"><div><h2>آخر العمليات</h2><p>آخر 5 فواتير في الفرع</p></div><ReceiptText size={18} /></div>
        {recent.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>الفاتورة</th><th>الكاشير</th><th>الوقت</th><th>الإجمالي</th></tr></thead><tbody>{recent.map((sale) => <tr key={sale.id}><td>{String(sale.id).slice(0, 8)}</td><td>{sale.cashier_name || '—'}</td><td>{fmtDateTime(Date.parse(sale.ts || sale.created_at))}</td><td>{fmt(sale.total)} ج.م</td></tr>)}</tbody></table></div> : <div className="dashboard-empty"><ReceiptText size={18} /><span>مفيش عمليات لعرضها.</span></div>}
      </section>
    </div>
  </div>;
}

function Metric({ icon: Icon, label, value, hint, tone }) {
  return <div className={`stat dashboard-stat ${tone || ''}`}><div className="stat-icon"><Icon size={17} /></div><div className="stat-copy"><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><small className="stat-sub">{hint}</small></div></div>;
}
function MiniMetric({ label, value }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Row({ label, value, good }) { return <div className="dashboard-row"><span>{label}</span><strong className={good ? 'good-text' : ''}>{value}</strong></div>; }
