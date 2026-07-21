/**
 * itineraire.js — Widget "Itinéraire A → B" de la Carte flotte.
 *
 * Tuile du tableau de bord (comme "Tours à la volée") greffée sur la carte
 * Leaflet globale `map` de tracking.js. Sources gratuites sans clé API :
 *  - BAN (api-adresse.data.gouv.fr)        : adresses France
 *  - Photon (photon.komoot.io)             : lieux / sites / enseignes OSM
 *  - Nominatim (nominatim.openstreetmap.org): complément noms d'entreprises/sites
 *  - OSRM (router.project-osrm.org)        : calcul d'itinéraire + alternatives
 *
 * Fonctions :
 *  - recherche avancée avec filtre (tout / adresses / lieux & sites)
 *  - points A/B + étapes : autocomplétion, placement au clic sur la carte (🎯),
 *    épingles déplaçables, clic droit carte/camion
 *  - trajets ENREGISTRÉS : persistés en localStorage, couleur modifiable,
 *    afficher/masquer, zoom au clic, suppression
 *
 * Expose : window.getItineraryContextItems(lat,lng) et window.itineraire.
 */
(function () {
  'use strict';

  const BAN_SEARCH  = 'https://api-adresse.data.gouv.fr/search/';
  const BAN_REVERSE = 'https://api-adresse.data.gouv.fr/reverse/';
  const PHOTON_URL  = 'https://photon.komoot.io/api/';
  const NOMINATIM   = 'https://nominatim.openstreetmap.org/search';
  const OSRM_URL    = 'https://router.project-osrm.org/route/v1/driving/';

  const ROUTES_KEY  = 'fleetSavedRoutes'; // trajets enregistrés (localStorage)
  const PALETTE     = ['#e11d48', '#f59e0b', '#10b981', '#8b5cf6', '#0ea5e9', '#f97316', '#3a5ce4'];

  // ── État ──────────────────────────────────────────────────────────────────
  let placeMarker   = null;   // épingle ★ du lieu recherché
  let routeLayers   = [];     // polylignes du trajet en cours d'édition
  let wpMarkers     = [];     // épingles A / étapes / B
  let currentRoutes = [];     // alternatives OSRM du trajet en cours
  let selectedRoute = 0;
  let routeAborter  = null;
  let placingIdx    = null;   // index du point en attente d'un clic carte (🎯)

  let savedRoutes   = [];     // [{id, name, color, distance, duration, coords, visible}]
  const savedLayers = {};     // id -> L.polyline

  function newWaypoint() {
    return { id: 'wp' + Math.random().toString(36).slice(2), lat: null, lng: null, label: '' };
  }
  let waypoints = [newWaypoint(), newWaypoint()];

  const $ = (id) => document.getElementById(id);

  // ── Utilitaires ───────────────────────────────────────────────────────────
  function formatKm(m)  { return (m / 1000).toFixed(m >= 100000 ? 0 : 1).replace('.', ',') + ' km'; }
  function formatDur(s) {
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  }
  function setStatus(text) { const el = $('routeStatus'); if (el) el.textContent = text || ''; }
  function currentFilter() { return $('routeSearchFilter')?.value || 'tout'; }

  // Fait défiler jusqu'au widget (appelé depuis le clic droit carte/camion).
  function revealWidget() {
    document.querySelector('[gs-id="itineraire"]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Recherche avancée (BAN + Photon + Nominatim) ──────────────────────────
  async function searchBAN(q, signal) {
    const c = map.getCenter();
    const url = `${BAN_SEARCH}?q=${encodeURIComponent(q)}&limit=4&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map(f => ({
      label: f.properties.label,
      sub:   f.properties.context || '',
      lat:   f.geometry.coordinates[1],
      lng:   f.geometry.coordinates[0],
      kind:  'adresse',
    }));
  }

  async function searchPhoton(q, signal) {
    const c = map.getCenter();
    const url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=8&lang=fr&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || [])
      .filter(f => (f.properties.countrycode || 'FR') === 'FR')
      .map(f => {
        const p = f.properties;
        const label = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || '—';
        const sub = [p.street && p.name ? p.street : '', p.postcode, p.city].filter(Boolean).join(' ');
        return { label, sub, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], kind: 'lieu' };
      });
  }

  // Nominatim : très bon sur les noms d'entreprises / sites / titres exacts.
  // `near` optionnel : borne la recherche autour d'un point (recherche scopée).
  async function searchNominatim(q, signal, near) {
    let url = `${NOMINATIM}?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=fr&limit=6&accept-language=fr`;
    if (near) {
      const d = 0.18; // ~ 20 km autour de la commune
      url += `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}&bounded=1`;
    }
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).map(r => {
      const parts = String(r.display_name || '').split(',').map(s => s.trim());
      return {
        label: r.name || parts[0] || '—',
        sub:   parts.slice(1, 4).join(', '),
        lat:   Number(r.lat),
        lng:   Number(r.lon),
        kind:  'lieu',
      };
    });
  }

  function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function distKm(lat1, lng1, lat2, lng2) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // "veolia bouqueval" -> { name: "veolia", city: "Bouqueval", lat, lng }.
  // Détection GÉNÉRIQUE : on teste si les 1-2 derniers mots correspondent à une
  // commune (BAN type=municipality). Aucun nom n'est codé en dur.
  async function detectLocality(q, signal) {
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length < 2) return null;
    for (const k of [2, 1]) {
      if (words.length - k < 1) continue;
      const tail = words.slice(-k).join(' ');
      if (tail.length < 3) continue;
      try {
        const res = await fetch(
          `${BAN_SEARCH}?q=${encodeURIComponent(tail)}&type=municipality&limit=1`,
          { signal }
        );
        if (!res.ok) continue;
        const f = (await res.json()).features?.[0];
        if (!f) continue;
        const city = f.properties.city || f.properties.name || '';
        // La commune trouvée doit vraiment correspondre à ce qui est tapé
        // (évite de scoper sur une vague ressemblance).
        if (stripAccents(city).startsWith(stripAccents(tail))) {
          return {
            name: words.slice(0, -k).join(' '),
            city,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          };
        }
      } catch { /* on tente la longueur suivante */ }
    }
    return null;
  }

  // Recherche du nom seul AUTOUR de la commune détectée : Photon biaisé sur le
  // centre de la commune (filtré à 30 km) + Nominatim borné à la zone.
  async function searchScoped(loc, signal) {
    const photonNear = (async () => {
      const url = `${PHOTON_URL}?q=${encodeURIComponent(loc.name)}&limit=8&lang=fr&lat=${loc.lat.toFixed(3)}&lon=${loc.lng.toFixed(3)}`;
      const res = await fetch(url, { signal });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.features || [])
        .filter(f => (f.properties.countrycode || 'FR') === 'FR')
        .map(f => {
          const p = f.properties;
          const label = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || '—';
          const sub = [p.street && p.name ? p.street : '', p.postcode, p.city].filter(Boolean).join(' ');
          return { label, sub, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], kind: 'lieu' };
        })
        // le biais Photon est mou : on ne garde que ce qui est vraiment proche
        .filter(r => distKm(r.lat, r.lng, loc.lat, loc.lng) <= 30);
    })().catch(() => []);

    const nominatimNear = searchNominatim(loc.name, signal, loc).catch(() => []);

    const [p, n] = await Promise.all([photonNear, nominatimNear]);
    // Tri par distance à la commune (le plus proche d'abord) et annotation
    // "près de X" pour que le scope soit visible dans la liste.
    return [...p, ...n]
      .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .sort((a, b) => distKm(a.lat, a.lng, loc.lat, loc.lng) - distKm(b.lat, b.lng, loc.lat, loc.lng))
      .map(r => ({
        ...r,
        sub: r.sub ? `${r.sub} · près de ${loc.city}` : `près de ${loc.city}`,
      }));
  }

  async function searchPlaces(q, signal) {
    const filter = currentFilter();

    // Lancés en parallèle : adresses, lieux en texte libre, détection de commune.
    const [ban, photon, loc] = await Promise.all([
      filter !== 'lieu'    ? searchBAN(q, signal).catch(() => [])    : [],
      filter !== 'adresse' ? searchPhoton(q, signal).catch(() => []) : [],
      filter !== 'adresse' ? detectLocality(q, signal).catch(() => null) : null,
    ]);

    // "nom + commune" détecté -> recherche scopée autour de la commune,
    // affichée EN PREMIER (c'est la lecture la plus probable de la requête).
    let scoped = [];
    let extra = [];
    if (loc && loc.name) {
      scoped = await searchScoped(loc, signal).catch(() => []);
    } else if (filter !== 'adresse' && photon.length < 4) {
      // Pas de commune détectée et moisson maigre : Nominatim en texte libre
      // (bon sur les noms exacts d'entreprises/sites).
      extra = await searchNominatim(q, signal).catch(() => []);
    }

    const seen = new Set();
    const out = [];
    [...scoped, ...ban, ...photon, ...extra].forEach(r => {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return;
      const key = `${stripAccents(r.label)}|${r.lat.toFixed(3)}|${r.lng.toFixed(3)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(r);
    });
    return out.slice(0, 10);
  }

  async function reverseGeocode(lat, lng) {
    try {
      const res = await fetch(`${BAN_REVERSE}?lat=${lat}&lon=${lng}`, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      return data?.features?.[0]?.properties?.label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }

  // ── Autocomplétion ────────────────────────────────────────────────────────
  function attachAutocomplete(input, onPick) {
    let list = null, items = [], focused = -1, debounceTimer = null, aborter = null;

    function close() { list?.remove(); list = null; items = []; focused = -1; }

    function setFocus(i) {
      focused = i;
      list?.querySelectorAll('.ac-item').forEach((el, j) => el.classList.toggle('focused', j === i));
    }

    function render(results) {
      close();
      if (!results.length) return;
      items = results;
      list = document.createElement('div');
      list.className = 'ac-list';
      const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
      results.forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'ac-item';
        el.innerHTML = `
          <span class="ac-icon ${r.kind === 'lieu' ? 'poi' : ''}">${PIN_SVG}</span>
          <span class="ac-main"><span class="ac-label"></span><span class="ac-sub"></span></span>
        `;
        el.querySelector('.ac-label').textContent = r.label;
        el.querySelector('.ac-sub').textContent   = r.sub || (r.kind === 'lieu' ? 'Lieu / site' : 'Adresse');
        el.addEventListener('mousedown', e => {
          e.preventDefault(); // garde le focus (le blur fermerait la liste avant le pick)
          input.value = r.label;
          close();
          onPick(r);
        });
        el.addEventListener('mouseenter', () => setFocus(i));
        list.appendChild(el);
      });
      input.parentElement.appendChild(list);
    }

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      aborter?.abort();
      if (q.length < 3) { close(); return; }
      debounceTimer = setTimeout(async () => {
        aborter = new AbortController();
        try { render(await searchPlaces(q, aborter.signal)); } catch { /* annulée */ }
      }, 300);
    });

    input.addEventListener('keydown', e => {
      if (!list) return;
      if (e.key === 'ArrowDown')      { e.preventDefault(); setFocus(Math.min(focused + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setFocus(Math.max(focused - 1, 0)); }
      else if (e.key === 'Enter' && focused >= 0) {
        e.preventDefault();
        const r = items[focused];
        input.value = r.label;
        close();
        onPick(r);
      }
      else if (e.key === 'Escape') close();
    });

    input.addEventListener('blur', () => setTimeout(close, 150));
  }

  // ── Placement au clic sur la carte (bouton 🎯 d'un point) ─────────────────
  function disarmPlacement() {
    placingIdx = null;
    document.body.classList.remove('placing-point');
    document.querySelectorAll('.wp-target.arming').forEach(b => b.classList.remove('arming'));
    map.off('click', onPlacementClick);
  }

  async function onPlacementClick(e) {
    const idx = placingIdx;
    disarmPlacement();
    if (idx == null || !waypoints[idx]) return;
    const { lat, lng } = e.latlng;
    setStatus('Adresse du point en cours de recherche…');
    const label = await reverseGeocode(lat, lng);
    setWaypointAt(idx, lat, lng, label);
  }

  function armPlacement(idx, btn) {
    if (placingIdx === idx) { disarmPlacement(); return; } // re-clic = annuler
    disarmPlacement();
    placingIdx = idx;
    btn.classList.add('arming');
    document.body.classList.add('placing-point');
    setStatus('Clique sur la carte pour placer ce point (Échap pour annuler).');
    map.once('click', onPlacementClick);
  }

  // ── Points du trajet ──────────────────────────────────────────────────────
  function badgeFor(idx, total) {
    if (idx === 0)         return { cls: 'depart',  txt: 'A' };
    if (idx === total - 1) return { cls: 'arrivee', txt: 'B' };
    return { cls: 'etape', txt: String(idx) };
  }

  const TARGET_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>';

  function renderWaypoints() {
    const holder = $('wpList');
    if (!holder) return;
    holder.innerHTML = '';

    waypoints.forEach((wp, idx) => {
      const { cls, txt } = badgeFor(idx, waypoints.length);
      const row = document.createElement('div');
      row.className = 'wp-row';

      const badge = document.createElement('span');
      badge.className = `wp-badge ${cls}`;
      badge.textContent = txt;
      row.appendChild(badge);

      const field = document.createElement('div');
      field.className = 'wp-field';
      const input = document.createElement('input');
      input.className = 'rp-input';
      input.autocomplete = 'off';
      input.placeholder = idx === 0 ? 'Départ'
        : idx === waypoints.length - 1 ? 'Arrivée' : `Étape ${idx}`;
      input.value = wp.label;
      // Texte retapé à la main : coordonnées plus fiables tant qu'une
      // suggestion n'a pas été choisie.
      input.addEventListener('input', () => {
        wp.label = input.value;
        wp.lat = null;
        wp.lng = null;
      });
      attachAutocomplete(input, r => {
        wp.label = r.label;
        wp.lat = r.lat;
        wp.lng = r.lng;
        computeRoute();
      });
      field.appendChild(input);
      row.appendChild(field);

      // 🎯 placer ce point d'un clic sur la carte
      const target = document.createElement('button');
      target.type = 'button';
      target.className = 'wp-target';
      target.title = 'Placer ce point en cliquant sur la carte';
      target.innerHTML = TARGET_SVG;
      target.addEventListener('click', () => armPlacement(idx, target));
      row.appendChild(target);

      if (idx > 0 && idx < waypoints.length - 1) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'wp-remove';
        rm.title = 'Supprimer cette étape';
        rm.innerHTML = '&times;';
        rm.addEventListener('click', () => {
          waypoints.splice(idx, 1);
          renderWaypoints();
          computeRoute();
        });
        row.appendChild(rm);
      }

      holder.appendChild(row);
    });
  }

  function setWaypointAt(idx, lat, lng, label) {
    waypoints[idx].lat = lat;
    waypoints[idx].lng = lng;
    waypoints[idx].label = label;
    renderWaypoints();
    computeRoute();
  }

  function setFrom(lat, lng, label) { revealWidget(); setWaypointAt(0, lat, lng, label); }
  function setTo(lat, lng, label)   { revealWidget(); setWaypointAt(waypoints.length - 1, lat, lng, label); }

  function addStepAt(lat, lng, label) {
    revealWidget();
    const wp = newWaypoint();
    if (lat != null) { wp.lat = lat; wp.lng = lng; wp.label = label; }
    waypoints.splice(waypoints.length - 1, 0, wp);
    renderWaypoints();
    computeRoute();
  }

  function swapEnds() {
    waypoints.reverse();
    renderWaypoints();
    computeRoute();
  }

  function clearRoute() {
    disarmPlacement();
    waypoints = [newWaypoint(), newWaypoint()];
    currentRoutes = [];
    selectedRoute = 0;
    if (placeMarker) { map.removeLayer(placeMarker); placeMarker = null; }
    renderWaypoints();
    drawRoutes();
    setStatus('');
  }

  // ── Calcul OSRM ───────────────────────────────────────────────────────────
  async function computeRoute() {
    const pts = waypoints.filter(wp => wp.lat != null && wp.lng != null);
    if (pts.length < 2) {
      currentRoutes = [];
      drawRoutes();
      if (pts.length === 1) setStatus('Il manque un point pour calculer le trajet.');
      return;
    }

    routeAborter?.abort();
    routeAborter = new AbortController();
    setStatus('Calcul du trajet…');

    const coords = pts.map(wp => `${wp.lng},${wp.lat}`).join(';');
    // OSRM ne propose des alternatives que sans étape intermédiaire.
    const alt = pts.length === 2 ? '&alternatives=true' : '';
    const url = `${OSRM_URL}${coords}?overview=full&geometries=geojson${alt}`;

    try {
      const res = await fetch(url, { signal: routeAborter.signal });
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.length) {
        throw new Error(data.message || 'Aucun trajet trouvé entre ces points.');
      }
      currentRoutes = data.routes;
      selectedRoute = 0;
      drawRoutes(true);
      setStatus('');
    } catch (e) {
      if (e.name === 'AbortError') return;
      currentRoutes = [];
      drawRoutes();
      setStatus('Erreur de calcul : ' + e.message);
    }
  }

  // ── Affichage du trajet en cours ──────────────────────────────────────────
  function makePin(cls, txt) {
    return L.divIcon({
      className: '',
      html: `<div class="site-pin ${cls}"><span>${txt}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 28],
    });
  }

  function drawWaypointMarkers() {
    wpMarkers.forEach(m => map.removeLayer(m));
    wpMarkers = [];
    const total = waypoints.length;
    waypoints.forEach((wp, idx) => {
      if (wp.lat == null) return;
      const { cls, txt } = badgeFor(idx, total);
      const pinCls = cls === 'depart' ? 'start' : cls === 'arrivee' ? 'end' : 'etape';
      const m = L.marker([wp.lat, wp.lng], {
        icon: makePin(pinCls, txt),
        draggable: true,
        title: wp.label,
      }).addTo(map);
      // Épingle déplaçable : re-géocodage + recalcul, comme Google Maps.
      m.on('dragend', async () => {
        const pos = m.getLatLng();
        const label = await reverseGeocode(pos.lat, pos.lng);
        setWaypointAt(idx, pos.lat, pos.lng, label);
      });
      wpMarkers.push(m);
    });
  }

  function makeRouteLine(route, idx, isMain) {
    const latlngs = route.geometry.coordinates.map(c => [c[1], c[0]]);
    const line = L.polyline(latlngs, isMain
      ? { color: '#3a5ce4', weight: 6, opacity: 0.92 }
      : { color: '#8a95b8', weight: 5, opacity: 0.65, dashArray: '7 9' }
    ).addTo(map);
    line.bindTooltip(`${formatDur(route.duration)} · ${formatKm(route.distance)}`, { sticky: true });
    if (!isMain) line.on('click', () => { selectedRoute = idx; drawRoutes(); });
    return line;
  }

  function drawRoutes(fit = false) {
    routeLayers.forEach(l => map.removeLayer(l));
    routeLayers = [];
    drawWaypointMarkers();
    renderRouteSummary();

    if (!currentRoutes.length) return;

    currentRoutes.forEach((route, i) => {
      if (i === selectedRoute) return;
      routeLayers.push(makeRouteLine(route, i, false));
    });
    routeLayers.push(makeRouteLine(currentRoutes[selectedRoute], selectedRoute, true));

    if (fit) {
      const latlngs = currentRoutes[selectedRoute].geometry.coordinates.map(c => [c[1], c[0]]);
      map.fitBounds(L.latLngBounds(latlngs), { padding: [45, 45] });
    }
  }

  function renderRouteSummary() {
    const holder = $('routeSummary');
    if (!holder) return;
    holder.innerHTML = '';
    currentRoutes.forEach((route, i) => {
      const card = document.createElement('div');
      card.className = 'route-card' + (i === selectedRoute ? ' selected' : '');
      card.innerHTML = `
        <div class="route-card-top">
          <span class="route-time">${formatDur(route.duration)}</span>
          <span class="route-dist">${formatKm(route.distance)}</span>
        </div>
        <div class="route-sub">${i === 0 ? 'Trajet le plus rapide' : 'Itinéraire alternatif'}</div>
      `;
      card.addEventListener('click', () => { selectedRoute = i; drawRoutes(true); });

      // Enregistrer ce trajet (couleur + persistance) — sur la carte sélectionnée.
      if (i === selectedRoute) {
        const actions = document.createElement('div');
        actions.className = 'route-card-actions';
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.className = 'route-keep';
        keep.textContent = 'Garder ce trajet';
        keep.addEventListener('click', e => {
          e.stopPropagation();
          saveCurrentRoute(i);
        });
        actions.appendChild(keep);
        card.appendChild(actions);
      }
      holder.appendChild(card);
    });
  }

  // ── Trajets enregistrés (persistés, colorables, supprimables) ────────────
  function loadSavedRoutes() {
    try { savedRoutes = JSON.parse(localStorage.getItem(ROUTES_KEY) || '[]'); }
    catch { savedRoutes = []; }
    if (!Array.isArray(savedRoutes)) savedRoutes = [];
  }
  function persistSavedRoutes() {
    try { localStorage.setItem(ROUTES_KEY, JSON.stringify(savedRoutes)); } catch { /* quota */ }
  }

  // Allège le tracé pour le localStorage (max ~400 points suffisent à l'écran).
  function downsample(coords, max = 400) {
    if (coords.length <= max) return coords;
    const step = coords.length / max;
    const out = [];
    for (let i = 0; i < coords.length; i += step) out.push(coords[Math.floor(i)]);
    out.push(coords[coords.length - 1]);
    return out;
  }

  function saveCurrentRoute(i) {
    const route = currentRoutes[i];
    if (!route) return;
    const named = waypoints.filter(wp => wp.lat != null);
    const short = s => String(s || '').split(',')[0].trim() || '?';
    const name = named.length >= 2
      ? `${short(named[0].label)} → ${short(named[named.length - 1].label)}`
      : 'Trajet';

    const saved = {
      id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6),
      name,
      color: PALETTE[savedRoutes.length % PALETTE.length],
      distance: route.distance,
      duration: route.duration,
      coords: downsample(route.geometry.coordinates.map(c => [c[1], c[0]])),
      visible: true,
    };
    savedRoutes.push(saved);
    persistSavedRoutes();
    drawSavedRoute(saved);
    renderSavedRoutes();
    setStatus(`Trajet « ${name} » enregistré.`);
  }

  function drawSavedRoute(sr) {
    if (savedLayers[sr.id]) map.removeLayer(savedLayers[sr.id]);
    if (!sr.visible) { delete savedLayers[sr.id]; return; }
    const line = L.polyline(sr.coords, { color: sr.color, weight: 5, opacity: 0.85 }).addTo(map);
    line.bindTooltip(`${sr.name} — ${formatDur(sr.duration)} · ${formatKm(sr.distance)}`, { sticky: true });
    savedLayers[sr.id] = line;
  }

  function removeSavedRoute(id) {
    if (savedLayers[id]) { map.removeLayer(savedLayers[id]); delete savedLayers[id]; }
    savedRoutes = savedRoutes.filter(r => r.id !== id);
    persistSavedRoutes();
    renderSavedRoutes();
  }

  const EYE_SVG    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYEOFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function renderSavedRoutes() {
    const holder = $('savedRoutes');
    if (!holder) return;
    holder.innerHTML = '';

    const badge = $('routeCount');
    if (badge) badge.textContent = String(savedRoutes.length);

    if (!savedRoutes.length) {
      holder.innerHTML = '<div class="rw-empty">Aucun trajet enregistré. Calcule un trajet puis « Garder ce trajet ».</div>';
      return;
    }

    savedRoutes.forEach(sr => {
      const row = document.createElement('div');
      row.className = 'saved-route' + (sr.visible ? '' : ' hidden-route');

      // Pastille couleur : un clic ouvre le sélecteur natif, changement en direct.
      const color = document.createElement('input');
      color.type = 'color';
      color.className = 'sr-color';
      color.value = sr.color;
      color.title = 'Changer la couleur';
      color.addEventListener('click', e => e.stopPropagation());
      color.addEventListener('input', () => {
        sr.color = color.value;
        if (savedLayers[sr.id]) savedLayers[sr.id].setStyle({ color: sr.color });
        persistSavedRoutes();
      });
      row.appendChild(color);

      const main = document.createElement('span');
      main.className = 'sr-main';
      main.innerHTML = '<span class="sr-name"></span><span class="sr-sub"></span>';
      main.querySelector('.sr-name').textContent = sr.name;
      main.querySelector('.sr-sub').textContent  = `${formatDur(sr.duration)} · ${formatKm(sr.distance)}`;
      row.appendChild(main);

      // Afficher / masquer sur la carte
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'sr-btn';
      eye.title = sr.visible ? 'Masquer sur la carte' : 'Afficher sur la carte';
      eye.innerHTML = sr.visible ? EYE_SVG : EYEOFF_SVG;
      eye.addEventListener('click', e => {
        e.stopPropagation();
        sr.visible = !sr.visible;
        persistSavedRoutes();
        drawSavedRoute(sr);
        renderSavedRoutes();
      });
      row.appendChild(eye);

      // Supprimer
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sr-btn del';
      del.title = 'Supprimer ce trajet';
      del.innerHTML = '&times;';
      del.addEventListener('click', e => {
        e.stopPropagation();
        removeSavedRoute(sr.id);
      });
      row.appendChild(del);

      // Clic sur la ligne : zoom sur le trajet (et l'affiche s'il était masqué).
      row.addEventListener('click', () => {
        if (!sr.visible) {
          sr.visible = true;
          persistSavedRoutes();
          drawSavedRoute(sr);
          renderSavedRoutes();
        }
        map.fitBounds(L.latLngBounds(sr.coords), { padding: [45, 45] });
      });

      holder.appendChild(row);
    });
  }

  // ── Popup lieu (résultat de recherche / "qu'y a-t-il ici ?") ──────────────
  function openPlacePopup(lat, lng, label, sub) {
    if (placeMarker) map.removeLayer(placeMarker);
    placeMarker = L.marker([lat, lng], { icon: makePin('search', '★') }).addTo(map);

    const div = document.createElement('div');
    div.className = 'place-pop';
    div.innerHTML = `
      <div class="place-pop-title"></div>
      <div class="place-pop-sub"></div>
      <div class="place-pop-actions">
        <button type="button" class="place-pop-btn from">Partir d'ici</button>
        <button type="button" class="place-pop-btn to">Aller ici</button>
        <button type="button" class="place-pop-btn to step">+ Étape</button>
      </div>
    `;
    div.querySelector('.place-pop-title').textContent = label;
    div.querySelector('.place-pop-sub').textContent = sub || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    div.querySelector('.from').addEventListener('click', () => { setFrom(lat, lng, label); map.closePopup(); });
    div.querySelector('.to:not(.step)').addEventListener('click', () => { setTo(lat, lng, label); map.closePopup(); });
    div.querySelector('.step').addEventListener('click', () => { addStepAt(lat, lng, label); map.closePopup(); });

    placeMarker.bindPopup(div, { closeButton: true }).openPopup();
  }

  // ── Intégration au menu clic droit de tracking.js ─────────────────────────
  window.getItineraryContextItems = function (lat, lng) {
    return [
      { label: "Itinéraire depuis ici", onClick: async () => setFrom(lat, lng, await reverseGeocode(lat, lng)) },
      { label: "Itinéraire vers ici",   onClick: async () => setTo(lat, lng, await reverseGeocode(lat, lng)) },
      { label: "Ajouter une étape ici", onClick: async () => addStepAt(lat, lng, await reverseGeocode(lat, lng)) },
      { label: "Qu'y a-t-il ici ?",     onClick: async () => openPlacePopup(lat, lng, await reverseGeocode(lat, lng), '') },
    ];
  };

  window.itineraire = { open: revealWidget, setFrom, setTo, addStepAt, clear: clearRoute };

  // ── Init : attendre que tracking.js ait créé la carte ─────────────────────
  function init() {
    $('btnAddStep')?.addEventListener('click', () => addStepAt(null));
    $('btnSwap')?.addEventListener('click', swapEnds);
    $('btnClearRoute')?.addEventListener('click', clearRoute);

    attachAutocomplete($('routePlaceSearch'), r => {
      map.setView([r.lat, r.lng], 14);
      openPlacePopup(r.lat, r.lng, r.label, r.sub);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && placingIdx != null) { disarmPlacement(); setStatus(''); }
    });

    renderWaypoints();
    loadSavedRoutes();
    savedRoutes.forEach(drawSavedRoute);
    renderSavedRoutes();
  }

  const waitForMap = setInterval(() => {
    if (typeof L !== 'undefined' && typeof map !== 'undefined' && map instanceof L.Map) {
      clearInterval(waitForMap);
      init();
    }
  }, 200);
})();
