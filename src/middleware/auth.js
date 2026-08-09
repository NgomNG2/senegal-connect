/**
 * src/middleware/auth.js
 * -----------------------------------------------------------------------
 * Middlewares de sécurité pour les routes REST protégées.
 *
 * verifierJWT() : vérifie que le header Authorization contient un JWT
 * valide, et attache l'utilisateur décodé à req.utilisateur pour que les
 * contrôleurs suivants sachent "qui" fait la requête.
 *
 * garderRole(...roles) : à utiliser APRÈS verifierJWT() sur une route,
 * pour restreindre l'accès à certains rôles (ex: seul un admin peut créer
 * un forfait).
 *
 * Pourquoi 3 messages d'erreur JWT distincts (au lieu d'un seul "accès
 * refusé") ? C'est une exigence explicite du cahier des charges — ça aide
 * le client de l'API (le frontend) à savoir QUOI faire : redemander un
 * login si expiré, ou signaler un bug si le token est structurellement
 * invalide.
 */

const jwt = require('jsonwebtoken');
const { ErreurApplicative } = require('./erreurs');

function verifierJWT(req, res, next) {
  const enTete = req.headers.authorization; // format attendu : "Bearer eyJhbGci..."

  if (!enTete || !enTete.startsWith('Bearer ')) {
    return next(new ErreurApplicative(401, 'Token manquant. Ajoutez le header Authorization: Bearer <token>.'));
  }

  const token = enTete.split(' ')[1];

  jwt.verify(token, process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER }, (err, decode) => {
    if (err) {
      // TokenExpiredError et JsonWebTokenError sont les 2 classes d'erreur
      // que jsonwebtoken lève — on les distingue pour donner un message précis.
      if (err.name === 'TokenExpiredError') {
        return next(new ErreurApplicative(401, 'Token expiré — veuillez vous reconnecter.'));
      }
      return next(new ErreurApplicative(401, 'Token invalide.'));
    }

    // On attache les infos décodées à la requête : les contrôleurs suivants
    // peuvent lire req.utilisateur.id, req.utilisateur.role, etc.
    req.utilisateur = decode;
    next();
  });
}

/**
 * Middleware factory : garderRole('admin') ou garderRole('admin', 'agent').
 * DOIT être placé après verifierJWT() dans la chaîne de middlewares d'une
 * route, sinon req.utilisateur n'existe pas encore.
 */
function garderRole(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.utilisateur) {
      // Erreur de programmation (middleware mal ordonné), pas une erreur
      // client — mais on reste défensif plutôt que de planter le serveur.
      return next(new ErreurApplicative(500, 'garderRole() utilisé sans verifierJWT() avant.'));
    }
    if (!rolesAutorises.includes(req.utilisateur.role)) {
      return next(new ErreurApplicative(403, "Accès refusé : rôle insuffisant pour cette action."));
    }
    next();
  };
}

module.exports = { verifierJWT, garderRole };