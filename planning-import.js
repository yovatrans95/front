/**
 * planning-import.js — Panneau import PDF Mauffrey
 */
'use strict';

// Variable globale accessible depuis planning.js
window.draggedImportTour = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {

  // Créer le panneau
  var panel = document.createElement('div');
  panel.id = 'importPanel';
  panel.className = 'import-panel';
  panel.innerHTML =
    '<div class="import-panel-header">' +
      '<span class="import-panel-title">Import Feuille de tournée Mauffrey</span>' +
      '<button class="import-panel-close" id="importPanelClose">&times;</button>' +
    '</div>' +
    '<div class="import-panel-body">' +
      '<div class="import-drop-zone" id="importDropZone">' +
        '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
          '<polyline points="14 2 14 8 20 8"/>' +
          '<line x1="12" y1="12" x2="12" y2="18"/>' +
          '<line x1="9" y1="15" x2="15" y2="15"/>' +
        '</svg>' +
        '<p>Glissez un PDF ici<br>ou <u>cliquez</u> pour choisir</p>' +
        '<input type="file" id="importFileInput" accept=".pdf" style="display:none" />' +
      '</div>' +
      '<div class="import-status" id="importStatus"></div>' +
      '<div class="import-results" id="importResults"></div>' +
    '</div>';
  document.body.appendChild(panel);

  // Bouton toggle
  var toggleBtn = document.getElementById('importPanelToggle');
  if (toggleBtn) toggleBtn.addEventListener('click', togglePanel);
  document.getElementById('importPanelClose').addEventListener('click', closePanel);

  // Zone drop PDF
  var dropZone = document.getElementById('importDropZone');
  var fileInput = document.getElementById('importFileInput');
  dropZone.addEventListener('click', function() { fileInput.click(); });
  dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('active'); });
  dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('active'); });
  dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropZone.classList.remove('active');
    var file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') handleFile(file);
    else (window.notify || alert)('Veuillez déposer un fichier PDF.', 'warning');
  });
  fileInput.addEventListener('change', function(e) {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  // ── Drop sur les cellules de la grille ──
  document.addEventListener('dragover', function(e) {
    if (!window.draggedImportTour) return;
    var cell = e.target.closest('.day-cell');
    if (cell) {
      e.preventDefault();
      document.querySelectorAll('.day-cell.drop-import').forEach(function(c) {
        if (c !== cell) c.classList.remove('drop-import');
      });
      cell.classList.add('drop-import');
    }
  });

  document.addEventListener('dragleave', function(e) {
    if (!window.draggedImportTour) return;
    var cell = e.target.closest('.day-cell');
    if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove('drop-import');
  });

  document.addEventListener('drop', function(e) {
    document.querySelectorAll('.day-cell.drop-import').forEach(function(c) { c.classList.remove('drop-import'); });
    if (!window.draggedImportTour) return;

    var cell = e.target.closest('.day-cell');
    if (!cell) return;
    e.preventDefault();

    var chauffeurId = cell.dataset.chauffeurId;
    var dateISO     = cell.dataset.date;
    if (!chauffeurId || !dateISO) return;

    var t = window.draggedImportTour;
    window.draggedImportTour = null;

    // Marquer la carte
    if (t.cardEl) {
      t.cardEl.classList.add('dispatched');
      t.cardEl.draggable = false;
      var hint = t.cardEl.querySelector('.itc-drag-hint');
      if (hint) hint.textContent = 'Dispatché';
    }

    var payload = {
      type:         'tour',
      statut:       'planifie',
      clientSource: 'mauffrey',
      client:       'Mauffrey',
      immatCamion:  '',
      heurePeriode: t.heurePeriode || 'journee',
      source:       t.source       || '',
      destination:  t.destination  || '',
      lieuChantier: '',
      refTransport: t.codeDashdoc  || null,
      notes:        [
        t.marchandise ? 'Marchandise : ' + t.marchandise : '',
        t.refMauffrey ? 'Ref Mauffrey : ' + t.refMauffrey : '',
        'Tracteur : ' + t.tracteur + ' (' + (t.heurePeriode === 'nuit' ? 'Nuit' : 'Jour') + ')',
      ].filter(Boolean).join('\n'),
    };

    if (typeof showLoader === 'function') showLoader();
    createTour(chauffeurId, dateISO, payload)
      .then(function() { return loadView(); })
      .catch(function(err) { (window.notify || alert)('Erreur : ' + err.message, 'error'); })
      .finally(function() { if (typeof hideLoader === 'function') hideLoader(); });
  });
});

// ─── Toggle / Close ───────────────────────────────────────────────────────────
function togglePanel() {
  var panel   = document.getElementById('importPanel');
  var wrapper = document.querySelector('.page-wrapper');
  var btn     = document.getElementById('importPanelToggle');
  var isOpen  = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  if (wrapper) wrapper.classList.toggle('with-import-panel', !isOpen);
  if (btn) btn.classList.toggle('active', !isOpen);
}

function closePanel() {
  document.getElementById('importPanel').classList.remove('open');
  var wrapper = document.querySelector('.page-wrapper');
  if (wrapper) wrapper.classList.remove('with-import-panel');
  var btn = document.getElementById('importPanelToggle');
  if (btn) btn.classList.remove('active');
}

// ─── Gestion fichier PDF ──────────────────────────────────────────────────────
function handleFile(file) {
  var status  = document.getElementById('importStatus');
  var results = document.getElementById('importResults');
  status.textContent = 'Lecture du PDF…';
  results.innerHTML  = '';

  if (typeof pdfjsLib === 'undefined') {
    status.textContent = 'Erreur : PDF.js non chargé.';
    return;
  }

  var reader = new FileReader();
  reader.onload = function(e) {
    pdfjsLib.getDocument({ data: e.target.result }).promise
      .then(function(pdf) {
        var promises = [];
        for (var i = 1; i <= pdf.numPages; i++) promises.push(pdf.getPage(i));
        return Promise.all(promises);
      })
      .then(function(pages) {
        return Promise.all(pages.map(function(page) {
          return page.getTextContent().then(function(c) {
            return c.items.map(function(i) { return i.str; }).join('\n');
          });
        }));
      })
      .then(function(pageTexts) {
        var tournees = parseMauffrey(pageTexts);
        if (!tournees.length) { status.textContent = 'Aucune tournée trouvée.'; return; }
        var total = tournees.reduce(function(s,t){ return s + t.tours.length; }, 0);
        status.textContent = tournees.length + ' tracteur(s) · ' + total + ' tour(s)';
        renderResults(tournees);
      })
      .catch(function(err) {
        status.textContent = 'Erreur : ' + err.message;
        console.error(err);
      });
  };
  reader.readAsArrayBuffer(file);
}

// ─── Parser ───────────────────────────────────────────────────────────────────
// Version robuste pour PDF Mauffrey.
// Important : dans vos PDF, "N° Tracteur" sort souvent comme :
// N° Tracteur :
// YOVATRANS
// FMA 1
// Donc on ignore YOVATRANS et on cherche FMA/BENNE dans les lignes suivantes.
function parseMauffrey(pageTexts) {
  var result = [];

  // ── Date (cherchée dans n'importe quelle page) ─────────────────────────
  var dateISO = null;
  for (var pi = 0; pi < pageTexts.length; pi++) {
    var dm = String(pageTexts[pi]).match(/Tournée\s+du\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (dm) { dateISO = dm[3] + '-' + dm[2] + '-' + dm[1]; break; }
  }

  // ── ÉTAPE 1 : flatten ─────────────────────────────────────────────────
  // Toutes les pages en un seul flux, sans le bruit de rendu PDF.
  var stream = [];
  pageTexts.forEach(function(pageText) {
    cleanPdfLines(pageText).forEach(function(l) {
      if (!isPageNoise(l)) stream.push(l);
    });
  });

  // ── ÉTAPE 2 : segmenter par tracteur ──────────────────────────────────
  // Un tracteur n'apparaît qu'une seule fois dans le PDF, et il est
  // entièrement Jour OU entièrement Nuit. Donc on regroupe par tracteur
  // (comme avant) ; la période sera déterminée à l'étape suivante en
  // lisant la "Prise de Poste" sur l'ensemble des lignes du segment.
  var segments = []; // [{ tracteur, lines: [...] }]
  var current = null;

  for (var i = 0; i < stream.length; i++) {
    if (/^N°\s*Tracteur/i.test(stream[i])) {
      var tracteur = '';
      for (var j = i + 1; j < Math.min(stream.length, i + 10); j++) {
        var m = stream[j].match(/\b(FMA|BENNE)\s*[-]?\s*(\d{1,2})\b/i);
        if (m) { tracteur = (m[1].toUpperCase() + ' ' + m[2]).trim(); break; }
      }
      if (tracteur) {
        // Si on retombe sur le même tracteur (header réimprimé en milieu
        // de section), on continue d'écrire dans le même segment.
        if (!current || current.tracteur !== tracteur) {
          current = { tracteur: tracteur, lines: [] };
          segments.push(current);
        }
        continue;
      }
    }
    if (current) current.lines.push(stream[i]);
  }

  // ── ÉTAPE 3 : extraire les tours par segment ──────────────────────────
  segments.forEach(function(seg) {
    // Période lue depuis la PREMIÈRE "Prise de Poste" du segment.
    //   00:00 -> nuit (tracteur de nuit en entier)
    //   autre -> journee (tracteur de jour en entier)
    var periode = detectPeriodeFromPriseDePoste(seg.lines) || 'journee';

    var tours = extractToursFromLines(seg.lines);
    if (!tours.length) {
      console.warn('Import PDF : aucun tour pour', seg.tracteur);
      return;
    }
    // La période du tracteur s'applique à TOUS ses tours.
    tours.forEach(function(t) { t.heurePeriode = periode; });

    var existing = result.find(function(r) { return r.tracteur === seg.tracteur; });
    if (existing) {
      existing.tours = existing.tours.concat(tours);
    } else {
      result.push({
        tracteur: seg.tracteur,
        periode:  periode,
        dateISO:  dateISO,
        tours:    tours
      });
    }
  });

  return result;
}

// ── Détection période d'un tracteur depuis la "Prise de Poste" ───────────────
// Parcourt les lignes du segment, trouve la première occurrence de
// "Prise de Poste" puis l'heure qui la suit (même ligne ou 5 lignes suivantes).
//   00:00 -> 'nuit'   (tracteur de nuit)
//   autre -> 'journee' (tracteur de jour)
//   rien trouvé -> null (le caller utilisera 'journee' par défaut)
function detectPeriodeFromPriseDePoste(lines) {
  for (var i = 0; i < lines.length; i++) {
    if (/^Prise de Poste/i.test(lines[i])) {
      for (var k = i; k < Math.min(lines.length, i + 6); k++) {
        var hm = lines[k].match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
        if (hm) {
          var hh = parseInt(hm[1], 10);
          var mm = parseInt(hm[2], 10);
          return (hh === 0 && mm === 0) ? 'nuit' : 'journee';
        }
      }
      return null;
    }
  }
  return null;
}

// Lignes "techniques" du PDF qui apparaissent sur chaque page mais n'ont
// aucun sens métier. Centralisé ici : si demain un nouveau type de footer
// apparaît, on n'ajoute qu'une ligne dans cette fonction.
function isPageNoise(line) {
  var s = String(line || '').trim();
  if (!s) return true;
  if (/^Tournée\s+du\s+\d{2}\/\d{2}\/\d{4}/i.test(s)) return true; // footer "Tournée du JJ/MM/AAAA"
  if (/^Page\s+\d+\s*\/\s*\d+$/i.test(s)) return true;             // "Page X/Y"
  return false;
}

function cleanPdfLines(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\uFFFE/g, '-')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(function(l) {
      return String(l || '')
        .replace(/\s+/g, ' ')
        .replace(/[￾�]/g, '-')
        .trim();
    })
    .filter(Boolean);
}

function extractTracteurFromLines(lines) {
  for (var i = 0; i < lines.length; i++) {
    if (/^N°\s*Tracteur/i.test(lines[i])) {
      for (var j = i + 1; j < Math.min(lines.length, i + 10); j++) {
        var l = lines[j].trim();
        if (!l || /^YOVATRANS$/i.test(l)) continue;
        var m = l.match(/\b(FMA|BENNE)\s*[-]?\s*(\d{1,2})\b/i);
        if (m) return (m[1].toUpperCase() + ' ' + m[2]).replace(/\s+/g, ' ').trim();
      }
    }
  }
  return '';
}

function extractToursFromLines(lines) {
  var tours = [];
  var i = 0;

  while (i < lines.length) {
    if (!isChargementLine(lines[i])) {
      i++;
      continue;
    }

    i++;

    var loadBlock = [];
    while (i < lines.length && !isDechargementLine(lines[i]) && !isChargementLine(lines[i]) && !isEndLine(lines[i])) {
      loadBlock.push(lines[i]);
      i++;
    }

    var destBlock = [];
    if (i < lines.length && isDechargementLine(lines[i])) {
      i++;
      while (i < lines.length && !isChargementLine(lines[i]) && !isEndLine(lines[i])) {
        destBlock.push(lines[i]);
        i++;
      }
    }

    var loadInfo = analyseActivityBlock(loadBlock);
    var destInfo = analyseActivityBlock(destBlock);

    var refMauffrey = loadInfo.refMauffrey || destInfo.refMauffrey || '';
    var codeDashdoc = loadInfo.codeDashdoc || destInfo.codeDashdoc || '';
    var heure = loadInfo.heure || destInfo.heure || '';
    var heurePeriode = detectPeriode(heure);

    // On garde la tournée même si une info manque : le but est d'avoir la carte à dispatcher.
    if (loadInfo.marchandise || loadInfo.lieu || destInfo.lieu || refMauffrey || codeDashdoc) {
      tours.push({
        marchandise: loadInfo.marchandise || destInfo.marchandise || '',
        source: loadInfo.lieu || '',
        destination: destInfo.lieu || '',
        refMauffrey: refMauffrey,
        codeDashdoc: codeDashdoc,
        heureDebut: heure,
        heurePeriode: heurePeriode
      });
    }
  }

  return tours;
}

function isChargementLine(l) {
  return /^Chargement\b/i.test(String(l || '').trim());
}

function isDechargementLine(l) {
  return /^(Déchargement|Dechargement)\b/i.test(String(l || '').trim());
}

function isEndLine(l) {
  return /^(Fin de Poste|Prise de Poste|Tournée du)\b/i.test(String(l || '').trim());
}

function analyseActivityBlock(blockLines) {
  var lines = blockLines.slice();
  var joined = lines.join(' ');

  var heure = '';
  var hm = joined.match(/\b(\d{1,2}:\d{2})(?::\d{2})?\b/);
  if (hm) heure = hm[1].padStart(5, '0');

  var refMauffrey = '';
  var refMatch = joined.match(/\b(1\d{6})\b/); // ex: 1205587
  if (refMatch) refMauffrey = refMatch[1];

  var codeDashdoc = '';
  var tokens = joined.match(/\b[A-Z0-9]{6}\b/g) || [];
  for (var t = 0; t < tokens.length; t++) {
    var token = tokens[t];
    if (/^\d+$/.test(token)) continue;
    if (/^(YOVATR|MANGEE|MENAGE|DECHET|SELECT|ROUTE)$/i.test(token)) continue;
    codeDashdoc = token;
    break;
  }

  var content = lines.filter(function(l) {
    return isUsefulActivityLine(l);
  });

  // Marchandise : premières lignes avant le site/client.
  var marchandiseLines = [];
  var lieuLines = [];
  var foundLieu = false;

  for (var i = 0; i < content.length; i++) {
    var line = content[i];

    if (!foundLieu && isLikelySiteLine(line)) {
      foundLieu = true;
    }

    if (!foundLieu && marchandiseLines.length < 3) {
      marchandiseLines.push(line);
    } else {
      lieuLines.push(line);
    }
  }

  // Si aucun site détecté, on force : première ligne = marchandise, la suite = lieu.
  if (!lieuLines.length && content.length > 1) {
    marchandiseLines = [content[0]];
    lieuLines = content.slice(1);
  }

  var marchandise = normalizeText(marchandiseLines.join(' '));
  var lieu = normalizeText(lieuLines.slice(0, 3).join(' · '));

  return {
    marchandise: marchandise,
    lieu: lieu,
    refMauffrey: refMauffrey,
    codeDashdoc: codeDashdoc,
    heure: heure
  };
}

function isUsefulActivityLine(l) {
  l = String(l || '').trim();
  if (!l) return false;
  if (/^\d{1,2}\/\d{2}\/\d{3,4}$/i.test(l)) return false; // 18/05/202
  if (/^\d{1,2}\/\d{2}\/\d{4}/i.test(l)) return false;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/i.test(l)) return false;
  if (/^\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?$/i.test(l)) return false; // 6 05:00:00
  if (/\b\d{1,2}:\d{2}(:\d{2})?\b/.test(l)) return false;
  if (/^\d{7}$/.test(l)) return false;
  if (/\b1\d{6}\b/.test(l)) return false;
  if (/^[A-Z0-9]{6}$/.test(l) && /[A-Z]/.test(l)) return false;
  if (/^[A-Z0-9]{7,8}$/.test(l) && /[A-Z]/.test(l)) return false; // ex P8B2PZ2
  if (/^(Km|total kms|Commentaires|Litrage|Fournisseur|N°|Réf|Ref|Code|Dashdoc|Tonna|ge|Les Activités|Lieu de l'activité|Arrivée|Départ)$/i.test(l)) return false;
  return true;
}

function isLikelySiteLine(l) {
  return /(VEOLIA|SYCTOM|PAPREC|SMDO|SUEZ|SECODE|Satel|GENERIS|ECODROP|RITLENG|REVIVAL|REFINAL|UIOM|IP\s*13|ISSEANE|ESIANE|REP|SPL|BROYAGE|PARI|GURDEBEKE)/i.test(l)
    || /[a-zàâäéèêëîïôöùûüç]/.test(l);
}

function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim();
}

function detectPeriode(heure) {
  if (!heure) return 'journee';
  var h = parseInt(String(heure).split(':')[0], 10);
  if (Number.isNaN(h)) return 'journee';
  return h < 6 ? 'nuit' : 'journee';
}

// ─── Rendu ───────────────────────────────────────────────────────────────────
function renderResults(tournees) {
  var results = document.getElementById('importResults');
  results.innerHTML = '';

  tournees.forEach(function(t) {
    var section = document.createElement('div');
    section.className = 'import-section';

    var dateLabel = '';
    if (t.dateISO) {
      try {
        var d = new Date(t.dateISO + 'T00:00:00');
        dateLabel = d.toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' });
      } catch(e) {}
    }

    // Badge Jour / Nuit (la période vient de la "Prise de Poste" du PDF)
    var isNuit       = t.periode === 'nuit';
    var periodeLabel = isNuit ? 'Nuit' : 'Jour';
    var periodeCls   = isNuit ? 'is-nuit' : 'is-jour';

    var header = document.createElement('div');
    header.className = 'import-section-header ' + periodeCls;
    header.innerHTML =
      '<span class="import-tracteur">' + t.tracteur + '</span>' +
      '<span class="import-periode-badge ' + periodeCls + '">' + periodeLabel + '</span>' +
      '<span class="import-date">'     + dateLabel  + '</span>' +
      '<span class="import-count">'    + t.tours.length + '</span>';
    section.appendChild(header);

    t.tours.forEach(function(tour) {
      var card = document.createElement('div');
      card.className = 'import-tour-card ' + periodeCls;
      card.draggable = true;

      var src = tour.source      ? '<div class="itc-lieu">'          + tour.source      + '</div>' : '';
      var dst = tour.destination ? '<div class="itc-lieu itc-dest">' + tour.destination + '</div>' : '';
      var ref = (tour.refMauffrey || tour.codeDashdoc)
        ? '<div class="itc-ref">' + [tour.refMauffrey, tour.codeDashdoc].filter(Boolean).join(' · ') + '</div>'
        : '';

      card.innerHTML =
        '<div class="itc-top">' +
          '<span class="itc-type-label">Tour</span>' +
          '<span class="itc-dot">·</span>' +
          '<span class="itc-tracteur">' + t.tracteur + '</span>' +
          '<span class="itc-periode-mini ' + periodeCls + '">' + periodeLabel.toUpperCase() + '</span>' +
        '</div>' +
        '<div class="itc-marchandise-line">' + (tour.marchandise || '') + '</div>' +
        src + dst + ref +
        '<div class="itc-drag-hint">Glisser vers un chauffeur</div>';

      card.addEventListener('dragstart', function(e) {
        window.draggedImportTour = {
          tracteur:     t.tracteur,
          dateISO:      t.dateISO,
          marchandise:  tour.marchandise,
          source:       tour.source,
          destination:  tour.destination,
          refMauffrey:  tour.refMauffrey,
          codeDashdoc:  tour.codeDashdoc,
          heurePeriode: tour.heurePeriode || t.periode || 'journee',
          cardEl:       card,
        };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', 'import');
        setTimeout(function() { card.classList.add('dragging'); }, 0);
      });

      card.addEventListener('dragend', function() {
        card.classList.remove('dragging');
        window.draggedImportTour = null;
      });

      section.appendChild(card);
    });

    results.appendChild(section);
  });
}
// ─── API exposée à planning.js ───────────────────────────────────────────────
// planning.js appelle window.handleImportDropToCell(chauffeurId, dateISO)
// depuis son propre drop handler de cellule.
window.handleImportDropToCell = function(chauffeurId, dateISO) {
  var t = window.draggedImportTour;
  if (!t) return Promise.resolve();
  window.draggedImportTour = null;

  // Marquer la carte comme dispatchée
  if (t.cardEl) {
    t.cardEl.classList.add('dispatched');
    t.cardEl.draggable = false;
    var hint = t.cardEl.querySelector('.itc-drag-hint');
    if (hint) hint.textContent = 'Dispatché';
  }

  var payload = {
    type:         'tour',
    statut:       'planifie',
    clientSource: 'mauffrey',
    client:       'Mauffrey',
    immatCamion:  '',
    heurePeriode: t.heurePeriode || 'journee',
    source:       t.source       || '',
    destination:  t.destination  || '',
    lieuChantier: '',
    refTransport: t.codeDashdoc  || null,
    notes: [
      t.marchandise ? 'Marchandise : ' + t.marchandise : '',
      t.refMauffrey ? 'Ref Mauffrey : ' + t.refMauffrey : '',
      'Tracteur : ' + t.tracteur + ' (' + (t.heurePeriode === 'nuit' ? 'Nuit' : 'Jour') + ')',
    ].filter(Boolean).join('\n'),
  };

  if (typeof showLoader === 'function') showLoader();
  return createTour(chauffeurId, dateISO, payload)
    .then(function() { return loadView(); })
    .catch(function(err) { (window.notify || alert)('Erreur : ' + err.message, 'error'); })
    .finally(function() { if (typeof hideLoader === 'function') hideLoader(); });
};