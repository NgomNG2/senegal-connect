/**
 * src/controllers/facturesController.js
 * -----------------------------------------------------------------------
 * Lecture + création de factures. Pas de suppression exposée (une facture
 * émise ne se supprime pas dans un vrai système télécom — seul le statut
 * change) : c'est un choix métier volontaire, à savoir justifier.
 */

const db = require('../config/db');
const { ErreurApplicative } = require('../middleware/erreurs');

async function liste(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limite = Math.min(parseInt(req.query.limite, 10) || 20, 100);
    const decalage = (page - 1) * limite;

    const conditions = [];
    const params = [];

    if (req.query.client_id) {
      params.push(req.query.client_id);
      conditions.push(`client_id = $${params.length}`);
    }
    if (req.query.statut) {
      params.push(req.query.statut);
      conditions.push(`statut = $${params.length}`);
    }
    if (req.query.periode) {
      params.push(req.query.periode);
      conditions.push(`periode = $${params.length}`);
    }

    const clauseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const resultatTotal = await db.query(`SELECT COUNT(*) FROM factures ${clauseWhere}`, params);
    const total = parseInt(resultatTotal.rows[0].count, 10);

    params.push(limite, decalage);
    const resultat = await db.query(
      `SELECT * FROM factures ${clauseWhere} ORDER BY date_emission DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({
      donnees: resultat.rows,
      pagination: { page, limite, total, totalPages: Math.ceil(total / limite) },
    });
  } catch (erreur) {
    next(erreur);
  }
}

async function detail(req, res, next) {
  try {
    const resultat = await db.query('SELECT * FROM factures WHERE id = $1', [req.params.id]);
    if (resultat.rows.length === 0) {
      return next(new ErreurApplicative(404, 'Facture introuvable.'));
    }
    res.status(200).json({ facture: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

async function creer(req, res, next) {
  try {
    const { client_id, periode, montant_fcfa, date_echeance } = req.body;

    // Référence unique générée par l'application, format FAC-YYYYMM-XXXX
    const suffixe = Math.floor(1000 + Math.random() * 9000);
    const reference = `FAC-${periode.replace('-', '')}-${suffixe}`;

    const resultat = await db.query(
      `INSERT INTO factures (client_id, reference, periode, montant_fcfa, date_echeance)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [client_id, reference, periode, montant_fcfa, date_echeance]
    );

    res.status(201).json({ facture: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

async function marquerPayee(req, res, next) {
  try {
    const resultat = await db.query(
      `UPDATE factures SET statut = 'payee' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (resultat.rows.length === 0) {
      return next(new ErreurApplicative(404, 'Facture introuvable.'));
    }
    res.status(200).json({ facture: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

module.exports = { liste, detail, creer, marquerPayee };