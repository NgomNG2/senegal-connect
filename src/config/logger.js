/**
 * src/config/logger.js
 * -----------------------------------------------------------------------
 * Journalisation centralisée avec Winston.
 * 
 * Pourquoi Winston ?
 * Winston est un module de journalisation flexible et populaire pour Node.js. Il permet de gérer plusieurs niveaux de journalisation, de formater les messages, et d'envoyer les journaux vers différentes destinations (console, fichiers, services externes).
 * 
 * Pourquoi un logger centralisé ?
 * Avoir un logger centralisé permet de standardiser la manière dont les messages sont enregistrés dans l'application. Cela facilite le débogage, la surveillance et l'analyse des problèmes.
 * 
 * Niveaux de journalisation :
 * - error : erreurs critiques qui nécessitent une attention immédiate.
 * - warn  : avertissements sur des situations inhabituelles mais non critiques.
 * - info  : informations générales sur le fonctionnement de l'application.
 * - http  : informations sur les requêtes HTTP entrantes (si activé).
 * - verbose : informations détaillées pour le débogage.    
*/

const winston = require('winston');

// Récupère les utilitaires de formatage fournis par Winston.
const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// Définit l'environnement et le niveau de journalisation utilisés par défaut.
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Format lisible et coloré pour les journaux en développement.
const formatDev = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp: ts, level, message }) => `${ts} [${level}] ${message}`)
);

// Format JSON adapté à la collecte et à l'analyse des journaux en production.
const formatProd = combine(timestamp(), errors({ stack: true }), json());

// Prépare la liste des sorties de journalisation selon l'environnement.
const transports = [];

if (NODE_ENV === 'test') {
  // Désactive les sorties pendant l'exécution des tests.
  transports.push(new winston.transports.Console({ silent: true }));
} else if (NODE_ENV === 'production') {
  // En production, écrit dans la console ainsi que dans des fichiers dédiés.
  transports.push(
    new winston.transports.Console({ format: formatProd }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error', format: formatProd }),
    new winston.transports.File({ filename: 'logs/combined.log', format: formatProd })
  );
} else {
  // En développement, affiche les journaux dans la console avec un format lisible.
  transports.push(new winston.transports.Console({ format: formatDev }));
}

// Crée le logger Winston avec les niveaux npm et la configuration sélectionnée.
const logger = winston.createLogger({
  level: LOG_LEVEL,
  levels: winston.config.npm.levels,
  silent: NODE_ENV === 'test',
  transports,
  exitOnError: false,
});

// Adapte l'interface de flux attendue par certains middlewares HTTP.
logger.stream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = logger;