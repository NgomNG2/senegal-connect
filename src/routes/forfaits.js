/** 
 * 
 * src/routes/forfaits.js
 * -----------------------------------------------------------------------
 * Routes CRUD pour les forfaits. La validation express-validator s'exécute
 * AVANT le contrôleur : si un champ est invalide, on renvoie 422 avec le
 * détail par champ, sans même toucher à la base de données.    
 * 
*/

const express = require('express');
const { body, param } = require('express-validator');
const forfaitsController = require('../controllers/forfaitsController');
const { verifierJWT, garderRole } = require('../middleware/auth');
const { validerRequete } = require('../middleware/validation');

const router = express.Router();

router.get(
    '/',
    verifierJWT,
    forfaitsController.liste
);
router.get(
    '/:id', 
    verifierJWT, 
    param('id').isInt(), 
    validerRequete, 
    forfaitsController.detail
);

router.post(
  '/',
  verifierJWT,
  garderRole('admin'),
  [
    body('nom').trim().notEmpty(),
    body('quota_data_go').isFloat({ min: 0 }),
    body('quota_voix_min').isInt({ min: 0 }),
    body('prix_mensuel_fcfa').isFloat({ min: 0.01 }),
  ],
  validerRequete,
  forfaitsController.creer
);

router.put(
    '/:id', verifierJWT, 
    garderRole('admin'), 
    param('id').isInt(), 
    validerRequete, 
    forfaitsController.modifier
);

router.delete(
    '/:id', verifierJWT, 
    garderRole('admin'), 
    param('id').isInt(), 
    validerRequete, 
    forfaitsController.supprimer
);

module.exports = router;