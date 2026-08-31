import { useEffect, useRef } from "react";
import { Printer } from "lucide-react";
import { fmt, fmtDateTime } from "../lib";

export function ReceiptModal({ sale, onClose, autoPrint }) {
  const printed = useRef(false);
  useEffect(() => {
    if (autoPrint && !printed.current) {
      printed.current = true;
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [autoPrint]);

  return (
    <div className="modal-overlay">
      <div className="modal receipt-modal">
        <div id="receipt-print">
          <p className="r-title">بن الشريب</p>
          <p className="r-sub">{sale.branch_name}</p>
          <p className="r-meta">{fmtDateTime(sale.ts)} · {sale.cashier_name} · {sale.payment_method === "vodafone_cash" ? "فودافون كاش" : "نقدي"}</p>
          {(sale.customer_name || sale.customer_phone) && (
            <p className="r-meta">العميل: {sale.customer_name || "—"}{sale.customer_phone ? ` · ${sale.customer_phone}` : ""}</p>
          )}
          <div className="dashed" />
          <div className="r-items">
            {sale.items.map((it, i) => (
              <div key={i} className="r-row">
                <span>{it.name}{it.packageWeight ? ` (${it.packageWeight}جم)` : ""} × {it.type === "bulk" ? `${fmt(it.qty)}جم` : it.qty}</span>
                <span>{fmt(it.lineRevenue)}</span>
              </div>
            ))}
          </div>
          <div className="dashed" />
          <div className="r-row r-total">
            <span>الإجمالي</span>
            <span>{fmt(sale.total)} ج.م</span>
          </div>
          <p className="r-thanks">شكرًا لزيارتكم</p>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn" style={{ flex: 1, background: "#e5e5e5", color: "#1C1410" }} onClick={onClose}>قفل</button>
          <button className="btn btn-primary" style={{ flex: 1, marginTop: 0 }} onClick={() => window.print()}><Printer size={16} /> طباعة</button>
        </div>
        <p style={{ fontSize: 11, color: "var(--dim)", marginTop: 8, textAlign: "center" }}>
          لو ظهر تاريخ أو لينك في الطباعة: دوس "More settings" في نافذة الطباعة واقفل "Headers and footers"
        </p>
      </div>
    </div>
  );
}
