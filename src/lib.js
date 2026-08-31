export const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const todayKey = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
export const fmt = (n) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
export const fmtDateTime = (ts) => new Date(ts).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });

export const ROAST = ["#E8D3AE", "#D8B27E", "#B4813F", "#8A5A2B", "#5C3A1E", "#3C2A21"];
export function roastColor(ratio) {
  const idx = Math.min(ROAST.length - 1, Math.max(0, Math.round((1 - ratio) * (ROAST.length - 1))));
  return ROAST[idx];
}

export const TYPE_LABEL = { bulk: "بن سايب بالوزن", packaged: "علبة بوزن ثابت", piece: "قطعة" };
export const PERMISSION_LIST = [
  { key: "sell", label: "البيع (الكاشير)" },
  { key: "inventory", label: "المخزون (عرض وإضافة كمية)" },
  { key: "reports", label: "التقارير والأرباح" },
  { key: "manageProducts", label: "إدارة المنتجات" },
];

export const lineTotal = (i) => (i.type === "bulk" ? (i.qty / 1000) * i.sellPrice : i.qty * i.sellPrice);
export const lineCost = (i) => (i.type === "bulk" ? (i.qty / 1000) * i.costPrice : i.qty * i.costPrice);

export function downloadCSV(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch { /* audio not available, ignore */ }
}
