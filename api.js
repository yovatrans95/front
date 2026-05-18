// api.js

// LOCAL TEST
//const API_BASE = "http://localhost:5000/api";

// PRODUCTION PLUS TARD
// const API_BASE = "https://ton-back-render.onrender.com/api";
 const API_BASE = "https://api.yovatrans.fr/api";

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("token");

  const headers = {
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include"
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || `API error ${res.status}`);
  }

  return data;
}

async function requireAuth() {
  const token = localStorage.getItem("token");

  if (!token) {
    window.location.href = "login.html";
    return false;
  }

  try {
    await apiFetch("/auth/me");
    return true;
  } catch (error) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.clear();

    window.location.href = "login.html";
    return false;
  }
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  sessionStorage.clear();

  window.location.href = "login.html";
}