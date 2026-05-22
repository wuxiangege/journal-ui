const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function authHeaders() {
  const token = sessionStorage.getItem('journal-token')
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function request(path, options = {}) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...authHeaders(), ...options.headers },
    })
  } catch {
    throw new ApiError(
      0,
      API_BASE
        ? `无法连接后端（${API_BASE}），请确认 journal-service 已启动`
        : '无法连接后端，请确认 journal-service 已在 6666 端口启动',
    )
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(res.status, data.message || res.statusText || '请求失败')
  }
  return data
}

export function login(username, password) {
  return request('/api/v1/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function listJournalPosts(params = {}) {
  const q = new URLSearchParams()
  if (params.q) q.set('q', params.q)
  if (params.tag) q.set('tag', params.tag)
  if (params.mood && params.mood !== 'all') q.set('mood', params.mood)
  if (params.dateFilter && params.dateFilter !== 'all') q.set('dateFilter', params.dateFilter)
  q.set('page', String(params.page ?? 1))
  q.set('pageSize', String(params.pageSize ?? 500))
  return request(`/api/v1/journal-posts?${q}`)
}

export function createJournalPost(body) {
  return request('/api/v1/journal-posts', { method: 'POST', body: JSON.stringify(body) })
}

export function updateJournalPost(id, body) {
  return request(`/api/v1/journal-posts/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteJournalPost(id) {
  return request(`/api/v1/journal-posts/${id}`, { method: 'DELETE' })
}

export function getStats() {
  return request('/api/v1/stats')
}
