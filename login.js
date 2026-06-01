document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    await apiFetch('/auth/me');
    window.location.replace('drivers.html');
  } catch (error) {
    // On efface le token seulement si vraiment invalide (401)
    if (error.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      sessionStorage.clear();
    }
    // sinon on reste sur le login sans rien casser
  }
});

async function tryLogin() {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;

  if (!user || !pass) {
    showError('Veuillez remplir tous les champs.');
    return;
  }

  const btn = document.getElementById('btnLogin');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: user,
        password: pass
      })
    });

    console.log('LOGIN RESPONSE =', data);

    if (!data.token) {
      throw new Error('Aucun token reçu du serveur');
    }

    localStorage.setItem('token', data.token);

    if (data.user) {
      localStorage.setItem('user', JSON.stringify(data.user));
    }

    window.location.replace('drivers.html');
  } catch (error) {
    console.error('LOGIN ERROR =', error);
    showError(error.message);

    document.getElementById('loginUser').classList.add('error');
    document.getElementById('loginPass').classList.add('error');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}