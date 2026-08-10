require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const { genererToken } = require('./helpers/token');

jest.mock('../src/config/db');
const db = require('../src/config/db');

// Vérifie les endpoints de supervision et leurs engagements de réponse.
describe('Monitoring', () => {
  afterEach(() => jest.clearAllMocks());

  // Le endpoint de santé expose les informations minimales de disponibilité.
  test('GET /api/health renvoie 200 avec statut/uptime/version', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('statut', 'ok');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('version');
  });

  // Les statistiques doivent contenir les indicateurs attendus par le tableau de bord.
  test('GET /api/stats renvoie 200 avec les champs attendus', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ clients_actifs: 5, clients_total: 8, tickets_ouverts: 2, revenus_payes: '45000', revenus_impayes: '40000' }],
    });
    const res = await request(app).get('/api/stats').set('Authorization', `Bearer ${genererToken('agent')}`);
    expect(res.status).toBe(200);
    expect(res.body.stats).toHaveProperty('clients_actifs');
    expect(res.body.stats).toHaveProperty('revenus_payes');
  });

  // Garde-fou simple contre une régression de performance du endpoint de santé.
  test('GET /api/health répond en moins de 200ms', async () => {
    const debut = Date.now();
    await request(app).get('/api/health');
    expect(Date.now() - debut).toBeLessThan(200);
  });
});