async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: any }>('/api/auth/me'),
  login: (username: string, password: string) =>
    request<{ user: any }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  meta: () => request<any>('/api/meta'),
  overview: (yearMonth: string) => request<any>(`/api/overview?yearMonth=${encodeURIComponent(yearMonth)}`),
  roster: (yearMonth: string, departmentSubId: number) =>
    request<any>(`/api/roster?yearMonth=${encodeURIComponent(yearMonth)}&departmentSubId=${departmentSubId}`),
  saveCell: (payload: any) =>
    request<{ ok: boolean }>('/api/roster/cell', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  autoGenerate: (payload: any) =>
    request<{ ok: boolean; generatedCount: number }>('/api/roster/auto-generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  copyPrevious: (payload: any) =>
    request<{ ok: boolean; copied: number; skippedConflicts: number }>('/api/roster/copy-previous', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  clearRoster: (yearMonth: string, departmentSubId: number) =>
    request<{ ok: boolean }>('/api/roster/batch', {
      method: 'POST',
      body: JSON.stringify({ yearMonth, departmentSubId, items: [], mode: 'clear_all' }),
    }),
  changeStatus: (payload: any) =>
    request<{ ok: boolean; status: string; statusLabel: string }>('/api/roster/status', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  saveAllowance: (payload: any) =>
    request<{ ok: boolean }>('/api/compensation/adjustment', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  swaps: (yearMonth: string, departmentSubId?: number) => {
    const q = new URLSearchParams({ yearMonth });
    if (departmentSubId) q.set('departmentSubId', String(departmentSubId));
    return request<{ swaps: any[] }>(`/api/swaps?${q.toString()}`);
  },
  createSwap: (payload: any) =>
    request<{ ok: boolean; id: number }>('/api/swaps', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  reviewSwap: (id: number, decision: 'approved' | 'rejected', review_note = '') =>
    request<{ ok: boolean }>(`/api/swaps/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, review_note }),
    }),
  staff: (params: { yearMonth: string; departmentSubId?: number; q?: string; includeInactive?: boolean }) => {
    const qs = new URLSearchParams({ yearMonth: params.yearMonth });
    if (params.departmentSubId) qs.set('departmentSubId', String(params.departmentSubId));
    if (params.q) qs.set('q', params.q);
    if (params.includeInactive) qs.set('includeInactive', 'true');
    return request<any>(`/api/staff?${qs.toString()}`);
  },
  updateRate: (rateKey: string, payload: any) =>
    request<{ ok: boolean }>(`/api/settings/rates/${encodeURIComponent(rateKey)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  upsertHoliday: (payload: { holiday_date: string; title: string; holiday_type: string }) =>
    request<{ ok: boolean }>('/api/settings/holidays', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteHoliday: (date: string) =>
    request<{ ok: boolean }>(`/api/settings/holidays/${encodeURIComponent(date)}`, {
      method: 'DELETE',
    }),
  auditLogs: (limit = 60) => request<{ logs: any[] }>(`/api/audit-logs?limit=${limit}`),
};
