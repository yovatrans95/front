# Yovatrans backend starter

This is a Node.js + Express + MongoDB starter backend for your uploaded Yovatrans frontend.

## Why this backend matches your files

Your current frontend stores:
- admin auth in the browser
- driver records in `localStorage`
- chauffeur accounts in `localStorage`
- official and general documents in browser storage

That is visible in the uploaded frontend files, where admin credentials are hardcoded and driver creation builds one large driver object with permit, emergency contact, and official document fields. fileciteturn3file0L1-L18 fileciteturn3file2L1-L58 fileciteturn3file3L1-L33

This starter keeps the same field names for fast frontend integration.

## Features included

- JWT login for `admin` and `gestionnaire`
- MongoDB `users` collection
- MongoDB `drivers` collection
- CRUD for drivers
- chauffeur account creation when creating a driver
- photo upload with Multer
- general document upload
- official document upload for:
  - `cni`
  - `cc`
  - `fimo`
  - `vitale`
  - `rib`
  - `btp`
- overview stats route for the drivers page

## Suggested collection design

### users
- admin
- gestionnaire
- chauffeur

### drivers
Contains the fields already used in your frontend:
- personal info
- permit info
- emergency info
- official document metadata
- uploaded documents

## Install

```bash
npm install
cp .env.example .env
```

## Run

```bash
npm run seed:admin
npm run dev
```

## Main API routes

### Auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Drivers
- `GET /api/drivers`
- `GET /api/drivers/:id`
- `POST /api/drivers`
- `PATCH /api/drivers/:id`
- `DELETE /api/drivers/:id`
- `GET /api/drivers/stats/overview`

### Documents
- `POST /api/drivers/:id/documents`
- `POST /api/drivers/:id/official-documents/:type`

## Example login payload

```json
{
  "username": "admin",
  "password": "admin123"
}
```

## Example create driver payload

```json
{
  "nom": "Kouassi",
  "prenom": "Amos",
  "email": "amos.kouassi@gmail.com",
  "telephone": "+33 6 12 34 56 78",
  "chauffeurPassword": "secret123",
  "ddn": "1985-03-12",
  "lieu_naissance": "Abidjan",
  "nationalite": "Ivoirienne",
  "genre": "Masculin",
  "situation": "Marié(e)",
  "enfants": 2,
  "adresse": "12 rue des Acacias, Paris 75010",
  "permis_numero": "P-123456",
  "permis_categorie": "CE",
  "permis_obtention": "2005-06-15",
  "permis_expiration": "2026-06-15",
  "permis_pays": "France",
  "statut": "actif",
  "urgence_nom": "Kouassi",
  "urgence_prenom": "Marie",
  "urgence_lien": "Conjoint",
  "urgence_tel": "+33 6 98 76 54 32",
  "id_type": "CNI",
  "id_num": "AA123456",
  "id_deliv": "2020-01-01",
  "id_exp": "2030-01-01",
  "cc_num": "CC-998877",
  "cc_exp": "2028-01-01",
  "fimo_type": "FIMO",
  "fimo_num": "FIMO-123",
  "fimo_obt": "2023-01-01",
  "fimo_exp": "2028-01-01",
  "ss_num": "185037511600142",
  "rib_iban": "FR7600000000000000000000000",
  "rib_bic": "BNPAFRPPXXX",
  "rib_titulaire": "Amos Kouassi",
  "btp_num": "BTP-100",
  "btp_deliv": "2024-01-01",
  "btp_exp": "2027-01-01"
}
```

## What to change next in the frontend

1. Replace `Auth.login(...)` with a `fetch('/api/auth/login')` call.
2. Replace `loadDrivers()` calls with `fetch('/api/drivers')`.
3. Replace `saveDriver()` localStorage logic with `POST /api/drivers`.
4. Replace edit page save logic with `PATCH /api/drivers/:id`.
5. Replace photo/document base64 storage with real file uploads.

## Best next step

Wire these pages in this order:
1. `login.html`
2. `drivers.html`
3. `add-chauffeur.html`
4. `driver.html`
