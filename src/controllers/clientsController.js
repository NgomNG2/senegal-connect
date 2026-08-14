/**
 * src/controllers/clientsController.js
 * -----------------------------------------------------------------------
 * CRUD complet sur les clients (abonnés).
 *
 * Points clés de sécurité et bonnes pratiques:
 *  - creer() utilise une TRANSACTION : un client est en réalité 2 lignes
 *    liées (utilisateurs + clients). Si l'insertion du client échoue
 *    après avoir créé l'utilisateur, on ne veut pas garder un utilisateur
 *    "client" orphelin sans fiche client.
 *  - liste() applique pagination + filtres dynamiques construits avec des
 *    paramètres positionnels ($1, $2...) — jamais de concaténation de
 *    chaîne SQL (protection contre l'injection SQL).
 *  - Les codes HTTP suivent strictement le cahier des charges :
 *    200 liste/détail, 201 création, 204 suppression, 404 introuvable,
 *    409 doublon MSISDN ou suppression bloquée par une contrainte.
 */

const db = require('../config/db');
const { ErreurApplicative } = require('../middleware/erreurs');

async function liste(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limite = Math.min(parseInt(req.query.limite, 10) || 20, 100); // 100 = plafond anti-abus
    const decalage = (page - 1) * limite;

    // On construit la clause WHERE dynamiquement selon les filtres présents
    // dans la query string, sans jamais insérer leur valeur directement
    // dans la chaîne SQL — uniquement via le tableau params.
    const conditions = [];
    const params = [];

    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      conditions.push(`(u.nom ILIKE $${params.length} OR u.prenom ILIKE $${params.length} OR c.msisdn ILIKE $${params.length})`);
    }
    if (req.query.forfait_id) {
      params.push(req.query.forfait_id);
      conditions.push(`c.forfait_id = $${params.length}`);
    }
    if (req.query.statut) {
      params.push(req.query.statut);
      conditions.push(`c.statut = $${params.length}`);
    }

    const clauseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Requête 1 : le total (pour construire l'objet pagination), sans LIMIT/OFFSET
    const resultatTotal = await db.query(
      `SELECT COUNT(*) FROM clients c JOIN utilisateurs u ON u.id = c.utilisateur_id ${clauseWhere}`,
      params
    );
    const total = parseInt(resultatTotal.rows[0].count, 10);

    // Requête 2 : les lignes de la page demandée. LIMIT/OFFSET utilisent
    // les prochains numéros de paramètres positionnels après les filtres.
    params.push(limite, decalage);
    const resultat = await db.query(
      `SELECT c.id, c.msisdn, c.statut, c.date_inscription,
              u.nom, u.prenom, u.email,
              f.id AS forfait_id, f.nom AS forfait_nom
       FROM clients c
       JOIN utilisateurs u ON u.id = c.utilisateur_id
       LEFT JOIN forfaits f ON f.id = c.forfait_id
       ${clauseWhere}
       ORDER BY c.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({
      donnees: resultat.rows,
      pagination: {
        page,
        limite,
        total,
        totalPages: Math.ceil(total / limite),
      },
    });
  } catch (erreur) {
    next(erreur);
  }
}

async function detail(req, res, next) {
  try {
    const resultat = await db.query(
      `SELECT c.id, c.msisdn, c.statut, c.date_inscription,
              u.nom, u.prenom, u.email,
              f.id AS forfait_id, f.nom AS forfait_nom
       FROM clients c
       JOIN utilisateurs u ON u.id = c.utilisateur_id
       LEFT JOIN forfaits f ON f.id = c.forfait_id
       WHERE c.id = $1`,
      [req.params.id]
    );

    if (resultat.rows.length === 0) {
      return next(new ErreurApplicative(404, 'Client introuvable.'));
    }

    res.status(200).json({ client: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

async function creer(req, res, next) {
  try {
    const { nom, prenom, email, mot_de_passe, msisdn, forfait_id } = req.body;
    const bcrypt = require('bcryptjs');

    const client = await db.transaction(async (tx) => {
      const hash = await bcrypt.hash(mot_de_passe, 12);

      const utilisateur = await tx.query(
        `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role)
         VALUES ($1, $2, $3, $4, 'client') RETURNING id`,
        [nom, prenom, email, hash]
      );

      const nouveauClient = await tx.query(
        `INSERT INTO clients (utilisateur_id, msisdn, forfait_id)
         VALUES ($1, $2, $3)
         RETURNING id, msisdn, statut, date_inscription`,
        [utilisateur.rows[0].id, msisdn, forfait_id || null]
      );

      return nouveauClient.rows[0];
    });

    // 409 (email dupliqué) ou 422 (forfait_id inexistant, MSISDN mal
    // formaté) remontent automatiquement via gestionnaireErreurs.js grâce
    // au throw à l'intérieur de transaction() — le ROLLBACK a déjà eu lieu.
    res.status(201).json({ client });
  } catch (erreur) {
    next(erreur);
  }
}

async function modifier(req, res, next) {
  try {
    const { forfait_id, statut } = req.body;

    const resultat = await db.query(
      `UPDATE clients SET
         forfait_id = COALESCE($1, forfait_id),
         statut = COALESCE($2, statut)
       WHERE id = $3
       RETURNING id, msisdn, statut, forfait_id`,
      [forfait_id, statut, req.params.id]
    );

    if (resultat.rows.length === 0) {
      return next(new ErreurApplicative(404, 'Client introuvable.'));
    }

    res.status(200).json({ client: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

async function supprimer(req, res, next) {
  try {
    // ON DELETE CASCADE sur utilisateurs->clients : supprimer l'utilisateur
    // supprime automatiquement sa fiche client. Mais si le client a des
    // FACTURES (ON DELETE RESTRICT), PostgreSQL refusera avec 23503,
    // traduit en 409 par gestionnaireErreurs.js.
    const client = await db.query('SELECT utilisateur_id FROM clients WHERE id = $1', [req.params.id]);

    if (client.rows.length === 0) {
      return next(new ErreurApplicative(404, 'Client introuvable.'));
    }

    await db.query('DELETE FROM utilisateurs WHERE id = $1', [client.rows[0].utilisateur_id]);

    // 204 No Content : suppression réussie, pas de corps de réponse.
    res.status(204).send();
  } catch (erreur) {
    next(erreur);
  }
}

module.exports = { liste, detail, creer, modifier, supprimer };