import { Coffee, TrendingUp, TrendingDown } from "lucide-react";

export function NavBtn({ icon: Icon, label, active, onClick, badge }) {
  return (
    <button className="nav-btn" onClick={onClick} style={{ color: active ? "var(--accent)" : "var(--dim)" }}>
      <Icon size={20} />
      <span>{label}</span>
      {!!badge && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

export function Stat({ label, value, sub, tone }) {
  const color = tone === "up" ? "var(--good)" : tone === "down" ? "var(--bad)" : "var(--text)";
  const Icon = tone === "up" ? TrendingUp : tone === "down" ? TrendingDown : null;
  return (
    <div className="stat">
      <p className="stat-value" style={{ color }}>{Icon && <Icon size={14} />}{value}</p>
      <p className="stat-sub">{sub}</p>
      <p className="stat-label">{label}</p>
    </div>
  );
}

export function EmptyState({ text }) {
  return (
    <div className="empty">
      <Coffee size={32} style={{ margin: "0 auto 8px", opacity: 0.5, display: "block" }} />
      <p style={{ fontSize: 14 }}>{text}</p>
    </div>
  );
}
