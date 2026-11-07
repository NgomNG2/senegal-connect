# Sénégal Connect

API REST et support client temps réel pour un opérateur télécom sénégalais — projet de fin de module *Technologie Client-Serveur*, L3 Polytech Diamniadio (UAM).

Le projet couvre trois modèles de communication client-serveur :
- **Synchrone REST** (Express + PostgreSQL) pour les données métier (clients, forfaits, factures)
- **Push bidirectionnel** (Socket.IO) pour le chat de support temps réel
- **Pair-à-pair avec signalisation** (PeerJS/WebRTC) pour les appels audio/vidéo et le partage d'écran

## Prérequis

- Node.js ≥ 20
- PostgreSQL ≥ 16 (en local) **ou** Docker + Docker Compose (recommandé)
- Un navigateur récent (Chrome/Firefox/Edge) pour tester le chat et les appels vidéo

## Installation locale (sans Docker)

```bash
git clone <url-du-depot>
cd senegal-connect
npm install

cp .env.example .env
# Édite .env : renseigne DB_PASS, JWT_SECRET, DEMO_PASSWORD (voir commandes ci-dessous)
```

Génère un `JWT_SECRET` fort :
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Crée la base PostgreSQL locale :
```sql
CREATE USER sc_user WITH PASSWORD 'ton_mot_de_passe';
CREATE DATABASE senegal_connect OWNER sc_user;
```

Initialise le schéma et les données de démo :
```bash
npm run db:reset
npm run seed
```

Lance le serveur :
```bash
npm run dev
```

L'application est accessible sur **http://localhost:3000**.

## Lancement avec Docker (recommandé)

```bash
cp .env.example .env
# Édite .env — mêmes variables que ci-dessus (DB_HOST peut rester tel quel,
# docker-compose.yml le force automatiquement à "postgres" pour l'API)

docker compose up -d --build
```

Une fois les deux conteneurs démarrés (le service `api` attend que `postgres` soit `healthy` avant de démarrer) :
```bash
docker compose exec api npm run seed
```

L'application est accessible sur **http://localhost:3000**.

Pour arrêter :
```bash
docker compose down          # garde les données (volume pgdata)
docker compose down -v       # supprime aussi les données
```

## Comptes de démonstration

Tous les comptes ci-dessous utilisent le mot de passe défini dans `DEMO_PASSWORD` (`.env`).

| Rôle | Email |
|---|---|
| Admin | `admin@senegalconnect.sn` |
| Agent | `agent1@senegalconnect.sn` |
| Agent | `agent2@senegalconnect.sn` |
| Client | `awa.diouf@example.sn` |
| Client | `cheikh.gueye@example.sn` |

## Documentation API (Swagger)

Une fois le serveur lancé : **http://localhost:3000/api-docs**

Clique sur **Authorize** en haut à droite, colle un JWT obtenu via `POST /api/auth/login`, et teste n'importe quelle route protégée directement depuis l'interface.

## Tableau des principaux endpoints

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Inscription (client/agent) |
| POST | `/api/auth/login` | — | Connexion, renvoie un JWT |
| GET | `/api/auth/profil` | JWT | Profil de l'utilisateur connecté |
| GET | `/api/clients` | JWT | Liste paginée, filtres `?q=`, `?forfait_id=`, `?statut=` |
| POST | `/api/clients` | Agent/Admin | Créer un client |
| PUT / DELETE | `/api/clients/:id` | Agent/Admin · Admin | Modifier / supprimer |
| GET | `/api/forfaits` | JWT | Liste avec `nb_clients` par forfait |
| POST / PUT / DELETE | `/api/forfaits/:id` | Admin | CRUD forfaits |
| GET | `/api/factures` | JWT | Liste paginée, filtres `?client_id=`, `?statut=`, `?periode=` |
| PATCH | `/api/factures/:id/payer` | Agent/Admin | Marquer une facture payée |
| GET | `/api/tickets` | JWT | Liste filtrée par rôle (client = ses tickets, agent = ses tickets + libres, admin = tout) |
| POST | `/api/tickets` | JWT | Ouvrir un ticket |
| GET | `/api/tickets/:id/messages` | JWT | Historique paginé par curseur (`?avant=`, `?limite=`) |
| POST | `/api/tickets/:id/fichier` | JWT | Upload (image/PDF/audio, 10 Mo max) |
| GET | `/api/tickets/:id/appels` | JWT | Historique des appels du ticket |
| GET | `/api/stats` | JWT | Statistiques agrégées |
| GET | `/api/health` | — | Statut du serveur |

Événements Socket.IO et signalisation PeerJS : voir la documentation dans `src/socket/support.js` et `src/socket/appels.js`.

## Tests

```bash
npm test              # suite complète
npm run test:cov       # avec rapport de couverture
```

41 tests, base de données entièrement mockée (`jest.mock('../src/config/db')` — aucun PostgreSQL réel requis), couverture d'environ 78 % des lignes, exécution < 10 secondes.

### Pipeline automatique CI/CD

Le workflow [`ci-cd.yml`](.github/workflows/ci-cd.yml) s'exécute automatiquement sur chaque
`push` et chaque **Pull Request** vers `main` :

1. **Test** : GitHub Actions utilise Node.js 24, installe exactement les dépendances
   de `package-lock.json`, lance Jest en mode CI avec la couverture et archive le rapport.
   La suite mocke PostgreSQL ; aucun service de base de données n'est donc nécessaire.
2. **Build** : seulement si les tests réussissent, Docker construit l'image avec
   [`Dockerfile`](Dockerfile). Une Pull Request vérifie le build sans publier d'image.
3. **Publication** : sur un `push` vers `main`, l'image est publiée dans GitHub Container
   Registry (GHCR), avec des tags de branche, de version et de commit.

Pour reproduire localement la vérification CI :

```bash
npm ci
npm run test:cov -- --ci
docker build -t senegal-connect:ci .
```

Tests d'intégration Socket.IO (nécessitent un serveur réellement lancé) :
```bash
npm run dev                                    # dans un terminal
node tests/manual/test-socket-support.js       # dans un autre
```

Collections Postman disponibles dans `tests/postman/` (Auth, CRUD, M3 REST).

## Scripts npm disponibles

| Script | Effet |
|---|---|
| `npm run dev` | Démarre le serveur avec rechargement automatique (nodemon) |
| `npm start` | Démarre le serveur (production) |
| `npm test` | Lance la suite de tests Jest |
| `npm run test:cov` | Tests + rapport de couverture |
| `npm run db:reset` | Recrée le schéma PostgreSQL (structure seule) |
| `npm run seed` | Charge les données de démonstration |

## Architecture des dossiers

```
senegal-connect/
├── src/
│   ├── config/         # Pool PostgreSQL, logger Winston, Swagger
│   ├── controllers/    # Logique métier par ressource
│   ├── middleware/      # Auth JWT, validation, erreurs, upload
│   ├── routes/          # Définition des routes Express
│   ├── socket/          # support.js (M3), appels.js (M4)
│   ├── app.js            # Configuration Express
│   └── server.js         # Point d'entrée (HTTP + Socket.IO + PeerJS)
├── public/               # Interface SPA (HTML/CSS/JS, sans framework)
├── docs/schema.sql        # Schéma PostgreSQL (9 tables)
├── scripts/               # db:reset, seed
├── tests/                  # Jest (mockés), scripts de test manuel, Postman
├── uploads/                 # Fichiers partagés dans le chat
├── Dockerfile
└── docker-compose.yml
```

## Sécurité

- Mots de passe hachés avec bcrypt (coût 12)
- JWT signé avec un secret dédié (jamais commité — voir `.env.example`)
- `DEMO_PASSWORD` séparé de `DB_PASS` : jamais réutiliser un secret d'infrastructure comme mot de passe applicatif
- Contrôle d'accès appliqué au niveau SQL (pas seulement au niveau UI) : un client ne peut ni voir ni créer un ticket au nom d'un autre client, même en modifiant directement les requêtes HTTP
- Types de fichiers uploadés restreints par liste blanche, taille plafonnée
- Contenu des messages échappé **à l'affichage**, jamais au stockage (évite le double-échappement et garde le texte brut exploitable)