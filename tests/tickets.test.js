require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const { genererToken } = require('./helpers/token');

jest.mock('../src/config/db');
const db = require('../src/config/db');

describe('Tickets et fichiers', () => {
  afterEach(() => jest.clearAllMocks());

  test('GET /api/tickets sans token renvoie 401', async () => {
    const res = await request(app).get('/api/tickets');

    expect(res.status).toBe(401);
    expect(res.body.erreur).toContain('Token manquant');
  });

  test('GET /api/tickets filtre les tickets d’un agent', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, sujet: 'Connexion lente' }] });

    const res = await request(app)
      .get('/api/tickets?statut=ouvert')
      .set('Authorization', `Bearer ${genererToken('agent', 7)}`);

    expect(res.status).toBe(200);
    expect(res.body.donnees).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('t.statut = $1'),
      ['ouvert', 7]
    );
  });

  test('POST /api/tickets remplace le client_id fourni par la fiche du client', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 12 }] })
      .mockResolvedValueOnce({ rows: [{ id: 30, client_id: 12, sujet: 'Aide' }] });

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${genererToken('client', 4)}`)
      .send({ client_id: 999, sujet: 'Aide' });

    expect(res.status).toBe(201);
    expect(res.body.ticket.client_id).toBe(12);
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO tickets'),
      [12, 'Aide']
    );
  });

  test('GET /api/tickets/:id/messages renvoie une pagination par curseur', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 2, envoye_le: '2026-01-02T10:00:00.000Z', reactions: [] },
        { id: 1, envoye_le: '2026-01-01T10:00:00.000Z', reactions: [] },
      ],
    });

    const res = await request(app)
      .get('/api/tickets/3/messages?limite=2')
      .set('Authorization', `Bearer ${genererToken('client')}`);

    expect(res.status).toBe(200);
    expect(res.body.donnees.map((message) => message.id)).toEqual([1, 2]);
    expect(res.body.pagination).toEqual({
      limite: 2,
      curseurSuivant: '2026-01-01T10:00:00.000Z',
      aPlus: true,
    });
  });

  test('GET /api/tickets/:id/messages rejette une limite invalide', async () => {
    const res = await request(app)
      .get('/api/tickets/3/messages?limite=101')
      .set('Authorization', `Bearer ${genererToken('client')}`);

    expect(res.status).toBe(422);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('GET /api/tickets/:id/appels renvoie les appels du ticket', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 8, ticket_id: 3, statut: 'termine' }] });

    const res = await request(app)
      .get('/api/tickets/3/appels')
      .set('Authorization', `Bearer ${genererToken('agent')}`);

    expect(res.status).toBe(200);
    expect(res.body.donnees[0]).toMatchObject({ id: 8, ticket_id: 3 });
  });

  test('POST /api/tickets/:id/fichier sans fichier renvoie 422', async () => {
    const res = await request(app)
      .post('/api/tickets/3/fichier')
      .set('Authorization', `Bearer ${genererToken('client')}`);

    expect(res.status).toBe(422);
    expect(res.body.erreur).toContain('Aucun fichier');
  });

  test('POST /api/tickets/:id/fichier refuse un type MIME interdit', async () => {
    const res = await request(app)
      .post('/api/tickets/3/fichier')
      .set('Authorization', `Bearer ${genererToken('client')}`)
      .attach('fichier', Buffer.from('not an image'), {
        filename: 'script.html',
        contentType: 'text/html',
      });

    expect(res.status).toBe(422);
    expect(res.body.erreur).toContain('Type de fichier non autorisé');
  });
});
