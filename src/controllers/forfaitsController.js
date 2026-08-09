/**
 * src/controllers/forfaitsController.js
 * -----------------------------------------------------------------------
 * CRUD forfaits. Plus simple que clients : pas de transaction nécessaire
 * (une seule table concernée).
 */

const db = require('../config/db');
const { ErreurApplicative } = require('../middleware/erreurs');

async function liste(req, res, next) {
  try {
    const conditions = [];
    const params = [];

    if (req.query.actif !== undefined) {
      params.push(req.query.actif === 'true');
      conditions.push(`actif = $${params.length}`);
    }

    const clauseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const resultat = await db.query(`SELECT * FROM forfaits ${clauseWhere} ORDER BY prix_mensuel_fcfa`, params);

    res.status(200).json({ donnees: resultat.rows });
  } catch (erreur) {
    next(erreur);
  }
}

async function detail(req, res, next) {
  try {
    const resultat = await db.query('SELECT * FROM forfaits WHERE id = $1', [req.params.id]);
    if (resultat.rows.length === 0) {
      return next(new ErreurApplicative(404, 'Forfait introuvable.'));
    }
    res.status(200).json({ forfait: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

async function creer(req, res, next) {
  try {
    const { nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa } = req.body;
    const resultat = await db.query(
      `INSERT INTO forfaits (nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa]
    );
    res.status(201).json({ forfait: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

async function modifier(req, res, next) {
  try {
    const { nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa, actif } = req.body;
    const resultat = await db.query(
      `UPDATE forfaits SET
         nom = COALESCE($1, nom),
         quota_data_go = COALESCE($2, quota_data_go),
         quota_voix_min = COALESCE($3, quota_voix_min),
         prix_mensuel_fcfa = COALESCE($4, prix_mensuel_fcfa),
         actif = COALESCE($5, actif)
       WHERE id = $6 RETURNING *`,
      [nom, quota_data_go, quota_voix_min, prix_mensuel_fcfa, actif, req.params.id]
    );
    if (resultat.rows.length === 0) {
      return next(new ErreurApplicative(404, 'Forfait introuvable.'));
    }
    res.status(200).json({ forfait: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

// Supprimer un forfait. Si le forfait est utilisé par des clients, la suppression échouera
// à cause de la contrainte de clé étrangère (ON DELETE RESTRICT).
async function supprimer(req, res, next) {
  try {
    const resultat = await db.query('DELETE FROM forfaits WHERE id = $1 RETURNING id', [req.params.id]);
    if (resultat.rows.length === 0) {
      return next(new ErreurApplicative(404, 'Forfait introuvable.'));
    }
    res.status(204).send();
  } catch (erreur) {
    next(erreur);
  }
}

module.exports = { liste, detail, creer, modifier, supprimer };