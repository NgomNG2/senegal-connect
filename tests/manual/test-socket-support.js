/**
 * tests/manual/test-socket-support.js
 * -----------------------------------------------------------------------
 * Test de bout en bout du module Socket.IO (M3), avec deux VRAIES
 * connexions simultanées (un client, un agent) contre un serveur qui
 * tourne réellement — pas des mocks. Vérifie l'enchaînement complet du
 * scénario du sujet : ouverture de ticket → prise en charge → message →
 * accusé de lecture → frappe → réaction → fermeture.
 *
 * Prérequis :
 *  1. Le serveur doit tourner : npm run dev (dans un autre terminal)
 *  2. La base doit être seedée : npm run db:reset:seed
 *     (ce script utilise le client "Awa Diouf" id=4 et l'agent
 *      "Fatou Ndiaye" id=2 des données de démo)
 *
 * Usage : node tests/manual/test-socket-support.js
 */

require('dotenv').config();
const { io: ioClient } = require('socket.io-client');
const jwt = require('jsonwebtoken');

const URL_SERVEUR = process.env.SOCKET_TEST_URL || 'http://localhost:3000';
const DELAI_MAX_MS = 5000;

let echecs = 0;

function verifier(condition, description) {
  if (condition) {
    console.log(`✅ ${description}`);
  } else {
    console.error(`❌ ${description}`);
    echecs++;
  }
}

function genererToken(id, role) {
  return jwt.sign({ id, email: `${role}@test.sn`, role }, process.env.JWT_SECRET, {
    expiresIn: '1h',
    issuer: process.env.JWT_ISSUER,
  });
}

/** Attend UN événement précis sur un socket, avec timeout. */
function attendreEvenement(socket, evenement, delaiMs = DELAI_MAX_MS) {
  return new Promise((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new Error(`Timeout en attendant "${evenement}"`)), delaiMs);
    socket.once(evenement, (payload) => {
      clearTimeout(minuteur);
      resolve(payload);
    });
  });
}

/** Emet un événement avec callback (ack), en Promise. */
function emettreAvecCallback(socket, evenement, payload, delaiMs = DELAI_MAX_MS) {
  return new Promise((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new Error(`Timeout ack pour "${evenement}"`)), delaiMs);
    socket.emit(evenement, payload, (reponse) => {
      clearTimeout(minuteur);
      resolve(reponse);
    });
  });
}

async function main() {
  console.log(`\n=== Test Socket.IO — Module M3 (support) ===`);
  console.log(`Serveur : ${URL_SERVEUR}\n`);

  // Awa Diouf (client, id=4) et Fatou Ndiaye (agent, id=2) — comptes de démo
  const tokenClient = genererToken(4, 'client');
  const tokenAgent = genererToken(2, 'agent');

  const socketClient = ioClient(URL_SERVEUR, { auth: { token: tokenClient }, transports: ['websocket'] });
  const socketAgent = ioClient(URL_SERVEUR, { auth: { token: tokenAgent }, transports: ['websocket'] });

  try {
    // ------------------------------------------------------------------
    // 1. Connexion — middleware io.use()
    // ------------------------------------------------------------------
    await Promise.all([attendreEvenement(socketClient, 'connect'), attendreEvenement(socketAgent, 'connect')]);
    verifier(socketClient.connected, 'Client connecté (token valide accepté)');
    verifier(socketAgent.connected, 'Agent connecté (token valide accepté)');

    // Petite marge après la connexion : laisse le temps au handler
    // connection (chargement nom/prénom en BDD) de terminer côté serveur
    // avant d'enchaîner sur les événements métier.
    await new Promise((r) => setTimeout(r, 300));

    // Test du rejet : token invalide doit déclencher connect_error
    const socketInvalide = ioClient(URL_SERVEUR, { auth: { token: 'ceci.nest.pasunjwt' }, transports: ['websocket'] });
    const erreurConnexion = await attendreEvenement(socketInvalide, 'connect_error').catch(() => null);
    verifier(erreurConnexion?.message === 'Token invalide', 'Token invalide rejeté avec le message "Token invalide"');
    socketInvalide.close();

    // ------------------------------------------------------------------
    // 2. ticket:ouvrir → ticket:nouveau (room agents)
    // ------------------------------------------------------------------
    const promesseTicketNouveau = attendreEvenement(socketAgent, 'ticket:nouveau');
    const reponseOuvrir = await emettreAvecCallback(socketClient, 'ticket:ouvrir', { sujet: 'Test - facture incorrecte' });
    verifier(reponseOuvrir.succes === true, 'ticket:ouvrir renvoie succes=true');
    verifier(typeof reponseOuvrir.ticket?.id === 'number', 'ticket:ouvrir renvoie un ticket avec id');

    const ticketNouveau = await promesseTicketNouveau;
    verifier(ticketNouveau.id === reponseOuvrir.ticket.id, "L'agent reçoit ticket:nouveau avec le bon id");

    const ticketId = reponseOuvrir.ticket.id;

    // ------------------------------------------------------------------
    // 3. ticket:assigner → ticket:pris_en_charge (user:{clientId})
    // ------------------------------------------------------------------
    const promessePrisEnCharge = attendreEvenement(socketClient, 'ticket:pris_en_charge');
    const reponseAssigner = await emettreAvecCallback(socketAgent, 'ticket:assigner', { ticketId });
    verifier(reponseAssigner.succes === true, 'ticket:assigner renvoie succes=true');

    const ticketPrisEnCharge = await promessePrisEnCharge;
    verifier(ticketPrisEnCharge.statut === 'en_cours', 'Le client reçoit ticket:pris_en_charge avec statut=en_cours');

    // ------------------------------------------------------------------
    // 4. message:envoyer → message:nouveau (room ticket)
    // ------------------------------------------------------------------
    const promesseMessageNouveau = attendreEvenement(socketAgent, 'message:nouveau');
    const reponseMessage = await emettreAvecCallback(socketClient, 'message:envoyer', {
      ticketId,
      contenu: 'Bonjour, ma facture est incorrecte <script>alert(1)</script>',
    });
    verifier(reponseMessage.succes === true, 'message:envoyer renvoie succes=true');

    const messageRecu = await promesseMessageNouveau;
    verifier(messageRecu.contenu.includes('&lt;script&gt;'), 'Le contenu est bien échappé (escapeHtml) avant diffusion');
    verifier(messageRecu.expediteur?.id === 4, 'Le message reçu contient bien expediteur.id');

    const messageId = reponseMessage.message.id;

    // ------------------------------------------------------------------
    // 5. message:lu → message:statut (user:{expediteurId})
    // ------------------------------------------------------------------
    const promesseStatut = attendreEvenement(socketClient, 'message:statut');
    socketAgent.emit('message:lu', { messageId });
    const statutRecu = await promesseStatut;
    verifier(statutRecu.statut === 'lu', "L'expéditeur reçoit message:statut avec statut=lu");

    // ------------------------------------------------------------------
    // 6. frappe (relais direct, pas de persistance)
    // ------------------------------------------------------------------
    const promesseFrappe = attendreEvenement(socketAgent, 'frappe');
    socketClient.emit('frappe', { ticketId });
    const frappeRecue = await promesseFrappe;
    verifier(typeof frappeRecue.nom === 'string' && frappeRecue.nom.length > 0, 'frappe relayée avec le nom de l\'émetteur');

    // ------------------------------------------------------------------
    // 7. reaction:toggle (ajout puis retrait)
    // ------------------------------------------------------------------
    const promesseReactionAjout = attendreEvenement(socketClient, 'reaction:mise_a_jour');
    const reponseReaction1 = await emettreAvecCallback(socketAgent, 'reaction:toggle', { messageId, ticketId, emoji: '👍' });
    verifier(reponseReaction1.action === 'ajoutee', 'Premier clic sur un émoji → action="ajoutee"');
    await promesseReactionAjout;

    const reponseReaction2 = await emettreAvecCallback(socketAgent, 'reaction:toggle', { messageId, ticketId, emoji: '👍' });
    verifier(reponseReaction2.action === 'retiree', 'Deuxième clic sur le même émoji → action="retiree" (toggle)');

    const reponseEmojiInterdit = await emettreAvecCallback(socketAgent, 'reaction:toggle', { messageId, ticketId, emoji: '🍕' });
    verifier(reponseEmojiInterdit.erreur !== undefined, 'Émoji hors liste blanche → erreur');

    // ------------------------------------------------------------------
    // 8. ticket:fermer → ticket:ferme (user:{clientId})
    // ------------------------------------------------------------------
    const promesseFerme = attendreEvenement(socketClient, 'ticket:ferme');
    const reponseFermer = await emettreAvecCallback(socketAgent, 'ticket:fermer', { ticketId });
    verifier(reponseFermer.succes === true, 'ticket:fermer renvoie succes=true');

    const ticketFerme = await promesseFerme;
    verifier(ticketFerme.statut === 'ferme', 'Le client reçoit ticket:ferme avec statut=ferme');

    // ------------------------------------------------------------------
    // 9. Contrôle d'accès — un client ne peut pas fermer un ticket
    // ------------------------------------------------------------------
    const reponseFermetureRefusee = await emettreAvecCallback(socketClient, 'ticket:fermer', { ticketId });
    verifier(reponseFermetureRefusee.erreur !== undefined, "Un client ne peut pas fermer un ticket (erreur renvoyée)");
  } catch (erreur) {
    console.error(`\n💥 Erreur pendant le test : ${erreur.message}`);
    echecs++;
  } finally {
    socketClient.close();
    socketAgent.close();
  }

  console.log(`\n=== Résultat : ${echecs === 0 ? '✅ TOUT PASSE' : `❌ ${echecs} échec(s)`} ===\n`);
  process.exit(echecs === 0 ? 0 : 1);
}

main();