/**
 * src/routes/factures.js
 * -----------------------------------------------------------------------
 * Routes CRUD pour les factures. La validation express-validator s'exécute
 * AVANT le contrôleur : si un champ est invalide, on renvoie 422 avec le
 * détail par champ, sans même toucher à la base de données.    
 * 
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const facturesController = require('../controllers/facturesController');
const { verifierJWT, garderRole } = require('../middleware/auth');
const { validerRequete } = require('../middleware/validation');

const router = express.Router();

router.get(
  '/',
  verifierJWT,
  [
    query('statut').optional().isIn(['payee', 'impayee', 'en_retard']),
    query('periode').optional().matches(/^\d{4}-(0[1-9]|1[0-2])$/),
  ],
  validerRequete,
  facturesController.liste
);

router.get(
    '/:id', 
    verifierJWT, 
    param('id').isInt(), 
    validerRequete, 
    facturesController.detail
);

router.post(
  '/',
  verifierJWT,
  garderRole('admin', 'agent'),
  [
    body('client_id').isInt(),
    body('periode').matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('Format période attendu : YYYY-MM.'),
    body('montant_fcfa').isFloat({ min: 0 }),
    body('date_echeance').isISO8601(),
  ],
  validerRequete,
  facturesController.creer
);

router.patch(
    '/:id/payer', 
    verifierJWT, 
    garderRole('admin', 'agent'), 
    param('id').isInt(), 
    validerRequete, 
    facturesController.marquerPayee
);

module.exports = router;