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

const app = express();

// CORS restreint aux origines listées dans .env — jamais '*' en production.
const originesAutorisees = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({ origin: originesAutorisees.length ? originesAutorisees : true }));

app.use(express.json());

// Morgan relaie chaque requête HTTP vers Winston (niveau "http").
app.use(morgan('combined', { stream: logger.stream }));

app.get('/api/health', (req, res) => {
  res.status(200).json({ statut: 'ok', version: process.env.APP_VERSION || '1.0.0' });
});

app.use('/api/auth', routesAuth);

// Route inconnue -> 404 propre (avant le gestionnaire d'erreurs global)
app.use((req, res, next) => {
  next(new ErreurApplicative(404, `Route non trouvée : ${req.method} ${req.originalUrl}`));
});

// TOUJOURS en dernier : le middleware d'erreurs à 4 paramètres.
app.use(gestionnaireErreurs);

module.exports = app;