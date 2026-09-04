import { useState, useMemo } from "react";
import { X, Plus, Minus, Trash2, Check, Search } from "lucide-react";
import { fmt, TYPE_LABEL } from "../lib";
import { EmptyState } from "../components/Nav";
import { ShiftBar } from "../components/ShiftBar";

export function SellTab({ canSell=true, products, branchStock, cart, addToCart, removeFromCart, cartTotal, checkout, lineTotal, activeShift, branchName, onOpenShift, onCloseShift, shiftPeriod, canChooseShiftPeriod=false, canOpen=true, canClose=true }) {
  const [picker, setPicker] = useState(null);
  const [query, setQuery] = useState("");
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");

  const doCheckout = async () => {
    await checkout({ name: custName.trim(), phone: custPhone.trim(), paymentMethod });
    setCustName("");
    setCustPhone("");
    setPaymentMethod("cash");
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, query]);

  if (!products.length) return <div>
    <ShiftBar activeShift={activeShift} branchName={branchName} onOpen={onOpenShift} onClose={onCloseShift} shiftPeriod={shiftPeriod} canChooseShiftPeriod={canChooseShiftPeriod} canOpen={canOpen} canClose={canClose} />
    <EmptyState text='لسه مفيش منتجات. الـ Owner يقدر يضيفها من الإدارة.' />
  </div>;

  return (
    <div>
      <ShiftBar activeShift={activeShift} branchName={branchName} onOpen={onOpenShift} onClose={onCloseShift} shiftPeriod={shiftPeriod} canChooseShiftPeriod={canChooseShiftPeriod} canOpen={canOpen} canClose={canClose} />
      {!canSell && <div className="card card-pad" style={{ marginBottom: 16 }}><strong style={{ fontSize: 13 }}>وضع المراجعة</strong><p className="page-subtitle" style={{ marginTop: 4 }}>صلاحية المدير تسمح بمتابعة التشغيل وإقفال الشيفت، بينما تسجيل البيع مخصص للكاشير.</p></div>}
      <div className="pos-layout">
        <section className="pos-products">
          <div className="section-head"><div><span className="eyebrow">نقطة البيع</span><h1 className="page-title">المنتجات</h1><p className="page-subtitle">{products.length} منتج متاح في {branchName || 'الفرع'}</p></div><div className="search-wrap" style={{ width: 'min(100%, 240px)' }}><Search size={16}/><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم المنتج" /></div></div>
        {!products.length ? <EmptyState text="لسه مفيش منتجات. الـ Owner يقدر يضيفها من الإدارة." /> : !filtered.length ? <EmptyState text="مفيش منتج بالاسم ده." /> : canSell ? <div className="product-grid">{filtered.map((p) => {
          const qty = branchStock[p.id] || 0; const outOfStock = p.track_stock && qty <= 0;
          return <button key={p.id} disabled={outOfStock} onClick={() => setPicker(p)} className="product-tile">
            <div className="product-tile-top"><span className="pill">{TYPE_LABEL[p.type]}</span>{p.track_stock && <span className="tiny">{fmt(qty)} {p.type === 'bulk' ? 'جم' : 'قطعة'}</span>}</div>
            <strong>{p.name}{p.package_weight ? ` (${p.package_weight}جم)` : ''}</strong><div className="product-price">{fmt(p.sell_price)} ج.م {p.type === 'bulk' ? '/ كجم' : ''}</div>
            {outOfStock && <span className="pill pill-danger" style={{ display: 'inline-block', marginTop: 9 }}>نفد المخزون</span>}
          </button>;
        })}</div> : null}
        {canSell && picker && <QuantityModal product={picker} available={branchStock[picker.id] || 0} onClose={() => setPicker(null)} onConfirm={(qty) => { addToCart(picker, qty); setPicker(null); }} />}
        </section>

        <aside className="card cart-panel">
          <div className="card-title"><div><h2>الفاتورة الحالية</h2><p>{cart.length ? `${cart.length} أصناف` : 'أضف منتجًا للبدء'}</p></div><Check size={18} color="var(--accent)"/></div>
          {!cart.length ? <EmptyState text="اضغط على أي منتج لإضافته للفاتورة." /> : <>
            <div className="cart-items">{cart.map((i) => <div key={i.productId} className="cart-line"><div><strong>{i.name}</strong><span>{i.type === 'bulk' ? `${fmt(i.qty)} جم` : `${i.qty} قطعة`} · {fmt(lineTotal(i))} ج.م</span></div><div className="qty-control"><button onClick={() => addToCart(i, i.type === 'bulk' ? -50 : -1)}><Minus size={12}/></button><b>{i.type === 'bulk' ? fmt(i.qty) : i.qty}</b><button onClick={() => addToCart(i, i.type === 'bulk' ? 50 : 1)}><Plus size={12}/></button></div><button className="icon-button" onClick={() => removeFromCart(i.productId)}><Trash2 size={14}/></button></div>)}</div>
            <div className="total-line"><span>الإجمالي</span><strong>{fmt(cartTotal)} ج.م</strong></div>
            <div className="payment-grid"><button className={`payment-option ${paymentMethod === 'cash' ? 'active' : ''}`} onClick={() => setPaymentMethod('cash')}>نقدي</button><button className={`payment-option ${paymentMethod === 'vodafone_cash' ? 'active' : ''}`} onClick={() => setPaymentMethod('vodafone_cash')}>فودافون كاش</button></div>
            <div style={{ marginTop: 13 }}><label className="tiny" style={{display:'block',marginBottom:5}}>بيانات العميل <span style={{opacity:.7}}>اختياري</span></label><input className="input" value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="اسم العميل"/><input className="input" style={{ marginTop: 7 }} value={custPhone} onChange={(e) => setCustPhone(e.target.value)} placeholder="رقم الموبايل" inputMode="tel"/></div>
            <button className="button button-primary button-wide" onClick={doCheckout}><Check size={16}/> إتمام البيع وطباعة الفاتورة</button>
          </>}
        </aside>
      </div>
    </div>
  );
}

function QuantityModal({ product, available, onClose, onConfirm }) {
  const isWeight = product.type === "bulk";
  const [val, setVal] = useState(isWeight ? 250 : 1);
  const quick = isWeight ? [100, 250, 500, 1000] : [1, 2, 3];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
          <h3>{product.name}{product.package_weight ? ` (${product.package_weight}جم)` : ""}</h3>
        </div>
        <div className="qty-row">
          <button className="qty-btn" onClick={() => setVal((v) => Math.max(0, v - (isWeight ? 50 : 1)))}><Minus size={18} /></button>
          <div style={{ textAlign: "center" }}>
            <input
              type="number"
              value={val}
              onChange={(e) => setVal(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: 120, textAlign: "center", fontSize: 30, fontWeight: 900, background: "transparent", border: "none", color: "var(--text)", outline: "none" }}
            />
            <p className="tiny">{isWeight ? "جرام" : "قطعة"}</p>
          </div>
          <button className="qty-btn" onClick={() => setVal((v) => v + (isWeight ? 50 : 1))}><Plus size={18} /></button>
        </div>
        <div className="quick-row">
          {quick.map((q) => <button key={q} className="btn-secondary" onClick={() => setVal(q)}>{q}{isWeight ? "جم" : ""}</button>)}
        </div>
        {product.track_stock && <p className="tiny" style={{ textAlign: "center", marginBottom: 12 }}>المتاح بالفرع: {fmt(available)} {isWeight ? "جم" : "قطعة"}</p>}
        <p style={{ textAlign: "center", fontWeight: 700, color: "var(--accent)", marginBottom: 16 }}>
          الإجمالي: {fmt(isWeight ? (val / 1000) * product.sell_price : val * product.sell_price)} ج.م
        </p>
        <button className="btn btn-primary" disabled={val <= 0} onClick={() => onConfirm(val)}>إضافة للفاتورة</button>
      </div>
    </div>
  );
}
