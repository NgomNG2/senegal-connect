const express = require('express');
const statsController = require('../controllers/statsController');
const { verifierJWT } = require('../middleware/auth');

const router = express.Router();

/**
 * @openapi
 * /stats:
 *   get:
 *     summary: Statistiques globales agrégées
 *     tags: [Monitoring]
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: Statistiques }
 */
router.get('/', verifierJWT, statsController.stats);

module.exports = router;