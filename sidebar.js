(function () {
  const currentScript = document.currentScript;
  const activePage = currentScript?.dataset?.page || '';

  const SIDEBAR_HTML = `
<aside class="sidebar">
  <div class="sb-top">
    <div class="logo">
      <div class="logo-icon">🚌</div>
      <div>
        <div class="logo-name">Yovatrans</div>
        <div class="logo-sub">Plateforme chauffeurs</div>
      </div>
    </div>
  </div>

  <nav class="nav">
    <div class="nav-section">Navigation</div>

    <a class="nav-item" href="drivers.html" data-page="drivers">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      Chauffeurs
    </a>

    <a class="nav-item" href="#" data-page="dashboard">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"/>
        <rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/>
      </svg>
      Tableau de bord
    </a>

    <a class="nav-item" href="vehicules.html" data-page="vehicles">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="1" y="3" width="15" height="13" rx="1"/>
        <path d="M16 8h6l2 4v4h-8V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/>
        <circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
      Véhicules
    </a>



    <a class="nav-item" href="liste.html" data-page="tasks">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
      Tâches
    </a>

    <a class="nav-item" href="tracking.html" data-page="tracking">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
      Carte flotte
    </a>

    <div class="nav-section">Système</div>

    <a class="nav-item" href="#" data-page="settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15.4 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.3.2.65.6.6 1h.1a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/>
      </svg>
      Paramètres
    </a>
<a class="nav-item logout-btn" href="#"  id="logoutBtn">

  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>

  Déconnexion
</a>
    
  </nav>

  <div class="sb-footer">
    Yovatrans © 2026
  </div>
</aside>
`;

  const mount = document.getElementById('sidebar-mount');

  if (mount) {
    mount.innerHTML = SIDEBAR_HTML;
  } else {
    document.body.insertAdjacentHTML('afterbegin', SIDEBAR_HTML);
  }

  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    if (item.dataset.page === activePage) {
      item.classList.add('active');
    }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    logout();
  });
})();
