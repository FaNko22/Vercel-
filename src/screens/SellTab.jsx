import { useState, useMemo } from "react";
import { X, Plus, Minus, Trash2, Check, Search } from "lucide-react";
import { fmt, TYPE_LABEL } from "../lib";
import { EmptyState } from "../components/Nav";
import { ShiftBar } from "../components/ShiftBar";

export function SellTab({ canSell=true, products, branchStock, cart, addToCart, removeFromCart, cartTotal, checkout, lineTotal, activeShift, branchName, onOpenShift, onCloseShift, canOpen=true, canClose=true }) {
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

  if (!products.length) return <EmptyState text='لسه مفيش منتجات. المدير يقدر يضيفها من الإعدادات.' />;

  return (
    <div>
      <ShiftBar activeShift={activeShift} branchName={branchName} onOpen={onOpenShift} onClose={onCloseShift} canOpen={canOpen} canClose={canClose} />

      <div style={{ position: "relative", marginBottom: 12 }}>
        <Search size={16} style={{ position: "absolute", right: 12, top: 12, color: "var(--dim)" }} />
        <input
          className="text-input"
          style={{ width: "100%", paddingRight: 36 }}
          placeholder="دور على منتج بالاسم..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!canSell && <div className="branch-row" style={{marginBottom:12}}><div style={{textAlign:'right'}}><p style={{fontWeight:700}}>وضع المدير</p><p className="tiny">المدير لا يبيع ولا يعدّل. دوره مراجعة الشيفت وإقفاله والمالية اليومية.</p></div></div>}
      {canSell && !filtered.length && <EmptyState text="مفيش منتج بالاسم ده." />}

      {canSell && <div className="grid-2">
        {filtered.map((p) => {
          const qty = branchStock[p.id] || 0;
          const outOfStock = p.track_stock && qty <= 0;
          return (
            <button key={p.id} disabled={outOfStock} onClick={() => setPicker(p)} className={`product-card ${outOfStock ? "disabled" : ""}`}>
              <div className="product-card-top">
                <span className="pill">{TYPE_LABEL[p.type]}</span>
                {p.track_stock && <span className="tiny">{p.type === "bulk" ? `${fmt(qty)} جم` : `${fmt(qty)} قطعة`}</span>}
              </div>
              <p className="product-name">{p.name}{p.package_weight ? ` (${p.package_weight}جم)` : ""}</p>
              <p className="product-price">{fmt(p.sell_price)} ج.م {p.type === "bulk" ? "/ كجم" : ""}</p>
              {outOfStock && <p className="tiny-bad">خلصت الكمية</p>}
            </button>
          );
        })}
      </div>}

      {canSell && picker && <QuantityModal product={picker} available={branchStock[picker.id] || 0} onClose={() => setPicker(null)} onConfirm={(qty) => { addToCart(picker, qty); setPicker(null); }} />}

      {canSell && cart.length > 0 && (
        <div className="cart">
          <p className="cart-title">الفاتورة الحالية</p>
          {cart.map((i) => (
            <div key={i.productId} className="cart-row">
              <button style={{ color: "var(--bad)" }} onClick={() => removeFromCart(i.productId)}><Trash2 size={14} /></button>
              <span className="tiny">{fmt(lineTotal(i))} ج.م</span>
              <span>{i.name} × {i.type === "bulk" ? `${fmt(i.qty)}جم` : i.qty}</span>
            </div>
          ))}
          <div className="cart-total"><span style={{ color: "var(--accent)" }}>{fmt(cartTotal)} ج.م</span><span>الإجمالي</span></div>
          <div className="tabs-2" style={{ marginTop: 8 }}>
            <button className={paymentMethod === "cash" ? "tab-active" : "tab-inactive"} onClick={() => setPaymentMethod("cash")}>نقدي</button>
            <button className={paymentMethod === "vodafone_cash" ? "tab-active" : "tab-inactive"} onClick={() => setPaymentMethod("vodafone_cash")}>فودافون كاش</button>
          </div>
          <input className="text-input" style={{ width: "100%", marginTop: 8 }} placeholder="اسم العميل (اختياري)" value={custName} onChange={(e) => setCustName(e.target.value)} />
          <input className="text-input" style={{ width: "100%", marginTop: 8 }} placeholder="رقم موبايل العميل (اختياري)" inputMode="tel" value={custPhone} onChange={(e) => setCustPhone(e.target.value)} />
          <button className="btn btn-primary" onClick={doCheckout}><Check size={18} /> إتمام البيع وطباعة الفاتورة</button>
        </div>
      )}
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
