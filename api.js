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

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: "include"
    });
  } catch (networkErr) {
    // Serveur injoignable / endormi / pas de connexion
    const e = new Error("Serveur injoignable");
    e.isNetwork = true;
    throw e;
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const e = new Error(data.message || `API error ${res.status}`);
    e.status = res.status;   // on garde le code (401, 500, 503...)
    throw e;
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
    // On déconnecte UNIQUEMENT si le token est vraiment rejeté (401).
    if (error.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      sessionStorage.clear();
      window.location.href = "login.html";
      return false;
    }
    // Sinon (serveur endormi, réseau, erreur 500/503) → on reste connecté
    return true;
  }
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  sessionStorage.clear();

  window.location.href = "login.html";
}