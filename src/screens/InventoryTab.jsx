import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { fmt, roastColor } from "../lib";
import { EmptyState } from "../components/Nav";

export function InventoryTab({ products, branchStock, restock, lowStock, canRestock=false }) {
  const [addingId, setAddingId] = useState(null);
  const [addQty, setAddQty] = useState("");
  const tracked = products.filter((p) => p.track_stock);
  const untracked = products.filter((p) => !p.track_stock);
  if (!products.length) return <EmptyState text="لسه مفيش منتجات مسجلة." />;

  return (
    <div>
      {lowStock.length > 0 && (
        <div style={{ background: "#3A241C", border: "1px solid #C94F3E66", borderRadius: 14, padding: 12, marginBottom: 16 }}>
          <p style={{ display: "flex", alignItems: "center", gap: 8, color: "#E8A98A", fontWeight: 700, fontSize: 14, marginBottom: 4 }}><AlertTriangle size={16} /> الكمية قربت تخلص</p>
          <p className="tiny" style={{ color: "var(--accent2)" }}>{lowStock.map((p) => p.name).join("، ")}</p>
        </div>
      )}
      {tracked.map((p) => {
        const qty = branchStock[p.id] || 0;
        const ref = Math.max((p.reorder_point || 0) * 3, qty, 1);
        const ratio = Math.min(1, qty / ref);
        return (
          <div key={p.id} className="branch-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              {canRestock ? <button className="btn-secondary" onClick={() => setAddingId(addingId === p.id ? null : p.id)}>+ إضافة كمية</button> : <span className="tiny">عرض فقط</span>}
              <div style={{ textAlign: "right" }}>
                <p style={{ fontWeight: 700 }}>{p.name}{p.package_weight ? ` (${p.package_weight}جم)` : ""}</p>
                <p className="tiny">{fmt(qty)} {p.type === "bulk" ? "جم" : "قطعة"} متاحة</p>
              </div>
            </div>
            <div className="roast-bar"><div className="roast-bar-fill" style={{ width: `${ratio * 100}%`, background: roastColor(ratio) }} /></div>
            {canRestock && addingId === p.id && (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input className="text-input" style={{ flex: 1 }} type="number" value={addQty} onChange={(e) => setAddQty(e.target.value)} placeholder={p.type === "bulk" ? "الكمية بالجرام" : "العدد"} />
                <button className="btn-secondary" style={{ background: "var(--accent)", color: "var(--bg)", fontWeight: 700 }} onClick={() => { const n = Number(addQty); if (n) { restock(p.id, n); setAddQty(""); setAddingId(null); } }}>تأكيد</button>
              </div>
            )}
          </div>
        );
      })}
      {untracked.length > 0 && (
        <div>
          <p className="tiny" style={{ marginBottom: 8 }}>منتجات من غير تتبع مخزون:</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {untracked.map((p) => <span key={p.id} className="pill" style={{ padding: "4px 10px" }}>{p.name}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
