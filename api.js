const API_BASE =  'https://api.yovatrans.fr/api';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('token');
console.log("TOKEN SENT =", token);
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include'
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error('API ERROR:', res.status, path, data);
    throw new Error(data.message || `API error ${res.status}`);
  }

  return data;
}
async function requireAuth() {
  const token = localStorage.getItem('token');

  if (!token) {
    window.location.href = 'login.html';
    return false;
  }

  try {
    await apiFetch('/auth/me');
    return true;
  } catch (error) {
    console.error("AUTH FAILED", error);
    localStorage.removeItem('token');
    window.location.href = 'login.html';
    return false;
  }
}