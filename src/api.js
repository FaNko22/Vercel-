export async function api(action, options={}) {
  const method = options.method || (options.body === undefined ? 'GET' : 'POST');
  const [actionName, query] = String(action).split('?', 2);
  const url = `/api/pos?action=${encodeURIComponent(actionName)}${query ? `&${query}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: options.body === undefined ? {} : {'Content-Type':'application/json'},
    credentials:'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  let data={}; try { data=await res.json(); } catch {}
  if (!res.ok) { const e=new Error(data.error || 'حصل خطأ'); e.status=res.status; throw e; }
  return data;
}
