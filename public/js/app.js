/**
 * public/js/app.js — logique cliente principale : auth, Socket.IO,
 * tickets, chat, fichiers, réactions, clients. Expose `socket` et
 * `window.utilisateurCourant`, utilisés par webrtc.js (chargé avant ce
 * fichier — voir index.html).
 */

let socket = null;
let ticketActifId = null;
let ticketActifStatut = null;
let jetonAcces = null;
let dernierEnvoiFrappe = 0;

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏', '✅', '❌', '🎉', '💯'];

function enTetesAuth() {
  return jetonAcces ? { Authorization: `Bearer ${jetonAcces}` } : {};
}

// ============================================================================
// UTILITAIRES — définis en premier car utilisés partout, y compris par
// webrtc.js (afficherSonnerie, afficherEcranAppel, masquerEcranAppel,
// afficherNotification sont appelés depuis des fonctions de webrtc.js).
// ============================================================================
function echapper(texte) {
  const div = document.createElement('div');
  div.textContent = texte ?? '';
  return div.innerHTML;
}

function afficherNotification(message, type = 'info') {
  const zone = document.getElementById('zone-notifications');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  zone.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function afficherSonnerie(nomAppelant, type) {
  document.getElementById('appelant-nom').textContent = nomAppelant;
  document.getElementById('appelant-type').textContent = type === 'video' ? 'vidéo' : 'audio';
  document.getElementById('bandeau-appel-entrant').classList.remove('cache');
}
function afficherEcranAppel() {
  document.getElementById('bandeau-appel-entrant').classList.add('cache');
  document.getElementById('overlay-appel').classList.remove('cache');
}
function masquerEcranAppel() {
  document.getElementById('overlay-appel').classList.add('cache');
  document.getElementById('chronometre').textContent = '00:00';
  document.getElementById('bouton-micro').classList.remove('actif');
  document.getElementById('bouton-camera').classList.remove('actif');
  document.getElementById('bouton-partage-ecran').classList.remove('actif');
}

// ============================================================================
// BASCULE LOGIN / REGISTER
// ============================================================================
document.querySelectorAll('.onglet').forEach((bouton) => {
  bouton.addEventListener('click', () => {
    document.querySelectorAll('.onglet').forEach((b) => { b.classList.remove('actif'); b.setAttribute('aria-selected', 'false'); });
    bouton.classList.add('actif');
    bouton.setAttribute('aria-selected', 'true');
    const cible = bouton.dataset.onglet;
    document.getElementById('formulaire-login').classList.toggle('cache', cible !== 'login');
    document.getElementById('formulaire-register').classList.toggle('cache', cible !== 'register');
  });
});

// ============================================================================
// CONNEXION / INSCRIPTION
// ============================================================================
document.getElementById('formulaire-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const mot_de_passe = document.getElementById('login-mot-de-passe').value;
  const erreurEl = document.getElementById('login-erreur');
  erreurEl.textContent = '';

  try {
    const reponse = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, mot_de_passe }),
    });
    const donnees = await reponse.json();
    if (!reponse.ok) { erreurEl.textContent = donnees.erreur || 'Erreur de connexion.'; return; }

    jetonAcces = donnees.token;
    window.utilisateurCourant = donnees.utilisateur;
    localStorage.setItem('sc_token', jetonAcces);
    demarrerApplication();
  } catch (erreur) {
    console.error('Erreur login:', erreur);
    erreurEl.textContent = 'Impossible de contacter le serveur.';
  }
});

document.getElementById('formulaire-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erreurEl = document.getElementById('register-erreur');
  erreurEl.textContent = '';

  const corps = {
    nom: document.getElementById('register-nom').value.trim(),
    prenom: document.getElementById('register-prenom').value.trim(),
    email: document.getElementById('register-email').value.trim(),
    mot_de_passe: document.getElementById('register-mot-de-passe').value,
    role: document.querySelector('input[name="role"]:checked').value,
  };

  try {
    const reponse = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });
    const donnees = await reponse.json();
    if (!reponse.ok) {
      erreurEl.textContent = donnees.details?.champs?.[0]?.message || donnees.erreur || 'Erreur lors de la création du compte.';
      return;
    }
    jetonAcces = donnees.token;
    window.utilisateurCourant = donnees.utilisateur;
    localStorage.setItem('sc_token', jetonAcces);
    demarrerApplication();
  } catch (erreur) {
    console.error('Erreur register:', erreur);
    erreurEl.textContent = 'Impossible de contacter le serveur.';
  }
});

document.getElementById('bouton-deconnexion').addEventListener('click', () => {
  localStorage.removeItem('sc_token');
  socket?.disconnect();
  window.location.reload();
});

window.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('sc_token');
  if (!token) return;
  jetonAcces = token;
  try {
    const reponse = await fetch('/api/auth/profil', { headers: enTetesAuth() });
    if (!reponse.ok) throw new Error('Token invalide ou expiré');
    window.utilisateurCourant = (await reponse.json()).utilisateur;
    demarrerApplication();
  } catch (erreur) {
    console.warn('Session expirée:', erreur.message);
    localStorage.removeItem('sc_token');
  }
});

function demarrerApplication() {
  document.getElementById('ecran-auth').classList.add('cache');
  document.getElementById('ecran-app').classList.remove('cache');

  const { prenom, nom, role } = window.utilisateurCourant;
  document.getElementById('nom-utilisateur-connecte').textContent = `${prenom} ${nom}`;
  document.getElementById('badge-role').textContent = role;
  document.getElementById('avatar-utilisateur').textContent = `${(prenom[0] || '')}${(nom[0] || '')}`.toUpperCase();

  if (role === 'client') {
    document.getElementById('colonne-clients').classList.add('cache');
    document.getElementById('ecran-app').classList.add('role-client');
  } else {
    chargerClients();
  }

  connecterSocket();
  chargerTickets();
}

// ============================================================================
// SOCKET.IO
// ============================================================================
function connecterSocket() {
  socket = io({ auth: { token: jetonAcces } });

  const statutEl = document.getElementById('statut-connexion');
  const texteStatut = document.getElementById('texte-statut-connexion');

  socket.on('connect', () => {
    statutEl.classList.add('en-ligne'); statutEl.classList.remove('hors-ligne');
    texteStatut.textContent = 'En ligne';
  });
  socket.on('disconnect', () => {
    statutEl.classList.add('hors-ligne'); statutEl.classList.remove('en-ligne');
    texteStatut.textContent = 'Hors ligne';
  });
  socket.on('connect_error', (err) => {
    console.error('Erreur connexion Socket.IO:', err.message);
    afficherNotification(`Connexion temps réel refusée : ${err.message}`, 'erreur');
  });

  socket.on('ticket:nouveau', (ticket) => { afficherNotification(`Nouveau ticket : ${ticket.sujet}`, 'info'); chargerTickets(); });
  socket.on('ticket:pris_en_charge', (ticket) => {
    afficherNotification('Votre ticket a été pris en charge.', 'info');
    chargerTickets();
    if (ticket.id === ticketActifId) ouvrirTicket(ticket.id);
  });
  socket.on('ticket:ferme', (ticket) => {
    afficherNotification('Le ticket a été fermé.', 'info');
    chargerTickets();
    if (ticket.id === ticketActifId) ouvrirTicket(ticket.id);
  });

  socket.on('message:nouveau', (message) => {
    if (message.ticket_id === ticketActifId) {
      afficherMessage(message);
      if (message.expediteur?.id !== window.utilisateurCourant.id) {
        socket.emit('message:lu', { messageId: message.id });
      }
      const fil = document.getElementById('fil-messages');
      fil.scrollTop = fil.scrollHeight;
    } else {
      afficherNotification('Nouveau message reçu.', 'info');
    }
  });

  socket.on('message:statut', ({ messageId, statut }) => {
    const el = document.querySelector(`[data-message-id="${messageId}"] .accuse`);
    if (el && statut === 'lu') el.textContent = '✓✓';
  });

  socket.on('frappe', ({ nom }) => {
    const el = document.getElementById('indicateur-frappe');
    el.textContent = `${nom} est en train d'écrire…`;
    el.classList.remove('cache');
    clearTimeout(el._minuteur);
    el._minuteur = setTimeout(() => el.classList.add('cache'), 2500);
  });

  socket.on('reaction:mise_a_jour', ({ messageId }) => rafraichirReactionsDepuisServeur(messageId));
  socket.on('notification:push', (notif) => afficherNotification(notif.message, 'info'));

  // Écouteurs spécifiques aux appels — définis dans webrtc.js, enregistrés
  // ICI (socket garanti non-null à cet instant).
  attacherEcouteursAppelsSocket(socket);
}

// ============================================================================
// TICKETS
// ============================================================================
async function chargerTickets() {
  try {
    const reponse = await fetch('/api/tickets', { headers: enTetesAuth() });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    const { donnees } = await reponse.json();

    const liste = document.getElementById('liste-tickets');
    liste.innerHTML = '';
    document.getElementById('tickets-vide').classList.toggle('cache', donnees.length > 0);

    donnees.forEach((ticket) => {
      const li = document.createElement('li');
      li.className = 'item-ticket';
      li.dataset.ticketId = ticket.id;
      li.innerHTML = `
        <strong>${echapper(ticket.sujet)}</strong>
        <span class="badge-statut badge-${ticket.statut}">${ticket.statut}</span>
        <small>${echapper(ticket.client_prenom || '')} ${echapper(ticket.client_nom || '')}</small>
      `;
      li.addEventListener('click', () => ouvrirTicket(ticket.id));
      liste.appendChild(li);
    });
  } catch (erreur) {
    console.error('Erreur chargement tickets:', erreur);
    afficherNotification('Impossible de charger les tickets.', 'erreur');
  }
}

document.getElementById('bouton-nouveau-ticket').addEventListener('click', () => document.getElementById('modale-nouveau-ticket').classList.remove('cache'));
document.getElementById('bouton-annuler-ticket').addEventListener('click', () => document.getElementById('modale-nouveau-ticket').classList.add('cache'));
document.getElementById('bouton-confirmer-ticket').addEventListener('click', () => {
  const sujet = document.getElementById('nouveau-ticket-sujet').value.trim();
  if (!sujet) return;
  socket.emit('ticket:ouvrir', { sujet }, (reponse) => {
    if (reponse.erreur) return afficherNotification(reponse.erreur, 'erreur');
    document.getElementById('modale-nouveau-ticket').classList.add('cache');
    document.getElementById('nouveau-ticket-sujet').value = '';
    chargerTickets();
    ouvrirTicket(reponse.ticket.id);
  });
});

async function ouvrirTicket(ticketId) {
  ticketActifId = ticketId;
  document.querySelectorAll('.item-ticket').forEach((el) => el.classList.toggle('actif', Number(el.dataset.ticketId) === ticketId));

  // Indispensable : rejoint la room ticket:{id} pour recevoir la suite en
  // temps réel (voir explication en tête de src/socket/support.js).
  socket.emit('ticket:rejoindre', { ticketId }, (reponse) => {
    if (reponse?.erreur) afficherNotification(reponse.erreur, 'erreur');
  });

  try {
    const [messagesRes, ticketsRes] = await Promise.all([
      fetch(`/api/tickets/${ticketId}/messages`, { headers: enTetesAuth() }),
      fetch('/api/tickets', { headers: enTetesAuth() }),
    ]);
    const { donnees: messages } = await messagesRes.json();
    const ticket = (await ticketsRes.json()).donnees.find((t) => t.id === ticketId);
    ticketActifStatut = ticket?.statut || null;

    document.getElementById('chat-vide').classList.add('cache');
    document.getElementById('chat-actif').classList.remove('cache');
    document.getElementById('chat-numero-salon').textContent = `Ticket #${ticketId}`;
    document.getElementById('chat-sujet').textContent = ticket?.sujet || '';
    const statutEl = document.getElementById('chat-statut');
    statutEl.textContent = ticket?.statut || '';
    statutEl.className = `badge-statut badge-${ticket?.statut}`;

    const estClient = window.utilisateurCourant.role === 'client';
    document.getElementById('bouton-prendre-en-charge').classList.toggle('cache', estClient || !!ticket?.agent_id);
    document.getElementById('bouton-fermer-ticket').classList.toggle('cache', estClient || ticket?.statut === 'ferme');

    // "L'appel ne peut être initié que si le ticket est en_cours" (M4) —
    // on cache carrément les boutons plutôt que de laisser l'utilisateur
    // cliquer pour se prendre un message d'erreur évitable.
    document.getElementById('boutons-appel').classList.toggle('cache', ticket?.statut !== 'en_cours');

    const fil = document.getElementById('fil-messages');
    fil.innerHTML = '';
    messages.forEach(afficherMessage);
    fil.scrollTop = fil.scrollHeight;
  } catch (erreur) {
    console.error('Erreur ouverture ticket:', erreur);
    afficherNotification('Impossible de charger ce ticket.', 'erreur');
  }
}

document.getElementById('bouton-prendre-en-charge').addEventListener('click', () => {
  socket.emit('ticket:assigner', { ticketId: ticketActifId }, (reponse) => {
    if (reponse.erreur) return afficherNotification(reponse.erreur, 'erreur');
    ouvrirTicket(ticketActifId);
  });
});
document.getElementById('bouton-fermer-ticket').addEventListener('click', () => {
  socket.emit('ticket:fermer', { ticketId: ticketActifId }, (reponse) => {
    if (reponse.erreur) return afficherNotification(reponse.erreur, 'erreur');
    ouvrirTicket(ticketActifId);
  });
});

// ============================================================================
// HISTORIQUE DES APPELS — "visible dans l'interface et via
// GET /api/tickets/:id/appels" (exigence M4 explicite)
// ============================================================================
document.getElementById('bouton-historique-appels').addEventListener('click', async () => {
  if (!ticketActifId) return;
  try {
    const reponse = await fetch(`/api/tickets/${ticketActifId}/appels`, { headers: enTetesAuth() });
    const { donnees } = await reponse.json();

    const liste = document.getElementById('liste-historique-appels');
    liste.innerHTML = '';
    document.getElementById('historique-appels-vide').classList.toggle('cache', donnees.length > 0);

    donnees.forEach((appel) => {
      const li = document.createElement('li');
      const duree = appel.duree_secondes != null
        ? `${String(Math.floor(appel.duree_secondes / 60)).padStart(2, '0')}:${String(appel.duree_secondes % 60).padStart(2, '0')}`
        : '—';
      const date = new Date(appel.debut_le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      li.innerHTML = `
        <strong>${appel.type === 'video' ? 'Appel vidéo' : 'Appel audio'}</strong>
        <span class="badge-statut badge-${appel.statut === 'termine' ? 'ferme' : 'en_cours'}">${appel.statut}</span>
        <small>${date} — ${echapper(appel.initiateur_nom)} → ${echapper(appel.destinataire_nom)} — durée ${duree}</small>
      `;
      liste.appendChild(li);
    });

    document.getElementById('modale-historique-appels').classList.remove('cache');
  } catch (erreur) {
    console.error('Erreur historique appels:', erreur);
    afficherNotification("Impossible de charger l'historique des appels.", 'erreur');
  }
});
document.getElementById('bouton-fermer-historique').addEventListener('click', () => {
  document.getElementById('modale-historique-appels').classList.add('cache');
});

// ============================================================================
// MESSAGES
// ============================================================================
function afficherMessage(message) {
  const fil = document.getElementById('fil-messages');
  const estMoi = message.expediteur?.id === window.utilisateurCourant.id;

  const div = document.createElement('div');
  div.className = `bulle-message ${estMoi ? 'de-moi' : 'de-autre'}`;
  div.dataset.messageId = message.id;

  // Affichage adapté selon le type — image en miniature, audio avec
  // lecteur intégré, autre fichier en lien téléchargeable avec icône.
  let contenuHtml = '';
  if (message.type === 'texte') {
    contenuHtml = `<p>${echapper(message.contenu || '')}</p>`;
  } else if (message.type === 'image') {
    contenuHtml = `<img class="piece-jointe" src="${message.fichier_url}" alt="Image partagée" />`;
  } else if (message.type === 'audio') {
    contenuHtml = `<audio controls src="${message.fichier_url}"></audio>`;
  } else {
    contenuHtml = `<a class="piece-jointe-fichier" href="${message.fichier_url}" target="_blank" rel="noopener">📄 ${echapper(message.fichier_nom || 'fichier')}</a>`;
  }

  const heure = new Date(message.envoye_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `
    ${contenuHtml}
    <div class="meta-message"><span class="heure">${heure}</span>${estMoi ? '<span class="accuse">✓</span>' : ''}</div>
    <div class="reactions" data-message-id="${message.id}"></div>
  `;

  // Double-clic pour réagir — plutôt qu'un bouton dédié, garde le rendu
  // du message compact.
  div.addEventListener('dblclick', () => {
    const sel = document.getElementById('selecteur-emoji');
    sel.dataset.messageCible = message.id;
    sel.innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join('');
    sel.classList.remove('cache');
  });

  fil.appendChild(div);
  rafraichirReactions(message.id, message.reactions);
}

function rafraichirReactions(messageId, reactionsConnues) {
  const conteneur = document.querySelector(`.reactions[data-message-id="${messageId}"]`);
  if (!conteneur) return;
  const comptes = {};
  (reactionsConnues || []).forEach((r) => (comptes[r.emoji] = (comptes[r.emoji] || 0) + 1));
  conteneur.innerHTML = Object.entries(comptes).map(([emoji, n]) => `<span class="puce-reaction">${emoji} ${n}</span>`).join(' ');
}

// Après un événement reaction:mise_a_jour, on n'a pas la liste complète —
// on recharge simplement l'historique du ticket courant (léger, pas de
// state management dédié pour ce projet).
async function rafraichirReactionsDepuisServeur() {
  if (!ticketActifId) return;
  try {
    const reponse = await fetch(`/api/tickets/${ticketActifId}/messages`, { headers: enTetesAuth() });
    const { donnees } = await reponse.json();
    donnees.forEach((m) => rafraichirReactions(m.id, m.reactions));
  } catch (erreur) {
    console.warn('Rafraîchissement réactions échoué:', erreur);
  }
}

document.getElementById('bouton-emoji').addEventListener('click', () => {
  const sel = document.getElementById('selecteur-emoji');
  delete sel.dataset.messageCible;
  sel.innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join('');
  sel.classList.toggle('cache');
});

document.getElementById('selecteur-emoji').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  const emoji = e.target.textContent;
  const cible = document.getElementById('selecteur-emoji').dataset.messageCible;
  if (cible) socket.emit('reaction:toggle', { messageId: Number(cible), ticketId: ticketActifId, emoji });
  else document.getElementById('champ-message').value += emoji;
  document.getElementById('selecteur-emoji').classList.add('cache');
});

document.getElementById('bouton-envoyer').addEventListener('click', envoyerMessageTexte);
document.getElementById('champ-message').addEventListener('keydown', (e) => { if (e.key === 'Enter') envoyerMessageTexte(); });

function envoyerMessageTexte() {
  const champ = document.getElementById('champ-message');
  const contenu = champ.value.trim();
  if (!contenu || !ticketActifId) return;
  socket.emit('message:envoyer', { ticketId: ticketActifId, contenu }, (reponse) => {
    if (reponse.erreur) afficherNotification(reponse.erreur, 'erreur');
  });
  champ.value = '';
}

// Indicateur de frappe — throttlé à 1 envoi/seconde côté client.
document.getElementById('champ-message').addEventListener('input', () => {
  if (!ticketActifId) return;
  const maintenant = Date.now();
  if (maintenant - dernierEnvoiFrappe < 1000) return;
  dernierEnvoiFrappe = maintenant;
  socket.emit('frappe', { ticketId: ticketActifId });
});

// ============================================================================
// FICHIERS — upload REST (métadonnées) puis événement socket fichier:partager
// ============================================================================
document.getElementById('bouton-joindre-fichier').addEventListener('click', () => document.getElementById('input-fichier').click());

document.getElementById('input-fichier').addEventListener('change', async (e) => {
  const fichier = e.target.files[0];
  if (!fichier || !ticketActifId) return;

  const formData = new FormData();
  formData.append('fichier', fichier);

  try {
    const reponse = await fetch(`/api/tickets/${ticketActifId}/fichier`, {
      method: 'POST',
      headers: enTetesAuth(),
      body: formData,
    });
    const donnees = await reponse.json();
    if (!reponse.ok) return afficherNotification(donnees.erreur || "Échec de l'upload.", 'erreur');

    socket.emit('fichier:partager', donnees, (rep) => { if (rep.erreur) afficherNotification(rep.erreur, 'erreur'); });
  } catch (erreur) {
    console.error('Erreur upload:', erreur);
    afficherNotification("Erreur réseau pendant l'upload.", 'erreur');
  } finally {
    e.target.value = '';
  }
});

// ============================================================================
// CLIENTS (agents/admin)
// ============================================================================
async function chargerClients(recherche = '') {
  try {
    const url = recherche ? `/api/clients?q=${encodeURIComponent(recherche)}` : '/api/clients';
    const reponse = await fetch(url, { headers: enTetesAuth() });
    const { donnees } = await reponse.json();

    const liste = document.getElementById('liste-clients');
    liste.innerHTML = '';
    donnees.forEach((client) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${echapper(client.prenom)} ${echapper(client.nom)}</strong><br><small>${echapper(client.msisdn)} — ${echapper(client.statut)}</small>`;
      liste.appendChild(li);
    });
  } catch (erreur) {
    console.error('Erreur chargement clients:', erreur);
  }
}

let minuteurRecherche = null;
document.getElementById('recherche-clients')?.addEventListener('input', (e) => {
  clearTimeout(minuteurRecherche);
  minuteurRecherche = setTimeout(() => chargerClients(e.target.value), 300);
});

// ============================================================================
// BOUTONS D'APPEL — wrappés en closures pour ne dépendre d'aucun ordre de
// script (les fonctions initierAppel/accepterAppel/etc. de webrtc.js ne
// sont résolues qu'au moment du clic, jamais à l'enregistrement du listener).
// ============================================================================
document.getElementById('bouton-appel-audio').addEventListener('click', () => initierAppel(ticketActifId, 'audio'));
document.getElementById('bouton-appel-video').addEventListener('click', () => initierAppel(ticketActifId, 'video'));
document.getElementById('bouton-accepter-appel').addEventListener('click', () => accepterAppel());
document.getElementById('bouton-refuser-appel').addEventListener('click', () => refuserAppelEntrant());
document.getElementById('bouton-micro').addEventListener('click', () => basculerMicro());
document.getElementById('bouton-camera').addEventListener('click', () => basculerCamera());
document.getElementById('bouton-partage-ecran').addEventListener('click', () => basculerPartageEcran());
document.getElementById('bouton-raccrocher').addEventListener('click', () => raccrocher());