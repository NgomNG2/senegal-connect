/**
 * src/middleware/upload.js
 * -----------------------------------------------------------------------
 * "Types autorisés : images (JPEG, PNG), documents (PDF), audio (MP3,
 *  WAV, OGG). Taille max : 10 Mo. Le serveur génère un nom de fichier
 *  unique (UUID + extension)."
 * Liste alignée EXACTEMENT sur cette énumération dans le schéma OpenAPI (Swagger) : TicketMessage.type
 *   type: string
 *   enum: [texte, fichier, image, audio]
 * 
 */

const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { ErreurApplicative } = require('./erreurs');

const TYPES_AUTORISES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'audio/mpeg', // MP3
  'audio/wav',
  'audio/ogg',
];

const stockage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR || 'uploads'),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    cb(null, `${uuidv4()}${extension}`);
  },
});

const upload = multer({
  storage: stockage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10 * 1024 * 1024 }, // 10 Mo par défaut
  fileFilter: (req, file, cb) => {
    if (!TYPES_AUTORISES.includes(file.mimetype)) {
      // ErreurApplicative (pas une Error générique) : gestionnaireErreurs.js
      // la reconnaît directement et renvoie un 422 propre, au lieu de
      // tomber dans la branche 500 générique.
      return cb(new ErreurApplicative(422, `Type de fichier non autorisé : ${file.mimetype}`));
    }
    cb(null, true);
  },
});

module.exports = upload;