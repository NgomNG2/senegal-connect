/**
 * src/middleware/validation.js
 * -----------------------------------------------------------------------
 * Middleware générique réutilisé par toutes les routes CRUD (clients,
 * forfaits, factures...) pour transformer les erreurs express-validator
 * en réponse 422 avec le détail par champ, format uniforme sur toute
 * l'API — évite de dupliquer cette logique dans chaque fichier de routes.
 */

const { validationResult } = require('express-validator');
const { ErreurApplicative } = require('./erreurs');

function validerRequete(req, res, next) {
  const erreurs = validationResult(req);
  if (!erreurs.isEmpty()) {
    const details = erreurs.array().map((e) => ({ champ: e.path, message: e.msg }));
    return next(new ErreurApplicative(422, 'Données invalides.', { champs: details }));
  }
  next();
}

module.exports = { validerRequete };