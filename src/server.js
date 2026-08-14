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
const {PeerServer} = require('peer');


const PORT = process.env.PORT || 3000;
// PeerJS server pour WebRTC (audio/vidéo) — écoute sur un port séparé.
const PEER_PORT = process.env.PEER_PORT || 9000;


const serveurHttp = http.createServer(app);
const io = new Server(serveurHttp, {
  cors: { origin: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean) },
});

initialiserSupportSocket(io);
app.set('io', io);

serveurHttp.listen(PORT, () => {
  logger.info(`Serveur Sénégal Connect démarré sur le port ${PORT} (env: ${process.env.NODE_ENV})`);
});


// Serveur PeerJS séparé — gère UNIQUEMENT la signalisation SDP/ICE de
// PeerJS, jamais le flux audio/vidéo lui-même (P2P direct entre navigateurs).
PeerServer({ port: PEER_PORT, path: '/peerjs' }, () => {
  logger.info(`Serveur PeerJS démarré sur le port ${PEER_PORT}`);
});
