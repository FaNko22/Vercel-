export async function api(action, options={}) {
  const method = options.method || (options.body === undefined ? 'GET' : 'POST');
  const res = await fetch(`/api/pos?action=${encodeURIComponent(action)}`, {
    method,
    headers: options.body === undefined ? {} : {'Content-Type':'application/json'},
    credentials:'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  let data={}; try { data=await res.json(); } catch {}
  if (!res.ok) { const e=new Error(data.error || 'حصل خطأ'); e.status=res.status; throw e; }
  return data;
}
