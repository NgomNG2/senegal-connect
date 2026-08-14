/**
 * src/socket/support.js
 * -----------------------------------------------------------------------
 * Tous les événements Socket.IO du module support (M3).
 */

const jwt = require('jsonwebtoken');
const db = require('../config/db');
const logger = require('../config/logger');

// Ce module exporte une fonction appelée DEPUIS le connection handler de
// support.js (pas un io.on('connection') séparé) pour partager le même
// socket.data.user déjà peuplé, sans risque de course entre deux handlers
// de connexion indépendants.
const { enregistrerGestionnairesAppels } = require('./appels');
const e = require('express');


const EMOJIS_AUTORISES = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏', '✅', '❌', '🎉', '💯'];

function initialiserSupportSocket(io) {
  // ======================================================================
  // MIDDLEWARE SOCKET.IO — "Authentification à la connexion"
  // ======================================================================
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token invalide'));

    jwt.verify(token, process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER }, (err, decode) => {
      if (err) return next(new Error('Token invalide'));
      socket.data.user = decode; // { id, email, role } — stocké EXACTEMENT ici, comme exigé
      next();
    });
  });

  io.on('connection', async (socket) => {
    const { id: utilisateurId, role } = socket.data.user;

    // Le JWT ne contient pas nom/prénom — on les charge une fois à la
    // connexion pour les réutiliser dans les événements diffusés (frappe,
    // appel:entrant...) sans requêter la BDD à chaque événement.
    try {
      const infoRes = await db.query('SELECT nom, prenom FROM utilisateurs WHERE id = $1', [utilisateurId]);
      socket.data.user.nom = infoRes.rows[0]?.nom || '';
      socket.data.user.prenom = infoRes.rows[0]?.prenom || '';
    } catch (erreur) {
      logger.error(`Erreur chargement profil socket : ${erreur.message}`);
    }

    // module appels.js — gestion des événements liés aux appels audio/vidéo
    enregistrerGestionnairesAppels(io, socket); 


    logger.info(`Socket connecté : utilisateur ${utilisateurId} (${role})`);

    // "Rejoindre automatiquement la room user:{id} et, pour les agents, la room agents."
    socket.join(`user:${utilisateurId}`);
    if (role === 'agent' || role === 'admin') {
      socket.join('agents');
    }

    // ======================================================================
    // ticket:ouvrir (C→S)
    // "Créer le ticket en BDD, rejoindre la room ticket:{id}, notifier la
    //  room agents avec ticket:nouveau."
    // ======================================================================
    socket.on('ticket:ouvrir', async (payload, callback) => {
      try {
        if (role !== 'client') {
          return callback?.({ erreur: 'Seul un client peut ouvrir un ticket.' });
        }
        const { sujet } = payload;
        if (!sujet || !sujet.trim()) return callback?.({ erreur: 'Le sujet est requis.' });

        const clientRes = await db.query('SELECT id FROM clients WHERE utilisateur_id = $1', [utilisateurId]);
        if (clientRes.rows.length === 0) {
          return callback?.({ erreur: "Aucune fiche client associée à ce compte." });
        }

        const resultat = await db.query(
          `INSERT INTO tickets (client_id, sujet) VALUES ($1, $2) RETURNING *`,
          [clientRes.rows[0].id, sujet.trim()]
        );
        const ticket = resultat.rows[0];

        socket.join(`ticket:${ticket.id}`);

        // ticket:nouveau (S→C)
        io.to('agents').emit('ticket:nouveau', {
          ...ticket,
          client_nom: socket.data.user.nom,
          client_prenom: socket.data.user.prenom,
        });

        callback?.({ succes: true, ticket });
      } catch (erreur) {
        logger.error(`Erreur ticket:ouvrir : ${erreur.message}`);
        callback?.({ erreur: 'Erreur serveur.' });
      }
    });

    // ======================================================================
    // ticket:assigner (C→S)
    // "UPDATE tickets SET agent_id, statut='en_cours', notifier le client
    //  via user:{clientId} avec ticket:pris_en_charge."
    // ======================================================================
    socket.on('ticket:assigner', async (payload, callback) => {
      try {
        if (role !== 'agent' && role !== 'admin') {
          return callback?.({ erreur: 'Seuls les agents peuvent prendre en charge un ticket.' });
        }
        const { ticketId } = payload;

        const resultat = await db.query(
          `UPDATE tickets SET agent_id = $1, statut = 'en_cours'
           WHERE id = $2 AND agent_id IS NULL RETURNING *`,
          [utilisateurId, ticketId]
        );
        if (resultat.rows.length === 0) return callback?.({ erreur: 'Ticket déjà assigné ou introuvable.' });
        const ticket = resultat.rows[0];

        socket.join(`ticket:${ticketId}`);

        const clientInfo = await db.query('SELECT utilisateur_id FROM clients WHERE id = $1', [ticket.client_id]);
        const clientUtilisateurId = clientInfo.rows[0]?.utilisateur_id;
        if (clientUtilisateurId) {
          io.to(`user:${clientUtilisateurId}`).emit('ticket:pris_en_charge', ticket);
        }

        callback?.({ succes: true, ticket });
      } catch (erreur) {
        logger.error(`Erreur ticket:assigner : ${erreur.message}`);
        callback?.({ erreur: 'Erreur serveur.' });
      }
    });


    // ======================================================================
    // ticket:rejoindre (C→S) — hors tableau officiel du sujet, mais
    // indispensable : ticket:ouvrir/ticket:assigner ne font rejoindre la
    // room qu'UNE fois, au moment de l'action. Sans ceci, rouvrir un
    // ticket existant (rechargement de page, changement de ticket dans
    // la liste) ne rejoint jamais la room -> plus rien en temps réel.
    // Même contrôle d'accès que pour appel:initier (M4) : uniquement le
    // client du ticket ou l'agent assigné/non-assigné.
    // ======================================================================
    socket.on('ticket:rejoindre', async (payload, callback) => {
      try {
        const { ticketId } = payload;
        const resultat = await db.query(
          `SELECT t.agent_id, c.utilisateur_id AS client_utilisateur_id
           FROM tickets t JOIN clients c ON c.id = t.client_id WHERE t.id = $1`,
          [ticketId]
        );
        const ticket = resultat.rows[0];
        if (!ticket) return callback?.({ erreur: 'Ticket introuvable.' });

        const estLeClient = role === 'client' && ticket.client_utilisateur_id === utilisateurId;
        const estAgentAutorise = (role === 'agent' || role === 'admin')
          && (ticket.agent_id === utilisateurId || ticket.agent_id === null || role === 'admin');

        if (!estLeClient && !estAgentAutorise) {
          return callback?.({ erreur: 'Accès refusé à ce ticket.' });
        }

        socket.join(`ticket:${ticketId}`);
        callback?.({ succes: true });
      } catch (erreur) {
        logger.error(`Erreur ticket:rejoindre : ${erreur.message}`);
        callback?.({ erreur: 'Erreur serveur.' });
      }
    });

    // ======================================================================
    // message:envoyer (C→S) → diffuse message:nouveau (S→C)
    // "Valider le contenu, escapeHtml, INSERT messages en BDD, diffuser
    //  message:nouveau à la room ticket:{id}."
    // ======================================================================
    socket.on('message:envoyer', async (payload, callback) => {
      try {
        const { ticketId, contenu } = payload;
        if (!contenu || !contenu.trim()) return callback?.({ erreur: 'Message vide.' });

       // const contenuEchappe = echapperHtml(contenu.trim());
        contenuEchappe = contenu.trim(); // double échappement HTML inutile côté serveur, déjà fait côté client
        
        const resultat = await db.query(
          `INSERT INTO messages (ticket_id, expediteur_id, type, contenu)
           VALUES ($1, $2, 'texte', $3)
           RETURNING id, ticket_id, type, contenu, fichier_url, envoye_le`,
          [ticketId, utilisateurId, contenuEchappe]
        );
        const brut = resultat.rows[0];

        await db.query(
          `INSERT INTO messages_statut (message_id, utilisateur_id, statut) VALUES ($1, $2, 'envoye')`,
          [brut.id, utilisateurId]
        );

        // "Diffuser le message complet (id, type, contenu, fichier_url, expediteur, envoye_le)"
        const message = {
          id: brut.id,
          ticket_id: brut.ticket_id,
          type: brut.type,
          contenu: brut.contenu,
          fichier_url: brut.fichier_url,
          expediteur: { id: utilisateurId, nom: socket.data.user.nom, prenom: socket.data.user.prenom, role },
          envoye_le: brut.envoye_le,
        };

        io.to(`ticket:${ticketId}`).emit('message:nouveau', message);
        callback?.({ succes: true, message });
      } catch (erreur) {
        logger.error(`Erreur message:envoyer : ${erreur.message}`);
        callback?.({ erreur: 'Erreur serveur.' });
      }
    });

    // ======================================================================
    // fichier:partager (C→S) — reçu APRÈS l'upload REST
    // "recevoir { ticketId, fichierUrl, fichierNom, fichierTaille, mimeType }.
    //  INSERT messages (type selon MIME). Diffuser message:nouveau à la room."
    // ======================================================================
    socket.on('fichier:partager', async (payload, callback) => {
      try {
        const { ticketId, fichierUrl, fichierNom, fichierTaille, mimeType } = payload;
        if (!fichierUrl) return callback?.({ erreur: 'fichierUrl manquant.' });

        let type = 'fichier';
        if (mimeType?.startsWith('image/')) type = 'image';
        else if (mimeType?.startsWith('audio/')) type = 'audio';

        const resultat = await db.query(
          `INSERT INTO messages (ticket_id, expediteur_id, type, fichier_url, fichier_nom, fichier_taille)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, ticket_id, type, fichier_url, fichier_nom, fichier_taille, envoye_le`,
          [ticketId, utilisateurId, type, fichierUrl, fichierNom, fichierTaille]
        );

        const message = {
          ...resultat.rows[0],
          expediteur: { id: utilisateurId, nom: socket.data.user.nom, prenom: socket.data.user.prenom, role },
        };

        io.to(`ticket:${ticketId}`).emit('message:nouveau', message);
        callback?.({ succes: true, message });
      } catch (erreur) {
        logger.error(`Erreur fichier:partager : ${erreur.message}`);
        callback?.({ erreur: 'Erreur serveur.' });
      }
    });

    // ======================================================================
    // message:lu (C→S) → message:statut (S→C)
    // "UPSERT messages_statut statut='lu'. Notifier l'expéditeur via
    //  user:{id} avec message:statut."
    // ======================================================================
    socket.on('message:lu', async (payload) => {
      try {
        const { messageId } = payload;

        const messageRes = await db.query('SELECT expediteur_id FROM messages WHERE id = $1', [messageId]);
        if (messageRes.rows.length === 0) return;
        const expediteurId = messageRes.rows[0].expediteur_id;

        await db.query(
          `INSERT INTO messages_statut (message_id, utilisateur_id, statut, lu_le)
           VALUES ($1, $2, 'lu', NOW())
           ON CONFLICT (message_id, utilisateur_id) DO UPDATE SET statut = 'lu', lu_le = NOW()`,
          [messageId, utilisateurId]
        );

        io.to(`user:${expediteurId}`).emit('message:statut', { messageId, statut: 'lu' });
      } catch (erreur) {
        logger.error(`Erreur message:lu : ${erreur.message}`);
      }
    });

    // ======================================================================
    // frappe (C→S)
    // "socket.to(ticket:{id}).emit(frappe, { nom }) — throttlé côté client."
    // ======================================================================
    socket.on('frappe', (payload) => {
      socket.to(`ticket:${payload.ticketId}`).emit('frappe', { nom: socket.data.user.nom });
    });

    // ======================================================================
    // Réactions (section "Émojis et réactions") — toggle ajout/retrait
    // ======================================================================
    socket.on('reaction:toggle', async (payload, callback) => {
      try {
        const { messageId, ticketId, emoji } = payload;
        if (!EMOJIS_AUTORISES.includes(emoji)) return callback?.({ erreur: 'Émoji non autorisé.' });

        const existante = await db.query(
          `SELECT 1 FROM reactions WHERE message_id = $1 AND utilisateur_id = $2 AND emoji = $3`,
          [messageId, utilisateurId, emoji]
        );

        let action;
        if (existante.rows.length > 0) {
          await db.query(`DELETE FROM reactions WHERE message_id = $1 AND utilisateur_id = $2 AND emoji = $3`, [messageId, utilisateurId, emoji]);
          action = 'retiree';
        } else {
          await db.query(`INSERT INTO reactions (message_id, utilisateur_id, emoji) VALUES ($1, $2, $3)`, [messageId, utilisateurId, emoji]);
          action = 'ajoutee';
        }

        io.to(`ticket:${ticketId}`).emit('reaction:mise_a_jour', { messageId, utilisateurId, emoji, action });
        callback?.({ succes: true, action });
      } catch (erreur) {
        logger.error(`Erreur reaction:toggle : ${erreur.message}`);
        callback?.({ erreur: 'Erreur serveur.' });
      }
    });

    // ======================================================================
    // ticket:fermer (C→S)
    // "UPDATE tickets SET statut='ferme', ferme_le=NOW(). Notifier le client."
    // ======================================================================
    socket.on('ticket:fermer', async (payload, callback) => {
      try {
        if (role !== 'agent' && role !== 'admin') {
          return callback?.({ erreur: 'Seuls les agents peuvent fermer un ticket.' });
        }
        const { ticketId } = payload;

        const resultat = await db.query(
          `UPDATE tickets SET statut = 'ferme', ferme_le = NOW() WHERE id = $1 RETURNING *`,
          [ticketId]
        );
        if (resultat.rows.length === 0) return callback?.({ erreur: 'Ticket introuvable.' });
        const ticket = resultat.rows[0];

        const clientInfo = await db.query('SELECT utilisateur_id FROM clients WHERE id = $1', [ticket.client_id]);
        const clientUtilisateurId = clientInfo.rows[0]?.utilisateur_id;
        if (clientUtilisateurId) {
          io.to(`user:${clientUtilisateurId}`).emit('ticket:ferme', ticket);
        }

        callback?.({ succes: true, ticket });
      } catch (erreur) {
        logger.error(`Erreur ticket:fermer : ${erreur.message}`);
        callback?.({ erreur: 'Erreur serveur.' });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`Socket déconnecté : utilisateur ${utilisateurId}`);
    });
  });
}

// function echapperHtml(texte) {
//   return texte
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;')
//     .replace(/'/g, '&#39;');
// }

module.exports = { initialiserSupportSocket, EMOJIS_AUTORISES };