/**
 * src/routes/clients.js
 * -----------------------------------------------------------------------
 * Toutes les routes nécessitent un JWT valide. La création/modification/
 * suppression sont en plus réservées aux rôles admin/agent — un client ne
 * doit pas pouvoir créer ou supprimer des fiches clients lui-même.
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const clientsController = require('../controllers/clientsController');
const { verifierJWT, garderRole } = require('../middleware/auth');
const { validerRequete } = require('../middleware/validation');

const router = express.Router();

router.get(
  '/',
  verifierJWT,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limite').optional().isInt({ min: 1, max: 100 }),
    query('statut').optional().isIn(['actif', 'suspendu', 'resilie']),
  ],
  validerRequete,
  clientsController.liste
);

router.get('/:id', verifierJWT, param('id').isInt(), validerRequete, clientsController.detail);

router.post(
  '/',
  verifierJWT,
  garderRole('admin', 'agent'),
  [
    body('nom').trim().notEmpty().withMessage('Le nom est requis.'),
    body('prenom').trim().notEmpty().withMessage('Le prénom est requis.'),
    body('email').isEmail().withMessage('Email invalide.').normalizeEmail(),
    body('mot_de_passe').isLength({ min: 8 }).withMessage('Mot de passe : 8 caractères minimum.'),
    body('msisdn')
      .matches(/^\+221[0-9]{9}$/)
      .withMessage('MSISDN invalide (format attendu : +221XXXXXXXXX).'),
    body('forfait_id').optional().isInt(),
  ],
  validerRequete,
  clientsController.creer
);

router.put(
  '/:id',
  verifierJWT,
  garderRole('admin', 'agent'),
  [
    param('id').isInt(),
    body('forfait_id').optional().isInt(),
    body('statut').optional().isIn(['actif', 'suspendu', 'resilie']),
  ],
  validerRequete,
  clientsController.modifier
);

router.delete(
  '/:id',
  verifierJWT,
  garderRole('admin'),
  param('id').isInt(),
  validerRequete,
  clientsController.supprimer
);

module.exports = router;