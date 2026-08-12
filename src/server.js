/**
 * Point d'entrée du serveur Sénégal Connect.
 * - Configure l'application Express.  
 * - Démarre le serveur HTTP et Socket.IO.
*/

require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const logger = require('./config/logger');
const { initialiserSupportSocket } = require('./socket/support');

const PORT = process.env.PORT || 3000;
const serveurHttp = http.createServer(app);
const io = new Server(serveurHttp, {
  cors: { origin: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean) },
});

initialiserSupportSocket(io);
app.set('io', io);

serveurHttp.listen(PORT, () => {
  logger.info(`Serveur Sénégal Connect démarré sur le port ${PORT} (env: ${process.env.NODE_ENV})`);
});