/**
 * src/controllers/authController.js
 * -----------------------------------------------------------------------
 * Inscription, connexion, et lecture du profil courant.
 *
 * Sécurité clé à retenir pour la soutenance :
 *  - bcrypt avec un coût de 12 (2^12 itérations) : assez lent pour rendre
 *    une attaque par force brute coûteuse, assez rapide pour ne pas
 *    ralentir un login légitime (~250ms).
 *  - Le message d'erreur de login est VOLONTAIREMENT IDENTIQUE que
 *    l'email n'existe pas OU que le mot de passe soit faux. Si on
 *    distinguait ("email inconnu" vs "mot de passe incorrect"), un
 *    attaquant pourrait déduire quels emails sont inscrits (énumération
 *    de comptes).
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { ErreurApplicative } = require('../middleware/erreurs');

const COUT_BCRYPT = 12;

async function register(req, res, next) {
  try {
    const { nom, prenom, email, mot_de_passe, role } = req.body;

    // On ne laisse jamais un utilisateur s'auto-déclarer admin à
    // l'inscription publique : seul 'client' ou 'agent' sont acceptés ici.
    const roleFinal = role === 'agent' ? 'agent' : 'client';

    const hash = await bcrypt.hash(mot_de_passe, COUT_BCRYPT);

    const resultat = await db.query(
      `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nom, prenom, email, role, cree_le`,
      [nom, prenom, email, hash, roleFinal]
    );

    const utilisateur = resultat.rows[0];
    const token = genererToken(utilisateur);

    // 201 Created : une nouvelle ressource (le compte) vient d'être créée.
    res.status(201).json({ utilisateur, token });
  } catch (erreur) {
    // Un email dupliqué remonte ici comme erreur PostgreSQL 23505 —
    // gestionnaireErreurs.js la transforme automatiquement en 409.
    next(erreur);
  }
}

async function login(req, res, next) {
  try {
    const { email, mot_de_passe } = req.body;

    const resultat = await db.query(
      'SELECT id, nom, prenom, email, mot_de_passe, role FROM utilisateurs WHERE email = $1',
      [email]
    );

    const utilisateur = resultat.rows[0];

    // IMPORTANT : même message d'erreur dans les deux branches ci-dessous.
    if (!utilisateur) {
      return next(new ErreurApplicative(401, 'Email ou mot de passe incorrect.'));
    }

    const motDePasseValide = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe);
    if (!motDePasseValide) {
      return next(new ErreurApplicative(401, 'Email ou mot de passe incorrect.'));
    }

    const token = genererToken(utilisateur);

    // On ne renvoie jamais le hash du mot de passe au client.
    delete utilisateur.mot_de_passe;

    res.status(200).json({ utilisateur, token });
  } catch (erreur) {
    next(erreur);
  }
}

async function profil(req, res, next) {
  try {
    // req.utilisateur vient du middleware verifierJWT (payload décodé du token)
    const resultat = await db.query(
      'SELECT id, nom, prenom, email, role, cree_le FROM utilisateurs WHERE id = $1',
      [req.utilisateur.id]
    );

    if (resultat.rows.length === 0) {
      return next(new ErreurApplicative(404, 'Utilisateur introuvable.'));
    }

    res.status(200).json({ utilisateur: resultat.rows[0] });
  } catch (erreur) {
    next(erreur);
  }
}

/**
 * Génère un JWT signé, valide 24h, avec un "issuer" (émetteur) — vérifié
 * au décodage dans auth.js pour éviter qu'un token émis par une autre
 * application utilisant le même secret ne soit accepté par erreur.
 */
function genererToken(utilisateur) {
  return jwt.sign(
    { id: utilisateur.id, email: utilisateur.email, role: utilisateur.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h', issuer: process.env.JWT_ISSUER }
  );
}

module.exports = { register, login, profil };