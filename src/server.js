/**
 * src/server.js
 * -----------------------------------------------------------------------
 * Point d'entrée réel de l'application. Charge les variables d'env,
 * démarre le serveur HTTP. Socket.IO et PeerJS seront ajoutés ici dans
 * les modules M3/M4.
 */

require('dotenv').config();
const app = require('./app');
const logger = require('./config/logger');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`Serveur Sénégal Connect démarré sur le port ${PORT} (env: ${process.env.NODE_ENV})`);
});