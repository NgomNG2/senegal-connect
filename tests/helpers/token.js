/**
 * tests/helpers/token.js
 * -----------------------------------------------------------------------
 * Génère des JWT valides directement avec jsonwebtoken, pour tester les
 * routes protégées SANS avoir besoin d'un vrai login (qui toucherait la
 * BDD, qu'on mocke justement). Le token est réel et passera la
 * vérification de signature de verifierJWT() — seul son contenu (payload)
 * est fabriqué à la main.
 */

const jwt = require('jsonwebtoken');

function genererToken(role = 'agent', id = 1) {
  return jwt.sign(
    { id, email: `${role}@test.sn`, role },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: process.env.JWT_ISSUER }
  );
}

module.exports = { genererToken };