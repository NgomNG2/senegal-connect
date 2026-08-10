/**
 * src/controllers/statsController.js
 * -----------------------------------------------------------------------
 * Statistiques globales en UNE SEULE requête SQL (sous-requêtes scalaires
 * plutôt que plusieurs allers-retours séparés — moins de latence réseau).
 */
const db = require('../config/db');

async function stats(req, res, next) {
  try {
    const resultat = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM clients WHERE statut = 'actif')::int AS clients_actifs,
        (SELECT COUNT(*) FROM clients)::int AS clients_total,
        (SELECT COUNT(*) FROM tickets WHERE statut != 'ferme')::int AS tickets_ouverts,
        (SELECT COALESCE(SUM(montant_fcfa), 0) FROM factures WHERE statut = 'payee') AS revenus_payes,
        (SELECT COALESCE(SUM(montant_fcfa), 0) FROM factures WHERE statut IN ('impayee', 'en_retard')) AS revenus_impayes
    `);
    res.status(200).json({ stats: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

module.exports = { stats };