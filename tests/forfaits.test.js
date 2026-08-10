require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const { genererToken } = require('./helpers/token');

jest.mock('../src/config/db');
const db = require('../src/config/db');

const tokenAdmin = genererToken('admin');

// Vérifie la consultation et les règles de gestion des forfaits.
describe('Forfaits', () => {
  afterEach(() => jest.clearAllMocks());

  // Le résultat doit inclure le nombre de clients associés à chaque forfait.
  test('GET /api/forfaits renvoie 200 avec nb_clients par forfait', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, nom: 'Essentiel', nb_clients: 3 }] });
    const res = await request(app).get('/api/forfaits').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.donnees[0]).toHaveProperty('nb_clients', 3);
  });

  // Les opérations protégées exigent un jeton d'authentification.
  test('POST /api/forfaits sans token renvoie 401', async () => {
    const res = await request(app).post('/api/forfaits').send({ nom: 'X', quota_data_go: 1, quota_voix_min: 50, prix_mensuel_fcfa: 1000 });
    expect(res.status).toBe(401);
  });

  // Le prix mensuel doit respecter la contrainte de montant positif.
  test('POST /api/forfaits avec prix négatif renvoie 422', async () => {
    const res = await request(app).post('/api/forfaits').set('Authorization', `Bearer ${tokenAdmin}`).send({
      nom: 'X', quota_data_go: 1, quota_voix_min: 50, prix_mensuel_fcfa: -100,
    });
    expect(res.status).toBe(422);
  });

  // Une suppression référencée par des clients est refusée par la base.
  test('DELETE /api/forfaits/:id renvoie 409 si des clients y sont rattachés', async () => {
    const erreurSQL = new Error('restrict_violation');
    erreurSQL.code = '23001';
    db.query.mockRejectedValueOnce(erreurSQL);
    const res = await request(app).delete('/api/forfaits/2').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(409);
  });

  // Une création réussie doit retourner l'identifiant du nouveau forfait.
  test('POST /api/forfaits renvoie 201 à la création réussie', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 5, nom: 'Nouveau Forfait', prix_mensuel_fcfa: 8000 }] });
    const res = await request(app).post('/api/forfaits').set('Authorization', `Bearer ${tokenAdmin}`).send({
      nom: 'Nouveau Forfait', quota_data_go: 5, quota_voix_min: 200, prix_mensuel_fcfa: 8000,
    });
    expect(res.status).toBe(201);
    expect(res.body.forfait.id).toBe(5);
  });

  // La récupération d'un forfait existant doit retourner ses détails.
  test('GET /api/forfaits/:id renvoie le détail (200)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, nom: 'Essentiel' }] });
    const res = await request(app).get('/api/forfaits/1').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
  });

  // La récupération d'un forfait inexistant doit retourner 404.
  test('GET /api/forfaits/:id renvoie 404 si introuvable', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/forfaits/999').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });

  // La modification d'un forfait existant doit retourner les nouvelles valeurs.
  test('PUT /api/forfaits/:id modifie et renvoie 200', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, actif: false }] });
    const res = await request(app).put('/api/forfaits/1').set('Authorization', `Bearer ${tokenAdmin}`).send({ actif: false });
    expect(res.status).toBe(200);
    expect(res.body.forfait.actif).toBe(false);
  });

  // La suppression d'un forfait non utilisé doit retourner 204.
  test('DELETE /api/forfaits/:id renvoie 204 en cas de succès (forfait non utilisé)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = await request(app).delete('/api/forfaits/5').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(204);
  });
});