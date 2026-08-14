/**
 * src/socket/appels.js
 * -----------------------------------------------------------------------
 * Signalisation WebRTC (M4) : le serveur n'échange QUE des métadonnées
 * (peerId, SDP négocié en interne par PeerJS, statut de l'appel) — jamais
 * le flux audio/vidéo lui-même, qui circule en P2P direct entre les deux
 * navigateurs une fois la connexion établie (étape 7, hors du serveur).
 *
 * IMPORTANT sur la sécurité (section "Cohérence avec le ticket") :
 *  - "L'appel ne peut être initié que si le ticket est en_cours"
 *  - "Les participants sont nécessairement le client du ticket et l'agent
 *     assigné" — on ne fait JAMAIS confiance à un destinataireId envoyé
 *     par le client (d'ailleurs le payload d'appel:initier n'en contient
 *     pas, volontairement) : le destinataire est déterminé côté serveur
 *     à partir du ticket lui-même.
 *
 * Ce module exporte une fonction appelée DEPUIS le connection handler de
 * support.js (pas un io.on('connection') séparé) pour partager le même
 * socket.data.user déjà peuplé, sans risque de course entre deux handlers
 * de connexion indépendants.
 */

const db = require('../config/db');
const logger = require('../config/logger');

function enregistrerGestionnairesAppels(io, socket) {
  const { id: utilisateurId } = socket.data.user;

  /**
   * Récupère un ticket avec les utilisateur_id des deux participants
   * (client ET agent), pour pouvoir vérifier l'appartenance et déterminer
   * le destinataire sans jamais faire confiance au payload.
   */
  async function chargerParticipantsTicket(ticketId) {
    const resultat = await db.query(
      `SELECT t.id, t.statut, t.agent_id, c.utilisateur_id AS client_utilisateur_id
       FROM tickets t JOIN clients c ON c.id = t.client_id
       WHERE t.id = $1`,
      [ticketId]
    );
    return resultat.rows[0] || null;
  }

  // ========================================================================
  // ÉTAPE 1 — appel:initier (C→S)
  // "socket.emit('appel:initier', { ticketId, type, peerId })"
  // ========================================================================
  socket.on('appel:initier', async (payload, callback) => {
    try {
      const { ticketId, type, peerId } = payload;
      if (!['audio', 'video'].includes(type)) {
        return callback?.({ erreur: "Type d'appel invalide (audio ou video)." });
      }
      if (!peerId) return callback?.({ erreur: 'peerId manquant.' });

      const ticket = await chargerParticipantsTicket(ticketId);
      if (!ticket) return callback?.({ erreur: 'Ticket introuvable.' });

      // "L'appel ne peut être initié que si le ticket est en statut en_cours."
      if (ticket.statut !== 'en_cours') {
        return callback?.({ erreur: 'Le ticket doit être en_cours pour initier un appel.' });
      }

      // "Les participants sont nécessairement le client du ticket et
      //  l'agent assigné." — on vérifie que l'appelant est l'un des deux,
      //  et on détermine l'AUTRE comme destinataire (jamais depuis le payload).
      const estLeClient = utilisateurId === ticket.client_utilisateur_id;
      const estLAgent = utilisateurId === ticket.agent_id;
      if (!estLeClient && !estLAgent) {
        return callback?.({ erreur: "Vous n'êtes pas participant à ce ticket." });
      }

      const destinataireId = estLeClient ? ticket.agent_id : ticket.client_utilisateur_id;
      if (!destinataireId) {
        return callback?.({ erreur: 'Aucun agent assigné à ce ticket.' });
      }

      // ÉTAPE 2 — "INSERT appels en BDD"
      const resultat = await db.query(
        `INSERT INTO appels (ticket_id, initiateur_id, destinataire_id, type)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [ticketId, utilisateurId, destinataireId, type]
      );
      const appelId = resultat.rows[0].id;

      // ÉTAPE 2 (suite) — "socket.to(user:{destId}).emit('appel:entrant',
      //  { appelId, initiateur, peerId_init, type })"
      io.to(`user:${destinataireId}`).emit('appel:entrant', {
        appelId,
        initiateur: { id: utilisateurId, nom: socket.data.user.nom },
        peerId_init: peerId,
        type,
      });

      callback?.({ succes: true, appelId });
    } catch (erreur) {
      logger.error(`Erreur appel:initier : ${erreur.message}`);
      callback?.({ erreur: 'Erreur serveur.' });
    }
  });

  /** Vérifie que l'utilisateur courant est bien initiateur OU destinataire de cet appel. */
  async function chargerAppelSiParticipant(appelId) {
    const resultat = await db.query('SELECT * FROM appels WHERE id = $1', [appelId]);
    const appel = resultat.rows[0];
    if (!appel) return null;
    if (appel.initiateur_id !== utilisateurId && appel.destinataire_id !== utilisateurId) return null;
    return appel;
  }

  // ========================================================================
  // ÉTAPE 3-4 — appel:accepter (C→S) → appel:accepte (S→C)
  // "Accepte → getUserMedia() → socket.emit('appel:accepter', { appelId,
  //  peerId: monPeerId })" puis "socket.to(user:{initId}).emit('appel:accepte',
  //  { peerId_dest })"
  // ========================================================================
  socket.on('appel:accepter', async (payload, callback) => {
    try {
      const { appelId, peerId } = payload;
      const appel = await chargerAppelSiParticipant(appelId);
      if (!appel) return callback?.({ erreur: 'Appel introuvable ou accès refusé.' });

      await db.query(`UPDATE appels SET statut = 'accepte' WHERE id = $1`, [appelId]);

      io.to(`user:${appel.initiateur_id}`).emit('appel:accepte', { appelId, peerId_dest: peerId });
      callback?.({ succes: true });
    } catch (erreur) {
      logger.error(`Erreur appel:accepter : ${erreur.message}`);
      callback?.({ erreur: 'Erreur serveur.' });
    }
  });

  // ========================================================================
  // appel:refuser (C→S)
  // ========================================================================
  socket.on('appel:refuser', async (payload, callback) => {
    try {
      const { appelId } = payload;
      const appel = await chargerAppelSiParticipant(appelId);
      if (!appel) return callback?.({ erreur: 'Appel introuvable ou accès refusé.' });

      await db.query(`UPDATE appels SET statut = 'refuse', fin_le = NOW() WHERE id = $1`, [appelId]);

      io.to(`user:${appel.initiateur_id}`).emit('appel:refuse', { appelId });
      callback?.({ succes: true });
    } catch (erreur) {
      logger.error(`Erreur appel:refuser : ${erreur.message}`);
      callback?.({ erreur: 'Erreur serveur.' });
    }
  });

  // ========================================================================
  // appel:terminer (C→S)
  // "Calculer duree_secondes. UPDATE appels SET statut='termine',
  //  duree_secondes, fin_le. Notifier les deux parties."
  // ========================================================================
  socket.on('appel:terminer', async (payload, callback) => {
    try {
      const { appelId } = payload;
      const appel = await chargerAppelSiParticipant(appelId);
      if (!appel) return callback?.({ erreur: 'Appel introuvable ou accès refusé.' });

      // Calcul de la durée directement en SQL, à partir de l'horodatage
      // réel de début — fiable même si l'horloge du client a dérivé.
      const resultat = await db.query(
        `UPDATE appels
         SET statut = 'termine', fin_le = NOW(),
             duree_secondes = EXTRACT(EPOCH FROM (NOW() - debut_le))::int
         WHERE id = $1
         RETURNING duree_secondes`,
        [appelId]
      );
      const dureeSecondes = resultat.rows[0].duree_secondes;

      io.to(`user:${appel.initiateur_id}`).emit('appel:termine', { appelId, dureeSecondes });
      io.to(`user:${appel.destinataire_id}`).emit('appel:termine', { appelId, dureeSecondes });

      callback?.({ succes: true, dureeSecondes });
    } catch (erreur) {
      logger.error(`Erreur appel:terminer : ${erreur.message}`);
      callback?.({ erreur: 'Erreur serveur.' });
    }
  });

  // ========================================================================
  // appel:controle (C→S puis relayé S→C)
  // "Relayer { micro, video, partageEcran } à l'autre participant."
  // ========================================================================
  socket.on('appel:controle', async (payload) => {
    try {
      const { appelId, micro, video, partageEcran } = payload;
      const appel = await chargerAppelSiParticipant(appelId);
      if (!appel) return;

      const autreParticipant = utilisateurId === appel.initiateur_id ? appel.destinataire_id : appel.initiateur_id;
      io.to(`user:${autreParticipant}`).emit('appel:controle', { micro, video, partageEcran });
    } catch (erreur) {
      logger.error(`Erreur appel:controle : ${erreur.message}`);
    }
  });
}

module.exports = { enregistrerGestionnairesAppels };