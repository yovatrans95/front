/**
 * planning-whatsapp.js — Envoi du planning d'un chauffeur par WhatsApp.
 *
 * Chaque carré chauffeur/jour du planning qui contient des tournées affiche
 * un bouton "Envoyer" (injecté par planning.js via window.openWaSend). La
 * popup demande seulement l'heure de prise de poste et le numéro (prérempli
 * avec celui de la fiche chauffeur), puis envoie le message WhatsApp.
 *
 * À la première utilisation, la popup affiche le QR code de connexion de la
 * session WhatsApp (numéro d'envoi de l'entreprise) — à scanner une fois.
 */
'use strict';

(function () {

  // ─── API ────────────────────────────────────────────────────────────────
  const waStatus  = () => planningFetch('/whatsapp/status');
  const waConnect = () => planningFetch('/whatsapp/connect', { method: 'POST' });
  const waPreviewOne = (chauffeurId, date, heurePrise) =>
    planningFetch(`/whatsapp/planning/preview-one?chauffeurId=${chauffeurId}&date=${date}&heurePrise=${encodeURIComponent(heurePrise || '')}`);
  const waSendOne = (body) => planningFetch('/whatsapp/planning/send-one', {
    method: 'POST', body: JSON.stringify(body)
  });

  let pollTimer = null;
  let current = { chauffeurId: null, date: null };

  // ─── Popup ──────────────────────────────────────────────────────────────
  function injectModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'waModal';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="modal wa-modal">
        <div class="modal-header">
          <h2 class="modal-title" id="waTitle">Envoyer par WhatsApp</h2>
          <button class="modal-close" id="waModalClose">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label>Heure de prise de poste</label>
              <input type="time" id="waHeure" />
            </div>
            <div class="form-group">
              <label>Numéro WhatsApp</label>
              <input type="tel" id="waTel" placeholder="06 12 34 56 78" />
            </div>
          </div>

          <label class="wa-pdf-option">
            <input type="checkbox" id="waJoinPdf" checked />
            📄 Joindre la feuille de tournée (PDF)
          </label>

          <details class="wa-preview-item" id="waPreviewDetails">
            <summary>Voir le message</summary>
            <pre class="wa-message" id="waMessagePreview">Chargement…</pre>
          </details>

          <div class="wa-conn" id="waConn">
            <span class="wa-conn-dot" id="waConnDot"></span>
            <span id="waConnLabel">Vérification…</span>
            <button type="button" class="btn btn-ghost wa-connect-btn" id="waConnectBtn" style="display:none;">Connecter WhatsApp</button>
          </div>

          <div class="wa-qr-zone" id="waQrZone" style="display:none;">
            <img id="waQrImg" alt="QR code WhatsApp" />
            <p>Sur le téléphone du numéro d'envoi :<br/>
               <strong>WhatsApp → Paramètres → Appareils connectés → Connecter un appareil</strong><br/>
               puis scannez ce QR code (une seule fois).</p>
          </div>

          <div id="waResultZone"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="waCancel">Annuler</button>
          <button class="btn btn-primary" id="waSendBtn" disabled>Envoyer</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('waModalClose').addEventListener('click', closeWaModal);
    document.getElementById('waCancel').addEventListener('click', closeWaModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWaModal(); });
    document.getElementById('waConnectBtn').addEventListener('click', startConnect);
    document.getElementById('waSendBtn').addEventListener('click', doSend);
    document.getElementById('waHeure').addEventListener('change', refreshMessagePreview);
    document.getElementById('waPreviewDetails').addEventListener('toggle', (e) => {
      if (e.target.open) refreshMessagePreview();
    });
  }

  function getChauffeur(chId) {
    return (state.chauffeurs || []).find((c) => c._id === chId) || null;
  }

  // Point d'entrée appelé par planning.js (bouton de chaque cellule).
  window.openWaSend = function (chauffeurId, dateISO) {
    if (!document.getElementById('waModal')) injectModal();
    current = { chauffeurId, date: dateISO };

    const ch = getChauffeur(chauffeurId);
    const nom = ch ? `${ch.prenom || ''} ${ch.nom || ''}`.trim() : 'chauffeur';
    document.getElementById('waTitle').textContent = `WhatsApp — ${nom} · ${dateISO}`;
    document.getElementById('waTel').value = (ch && ch.telephone) || '';
    document.getElementById('waHeure').value = guessHeurePrise(chauffeurId, dateISO);
    document.getElementById('waResultZone').innerHTML = '';
    document.getElementById('waMessagePreview').textContent = 'Chargement…';
    document.getElementById('waPreviewDetails').open = false;

    document.getElementById('waModal').style.display = 'flex';
    refreshStatus();
    pollTimer = setInterval(refreshStatus, 2500);
  };

  function closeWaModal() {
    document.getElementById('waModal').style.display = 'none';
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Heure du premier tour de la journée, si renseignée.
  function guessHeurePrise(chId, dateISO) {
    const planning = (state.plannings || []).find((p) => {
      const pId = p.chauffeurId && (p.chauffeurId._id || p.chauffeurId);
      return pId === chId && p.date === dateISO;
    });
    if (!planning) return '';
    const heures = (planning.tours || [])
      .filter((t) => t.statut !== 'annule' && t.heureDebut)
      .map((t) => t.heureDebut)
      .sort();
    return heures[0] || '';
  }

  // ─── Connexion WhatsApp ─────────────────────────────────────────────────
  async function refreshStatus() {
    let data;
    try { data = await waStatus(); }
    catch (e) { setConn('err', 'Erreur : ' + e.message); return; }

    const qrZone = document.getElementById('waQrZone');
    const connectBtn = document.getElementById('waConnectBtn');
    connectBtn.style.display = 'none';
    qrZone.style.display = 'none';

    if (data.status === 'ready') {
      setConn('ok', 'WhatsApp connecté');
    } else if (data.status === 'qr') {
      setConn('warn', 'Scannez le QR code ci-dessous');
      document.getElementById('waQrImg').src = data.qrDataUrl || '';
      qrZone.style.display = 'block';
    } else if (data.status === 'initializing') {
      setConn('warn', 'Connexion en cours…');
    } else {
      setConn('err', data.error ? `Déconnecté (${data.error})` : 'WhatsApp non connecté');
      connectBtn.style.display = 'inline-flex';
    }
    updateSendButton();
  }

  function setConn(kind, label) {
    const dot = document.getElementById('waConnDot');
    dot.className = 'wa-conn-dot ' + kind;
    dot.dataset.state = kind;
    document.getElementById('waConnLabel').textContent = label;
  }

  async function startConnect() {
    document.getElementById('waConnectBtn').style.display = 'none';
    setConn('warn', 'Démarrage…');
    try { await waConnect(); } catch (e) { setConn('err', 'Erreur : ' + e.message); }
    refreshStatus();
  }

  function updateSendButton() {
    const btn = document.getElementById('waSendBtn');
    btn.disabled = document.getElementById('waConnDot').dataset.state !== 'ok';
    btn.title = btn.disabled ? 'Connectez d\'abord WhatsApp' : '';
  }

  // ─── Aperçu du message ──────────────────────────────────────────────────
  async function refreshMessagePreview() {
    if (!document.getElementById('waPreviewDetails').open) return;
    const pre = document.getElementById('waMessagePreview');
    pre.textContent = 'Chargement…';
    try {
      const heure = document.getElementById('waHeure').value;
      const data = await waPreviewOne(current.chauffeurId, current.date, heure);
      pre.textContent = data.message;
    } catch (e) {
      pre.textContent = 'Erreur : ' + e.message;
    }
  }

  // ─── Envoi ──────────────────────────────────────────────────────────────
  async function doSend() {
    const btn = document.getElementById('waSendBtn');
    const resultZone = document.getElementById('waResultZone');
    const telephone = document.getElementById('waTel').value.trim();
    const heurePrise = document.getElementById('waHeure').value;

    if (!telephone) {
      resultZone.innerHTML = '<p class="wa-error">Renseignez le numéro WhatsApp.</p>';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Envoi…';
    resultZone.innerHTML = '';
    try {
      const body = {
        chauffeurId: current.chauffeurId,
        date: current.date,
        heurePrise,
        telephone
      };

      // Feuille de tournée en pièce jointe (générée par planning-print.js)
      if (document.getElementById('waJoinPdf').checked) {
        if (typeof window.buildTourSheetPdfBase64 !== 'function') {
          throw new Error('Module feuilles de tournée non chargé (planning-print.js)');
        }
        btn.textContent = 'Génération du PDF…';
        // On passe l'heure de prise de poste pour qu'elle figure aussi sur le PDF
        const pdf = await window.buildTourSheetPdfBase64(current.chauffeurId, current.date, heurePrise);
        if (pdf) {
          body.pdfBase64 = pdf.base64;
          body.pdfFilename = pdf.filename;
        }
        btn.textContent = 'Envoi…';
      }

      const data = await waSendOne(body);
      resultZone.innerHTML = `<p class="wa-ok">✓ Planning envoyé à ${esc(data.chauffeur)} (${esc(data.numero)})${data.pdf ? ' avec la feuille de tournée 📄' : ''}</p>`;
      if (typeof notify === 'function') notify(`Planning envoyé à ${data.chauffeur} 📲`, 'success');
      setTimeout(closeWaModal, 1200);
    } catch (e) {
      resultZone.innerHTML = `<p class="wa-error">Erreur : ${esc(e.message)}</p>`;
    } finally {
      btn.textContent = 'Envoyer';
      updateSendButton();
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

})();
