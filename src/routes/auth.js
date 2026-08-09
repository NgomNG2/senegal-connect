/**
 * src/routes/auth.js
 * -----------------------------------------------------------------------
 * Routes d'authentification. La validation express-validator s'exécute
 * AVANT le contrôleur : si un champ est invalide, on renvoie 422 avec le
 * détail par champ, sans même toucher à la base de données.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const authController = require('../controllers/authController');
const { verifierJWT } = require('../middleware/auth');
const { ErreurApplicative } = require('../middleware/erreurs');

const router = express.Router();

// Middleware de validation réutilisable pour toutes les routes CRUD (clients, forfaits, factures...) : transforme les erreurs express-validator en réponse 422 avec le détail par champ.
const { validerRequete } = require('../middleware/validation');

router.post(
  '/register',
  [
    body('nom').trim().notEmpty().withMessage('Le nom est requis.'),
    body('prenom').trim().notEmpty().withMessage('Le prénom est requis.'),
    body('email').isEmail().withMessage('Email invalide.').normalizeEmail(),
    body('mot_de_passe')
      .isLength({ min: 8 })
      .withMessage('Le mot de passe doit contenir au moins 8 caractères.'),
  ],
  validerRequete,
  authController.register
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Email invalide.').normalizeEmail(),
    body('mot_de_passe').notEmpty().withMessage('Le mot de passe est requis.'),
  ],
  validerRequete,
  authController.login
);

router.get('/profil', verifierJWT, authController.profil);

module.exports = router;