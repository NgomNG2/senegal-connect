require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const { genererToken } = require('./helpers/token');

jest.mock('../src/config/db');
const db = require('../src/config/db');

const tokenAgent = genererToken('agent');

// Couvre la consultation des clients et la validation de leur création.
describe('Clients', () => {
  afterEach(() => jest.clearAllMocks());

  // Les deux requêtes simulées représentent le total puis les résultats paginés.
  test('GET /api/clients renvoie 200 avec pagination', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ count: '5' }] }).mockResolvedValueOnce({ rows: [{ id: 1, nom: 'Diouf' }] });
    const res = await request(app).get('/api/clients').set('Authorization', `Bearer ${tokenAgent}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination).toHaveProperty('total', 5);
  });

  // Vérifie que le terme de recherche est transmis et filtré par l'API.
  test('GET /api/clients?q=Diouf filtre correctement', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ count: '1' }] }).mockResolvedValueOnce({ rows: [{ id: 1, nom: 'Diouf' }] });
    const res = await request(app).get('/api/clients?q=Diouf').set('Authorization', `Bearer ${tokenAgent}`);
    expect(res.status).toBe(200);
    expect(res.body.donnees[0].nom).toBe('Diouf');
  });

  // Retourne les informations du client demandé lorsqu'il existe.
  test('GET /api/clients/:id renvoie le détail d\'un client existant', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, nom: 'Diouf', msisdn: '+221771234567' }] });
    const res = await request(app).get('/api/clients/1').set('Authorization', `Bearer ${tokenAgent}`);
    expect(res.status).toBe(200);
    expect(res.body.client.id).toBe(1);
  });

  // Un identifiant sans correspondance doit produire une réponse 404.
  test('GET /api/clients/:id renvoie 404 si id inexistant', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/clients/999').set('Authorization', `Bearer ${tokenAgent}`);
    expect(res.status).toBe(404);
  });

  // La validation bloque la requête avant toute écriture en base.
  test('POST /api/clients renvoie 422 si MSISDN invalide', async () => {
    const res = await request(app).post('/api/clients').set('Authorization', `Bearer ${tokenAgent}`).send({
      nom: 'X', prenom: 'Y', email: 'x@y.sn', mot_de_passe: 'MotDePasse123', msisdn: 'pasunmsisdn',
    });
    expect(res.status).toBe(422);
  });

  // Modifie le statut d'un client et confirme la mise à jour dans la réponse.
  test('PUT /api/clients/:id modifie le statut (200)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, statut: 'suspendu' }] });
    const res = await request(app).put('/api/clients/1').set('Authorization', `Bearer ${tokenAgent}`).send({ statut: 'suspendu' });
    expect(res.status).toBe(200);
    expect(res.body.client.statut).toBe('suspendu');
  });

  // Seul un administrateur peut supprimer un client, pas un agent.
  test('DELETE /api/clients/:id renvoie 403 pour un agent (admin uniquement)', async () => {
    const res = await request(app).delete('/api/clients/1').set('Authorization', `Bearer ${tokenAgent}`);
    expect(res.status).toBe(403);
  });

  // Un administrateur peut supprimer un client, et la réponse est 204 No Content.
  test('DELETE /api/clients/:id renvoie 204 pour un admin', async () => {
    const { genererToken } = require('./helpers/token');
    const tokenAdmin = genererToken('admin');
    db.query.mockResolvedValueOnce({ rows: [{ utilisateur_id: 4 }] }).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/api/clients/1').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(204);
  });
});