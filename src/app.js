/**
 * src/app.js
 * -----------------------------------------------------------------------
 * Configuration de l'application Express, SÉPARÉE de server.js.
 *
 * Pourquoi séparer app.js et server.js ? Pour que les tests (Supertest)
 * puissent importer "app" directement et lui envoyer des requêtes
 * simulées, SANS ouvrir un vrai port réseau. server.js, lui, fera
 * app.listen(PORT) et démarrera Socket.IO/PeerJS — mais uniquement quand
 * on lance vraiment le serveur, jamais pendant les tests.
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const logger = require('./config/logger');
const { gestionnaireErreurs, ErreurApplicative } = require('./middleware/erreurs');
const routesAuth = require('./routes/auth');
// Routes CRUD pour les clients, forfaits et factures.
const routesClients = require('./routes/clients');
const routesForfaits = require('./routes/forfaits');
const routesFactures = require('./routes/factures');
// Routes statistiques (ex: nombre de clients, chiffre d'affaires, etc.)
const routesStats = require('./routes/stats');
// Swagger UI pour la documentation interactive de l'API.
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
// Routes CRUD pour les tickets (ex: support client).
const routesTickets = require('./routes/tickets');


const app = express();

// CORS restreint aux origines listées dans .env — jamais '*' en production.
const originesAutorisees = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({ origin: originesAutorisees.length ? originesAutorisees : true }));

app.use(express.json());

// Morgan relaie chaque requête HTTP vers Winston (niveau "http").
app.use(morgan('combined', { stream: logger.stream }));

app.get('/api/health', (req, res) => {
  res.status(200).json({
    statut: 'ok',
    uptime: process.uptime(),
    version: process.env.APP_VERSION || '1.0.0',
  });
});

// Routes d'authentification (login, refresh token, logout).
app.use('/api/auth', routesAuth);

// Routes CRUD pour les clients, forfaits et factures.
app.use('/api/clients', routesClients);
app.use('/api/forfaits', routesForfaits);
app.use('/api/factures', routesFactures);

// Routes CRUD pour les tickets (ex: support client).
app.use('/api/tickets', routesTickets);
// Route pour servir les fichiers uploadés (ex: pièces jointes) depuis le dossier "uploads".
app.use('/uploads', express.static(process.env.UPLOAD_DIR || 'uploads'));

// Routes statistiques (ex: nombre de clients, chiffre d'affaires, etc.)
app.use('/api/stats', routesStats);

// Documentation Swagger UI interactive.
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Route inconnue -> 404 propre (avant le gestionnaire d'erreurs global)
app.use((req, res, next) => {
  next(new ErreurApplicative(404, `Route non trouvée : ${req.method} ${req.originalUrl}`));
});

// TOUJOURS en dernier : le middleware d'erreurs à 4 paramètres.
app.use(gestionnaireErreurs);

module.exports = app;