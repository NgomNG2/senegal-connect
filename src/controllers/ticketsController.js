/**
 * src/controllers/ticketsController.js
 * -----------------------------------------------------------------------
 * CRUD tickets + historique des messages en REST.
 *
 * "Chargement de l'historique via REST (GET /api/tickets/:id/messages,
 *  50 par page, curseur ?avant=timestamp)."
 * Pagination par CURSEUR (pas page/offset) : on demande "les 50 messages
 * envoyés AVANT tel timestamp". C'est le standard pour un fil de chat
 * (contrairement à la pagination page/offset utilisée pour les listes
 * clients/forfaits/factures) car un chat reçoit continuellement de
 * nouveaux messages — avec page/offset, un nouveau message décale toute
 * la pagination existante. Le curseur, basé sur un timestamp fixe, n'a
 * pas ce problème : "avant" une date donnée ne change jamais.
 */

const db = require('../config/db');
const { ErreurApplicative } = require('../middleware/erreurs');

/**
 * "Contrôle des rôles : un client ne peut accéder qu'à ses propres
 *  données, un agent peut accéder aux données de ses tickets uniquement,
 *  un admin a accès complet."
 * Filtrage appliqué ICI, au niveau SQL — pas seulement côté frontend —
 * pour qu'un agent malveillant ne puisse pas voir les tickets des autres
 * en modifiant simplement sa requête HTTP.
 */
async function liste(req, res, next) {
  try {
    const conditions = [];
    const params = [];

    if (req.query.statut) {
      params.push(req.query.statut);
      conditions.push(`t.statut = $${params.length}`);
    }

    if (req.utilisateur.role === 'client') {
      // Un client ne voit que SES tickets — retrouvés via son propre
      // utilisateur_id, jamais via un client_id fourni par la requête.
      params.push(req.utilisateur.id);
      conditions.push(`u.id = $${params.length}`);
    } else if (req.utilisateur.role === 'agent') {
      // Un agent voit ses tickets assignés + les tickets encore libres
      // (qu'il pourrait prendre en charge) — pas ceux des autres agents.
      params.push(req.utilisateur.id);
      conditions.push(`(t.agent_id = $${params.length} OR t.agent_id IS NULL)`);
    }
    // admin : aucune condition supplémentaire, accès complet.

    const clauseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const resultat = await db.query(
      `SELECT t.*, u.nom AS client_nom, u.prenom AS client_prenom
       FROM tickets t
       JOIN clients c ON c.id = t.client_id
       JOIN utilisateurs u ON u.id = c.utilisateur_id
       ${clauseWhere}
       ORDER BY t.ouvert_le DESC`,
      params
    );
    res.status(200).json({ donnees: resultat.rows });
  } catch (erreur) {
    next(erreur);
  }
}

/**
 * "Un client ne peut accéder qu'à ses propres données." Comme pour
 * l'événement socket ticket:ouvrir, on ne fait JAMAIS confiance à un
 * client_id envoyé par un utilisateur de rôle 'client' — on le dérive de
 * son propre compte. Un agent/admin, lui, peut ouvrir un ticket pour
 * n'importe quel client (cas d'usage : appel téléphonique entrant).
 */
async function creer(req, res, next) {
  try {
    let { client_id, sujet } = req.body;

    if (req.utilisateur.role === 'client') {
      const clientRes = await db.query('SELECT id FROM clients WHERE utilisateur_id = $1', [req.utilisateur.id]);
      if (clientRes.rows.length === 0) {
        return next(new ErreurApplicative(422, 'Aucune fiche client associée à ce compte.'));
      }
      client_id = clientRes.rows[0].id; // écrase toute valeur venant du body
    } else if (!client_id) {
      return next(new ErreurApplicative(422, 'client_id est requis pour un agent/admin.'));
    }

    const resultat = await db.query(
      `INSERT INTO tickets (client_id, sujet) VALUES ($1, $2) RETURNING *`,
      [client_id, sujet]
    );
    res.status(201).json({ ticket: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

/**
 * GET /api/tickets/:id/messages?avant=2026-03-15T10:00:00Z&limite=50
 *
 * Sans ?avant : renvoie les 50 messages les PLUS RÉCENTS (cas du premier
 * chargement d'un ticket). Avec ?avant : renvoie les 50 messages
 * précédant ce timestamp (cas du scroll vers le haut pour charger plus
 * d'historique). Dans les deux cas, on retrie en ordre chronologique
 * croissant avant de renvoyer, pour un affichage naturel de haut en bas.
 */
async function messages(req, res, next) {
  try {
    const limite = Math.min(parseInt(req.query.limite, 10) || 50, 100);
    const avant = req.query.avant; // timestamp ISO8601, optionnel

    const conditions = ['ticket_id = $1'];
    const params = [req.params.id];

    if (avant) {
      params.push(avant);
      conditions.push(`envoye_le < $${params.length}`);
    }

    const resultat = await db.query(
      `SELECT m.*,
              COALESCE(
                json_agg(json_build_object('emoji', r.emoji, 'utilisateur_id', r.utilisateur_id))
                FILTER (WHERE r.emoji IS NOT NULL), '[]'
              ) AS reactions
       FROM messages m
       LEFT JOIN reactions r ON r.message_id = m.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY m.id
       ORDER BY m.envoye_le DESC
       LIMIT $${params.length + 1}`,
      [...params, limite]
    );

    // On avait trié DESC pour prendre "les N plus récents avant X" avec
    // LIMIT — on retrie ASC pour l'affichage (plus ancien en haut).
    const donnees = resultat.rows.reverse();

    // Curseur pour la page suivante (le "avant" à utiliser au prochain
    // appel) : le timestamp du message le plus ancien reçu ici.
    const curseurSuivant = donnees.length > 0 ? donnees[0].envoye_le : null;

    res.status(200).json({
      donnees,
      pagination: {
        limite,
        curseurSuivant,
        aPlus: donnees.length === limite,
      },
    });
  } catch (erreur) {
    next(erreur);
  }
}

/**
 * "L'historique des appels d'un ticket est visible... via
 *  GET /api/tickets/:id/appels."
 * 
 */
async function appels(req, res, next) {
  try {
    const resultat = await db.query(
      `SELECT a.*, ui.nom AS initiateur_nom, ud.nom AS destinataire_nom
       FROM appels a
       JOIN utilisateurs ui ON ui.id = a.initiateur_id
       JOIN utilisateurs ud ON ud.id = a.destinataire_id
       WHERE a.ticket_id = $1
       ORDER BY a.debut_le DESC`,
      [req.params.id]
    );
    res.status(200).json({ donnees: resultat.rows });
  } catch (erreur) {
    next(erreur);
  }
}

module.exports = { liste, creer, messages, appels };