/**
 * public/js/webrtc.js — PeerJS client + gestion flux vidéo + partage écran.
 * Chargé AVANT app.js (voir index.html). N'accède à `socket` qu'à
 * l'intérieur de fonctions (jamais au chargement du fichier) : au moment
 * où ce fichier s'exécute, la connexion Socket.IO n'existe pas encore
 * (elle n'est créée qu'après le login, dans app.js).
 *
 * attacherEcouteursAppelsSocket(s) est appelée DEPUIS app.js, juste après
 * la création du socket — c'est le seul endroit où ce fichier enregistre
 * des écouteurs socket.on(...), pour éviter le bug classique où ces
 * écouteurs s'enregistrent sur un socket encore inexistant (null).
 */

let peer = null;
let appelEnCours = null;
let fluxLocal = null;
let pisteVideoOriginale = null;
let partageEcranActif = false;
let intervalChrono = null;

// Pending renegotiation promises: appelId -> { resolve, reject }
const pendingReneg = {}; 


// Helper: initiate SDP renegotiation on a peer connection and wait for remote answer via socket
async function renegocierSDP(pc, appelId) {
  if (!pc) throw new Error('No peerConnection for renegociation');
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // send offer.sdp via socket; attacherEcouteursAppelsSocket registers handlers
    if (!socket) throw new Error('socket non initialisé');

    return new Promise((resolve, reject) => {
      // store resolver to be used when 'appel:renegocier_reponse' arrives
      pendingReneg[appelId] = { resolve, reject };
      try {
        socket.emit('appel:renegocier_offre', { appelId, sdp: pc.localDescription.sdp });
      } catch (e) {
        delete pendingReneg[appelId];
        reject(e);
      }
      // Timeout
      setTimeout(() => {
        if (pendingReneg[appelId]) {
          pendingReneg[appelId].reject(new Error('Timeout renegociation')); delete pendingReneg[appelId];
        }
      }, 4000);
    });
  } catch (e) {
    throw e;
  }
}

function initialiserPeer(monUtilisateurId) {
  return new Promise((resolve, reject) => {
    peer = new Peer(`sc-${monUtilisateurId}-${Date.now()}`, {
      host: window.location.hostname,
      port: 9000,
      path: '/peerjs',
    });

    peer.on('call', (appelMedia) => {
      // Répondre en envoyant notre flux local (s'il est présent)
      appelMedia.answer(fluxLocal);

      appelMedia.on('stream', (fluxDistant) => {
        document.getElementById('video-distante').srcObject = fluxDistant;
      });
      if (appelEnCours) appelEnCours.connexionMedia = appelMedia;
    });

    peer.on('error', (err) => {
      afficherNotification('Erreur de connexion vidéo (PeerJS).', 'erreur');
    });

    peer.on('open', (id) => resolve(id));
  });
}

/**
 * echoCancellation/noiseSuppression/autoGainControl réduisent le bruit et
 * l'écho LOGICIEL, mais ne peuvent pas supprimer l'écho ACOUSTIQUE si tu
 * testes deux appels sur le même poste sans casque : le micro capte alors
 * le son sorti par les haut-parleurs de l'autre onglet. Pour un test sans
 * écho : casque sur au moins un poste, ou deux machines différentes.
 */
async function demarrerCaptureLocale(type) {
  // Stopper proprement un flux déjà existant pour libérer la caméra/micro
  try {
    if (fluxLocal) {
      fluxLocal.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* ignore */ } });
      fluxLocal = null;
    }
  } catch (e) {
  }

  const contraintes = {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: type === 'video',
  };

  // Tentative principale pour obtenir le flux
  try {
    fluxLocal = await navigator.mediaDevices.getUserMedia(contraintes);
  } catch (err) {
    // Cas fréquent : appareil occupé par un autre onglet/app ou piste non libérée

    if (err && (err.name === 'NotReadableError' || (err.message && err.message.toLowerCase().includes('device in use')))) {
      // Tenter d'arrêter les pistes attachées aux <video> présents dans la page
      try {
        document.querySelectorAll('video').forEach(v => {
          try {
            if (v.srcObject && v.srcObject.getTracks) {
              v.srcObject.getTracks().forEach(t => { try { t.stop(); } catch (e) { } });
              v.srcObject = null;
            }
          } catch (e) { }
        });
      } catch (e) { }

      // Petite pause avant nouvelle tentative
      await new Promise(r => setTimeout(r, 500));

      // Retenter une seconde fois
      try {
        fluxLocal = await navigator.mediaDevices.getUserMedia(contraintes);
      } catch (err2) {
        afficherNotification("Impossible d'accéder au micro/caméra. Ferme d'autres onglets ou applications utilisant la caméra, ou redémarre le navigateur.", 'erreur');
        throw err2; // laisser la gestion d'erreur en amont
      }
    } else {
      // Erreur autre que NotReadableError — laisser remonter
      throw err;
    }
  }

  const videoLocale = document.getElementById('video-locale');
  if (videoLocale) {
    videoLocale.srcObject = fluxLocal;
    videoLocale.muted = true; // vidéo locale toujours muted, sinon retour audio de soi-même
  }

  if (type === 'video' && fluxLocal && fluxLocal.getVideoTracks().length) pisteVideoOriginale = fluxLocal.getVideoTracks()[0];
}

// ============================================================================
// Fonctionnalité 1/2 — initier un appel audio ou vidéo 1-à-1
// ============================================================================
async function initierAppel(ticketId, type) {
  if (!ticketId) return afficherNotification("Sélectionne un ticket d'abord.", 'erreur');
  try {
    await demarrerCaptureLocale(type);
    const monPeerId = await initialiserPeer(window.utilisateurCourant.id);

    socket.emit('appel:initier', { ticketId, type, peerId: monPeerId }, (reponse) => {
      if (reponse.erreur) {
        afficherNotification(reponse.erreur, 'erreur');
        fluxLocal?.getTracks().forEach((p) => p.stop());
        return;
      }
      appelEnCours = { appelId: reponse.appelId, type };
      afficherEcranAppel();
    });
  } catch (erreur) {
    afficherNotification("Impossible d'accéder au micro/caméra.", 'erreur');
  }
}

async function accepterAppel() {
  if (!appelEnCours) return;
  try {
    await demarrerCaptureLocale(appelEnCours.type);
    const monPeerId = await initialiserPeer(window.utilisateurCourant.id);

    socket.emit('appel:accepter', { appelId: appelEnCours.appelId, peerId: monPeerId }, (reponse) => {
      if (reponse.erreur) return afficherNotification(reponse.erreur, 'erreur');
      afficherEcranAppel();
      demarrerChronometre();
    });
  } catch (erreur) {
    afficherNotification("Impossible d'accéder au micro/caméra.", 'erreur');
  }
}

function refuserAppelEntrant() {
  if (appelEnCours) socket.emit('appel:refuser', { appelId: appelEnCours.appelId });
  document.getElementById('bandeau-appel-entrant').classList.add('cache');
  appelEnCours = null;
}

// ============================================================================
// Fonctionnalité 4 — contrôles pendant l'appel
// ============================================================================
function basculerMicro() {
  const piste = fluxLocal?.getAudioTracks()[0];
  if (!piste) return;
  piste.enabled = !piste.enabled;
  envoyerEtatControle();
  document.getElementById('bouton-micro').classList.toggle('actif', !piste.enabled);
}

function basculerCamera() {
  const piste = fluxLocal?.getVideoTracks()[0];
  if (!piste) return;
  piste.enabled = !piste.enabled;
  envoyerEtatControle();
  document.getElementById('bouton-camera').classList.toggle('actif', !piste.enabled);
}

// ============================================================================
// Fonctionnalité 3 — partage d'écran par remplacement de piste (replaceTrack),
// sans fermer ni recréer la connexion WebRTC.
// ============================================================================
async function basculerPartageEcran() {
  if (!appelEnCours?.connexionMedia) return;

  const pc = appelEnCours.connexionMedia.peerConnection;
  let sender = pc?.getSenders().find((s) => s.track && s.track.kind === 'video');

  // Si aucun sender vidéo n'existe (appel audio-only), proposer d'activer la caméra
  if (!sender) {
    const wantsCamera = confirm("L'appel est actuellement audio-only. Voulez-vous activer la caméra pour démarrer le partage d'écran ?");
    if (!wantsCamera) return; // utilisateur refuse

    try {
      // Demander la caméra localement
      await demarrerCaptureLocale('video');
    } catch (err) {
      afficherNotification("Impossible d'activer la caméra.", 'erreur');
      return;
    }

    // Rechercher un sender vidéo — s'il n'existe toujours pas, tenter d'en créer un
    sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (!sender) {
      try {
        // Ajouter la piste vidéo au RTCPeerConnection — cela peut déclencher une renégociation
        const trackToAdd = fluxLocal.getVideoTracks()[0];
        if (!trackToAdd) throw new Error('Aucune piste vidéo disponible après activation de la caméra');
        const newSender = pc.addTrack(trackToAdd, fluxLocal);
        // Mettre à jour la référence
        sender = newSender;
      } catch (err) {
        afficherNotification("Caméra activée localement. Pour l'envoyer à l'abonné, relancez l'appel vidéo.", 'erreur');
        const videoLocaleEl = document.getElementById('video-locale');
        if (videoLocaleEl) videoLocaleEl.srcObject = fluxLocal;
        return;
      }
    }
  }

  if (!partageEcranActif) {
    try {
      // Préserver la piste vidéo originale si besoin
      if (!pisteVideoOriginale && fluxLocal && fluxLocal.getVideoTracks().length) {
        pisteVideoOriginale = fluxLocal.getVideoTracks()[0];
      }

      const fluxEcran = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const pisteEcran = fluxEcran.getVideoTracks()[0];

      // Remplacer la piste envoyée sans recreer la connexion (replaceTrack)
      await sender.replaceTrack(pisteEcran);

      // Afficher localement l'aperçu du partage d'écran
      const videoLocaleEl = document.getElementById('video-locale');
      if (videoLocaleEl) videoLocaleEl.srcObject = fluxEcran;

      // Quand l'utilisateur arrête le partage via l'UI du navigateur, restaurer
      pisteEcran.onended = async () => {
        try {
          if (pisteVideoOriginale) {
            await sender.replaceTrack(pisteVideoOriginale);
          }
        } catch (err) {
        }

        // Restaurer l'aperçu local
        if (videoLocaleEl) videoLocaleEl.srcObject = fluxLocal;

        partageEcranActif = false;
        envoyerEtatControle();
        document.getElementById('indicateur-partage').classList.add('cache');
        document.getElementById('bouton-partage-ecran').classList.remove('actif');
      };

      // Mettre à jour l'état et l'UI
      partageEcranActif = true;
      document.getElementById('indicateur-partage').classList.remove('cache');
      document.getElementById('bouton-partage-ecran').classList.add('actif');

      // Informer l'abonné via envoyerEtatControle (socket)
      envoyerEtatControle();

      // Tentative de renégociation SDP pour forcer la propagation de la nouvelle piste
      try {
        if (appelEnCours?.connexionMedia?.peerConnection) {
          try {
            const answerSdp = await renegocierSDP(appelEnCours.connexionMedia.peerConnection, appelEnCours.appelId);
            if (answerSdp && appelEnCours?.connexionMedia?.peerConnection) {
              try {
                await appelEnCours.connexionMedia.peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
              } catch (e) { /* erreur en appliquant remoteDescription apres renegociation */ }
            }
          } catch (e) {
          }
        }
      } catch (e) {  }

      // Petit dépannage automatique: forcer le remote à ré-attacher le flux s'il ne voit pas le changement
      try {
        // envoyer un signal via socket pour demander au remote de rafraîchir l'élément video
        if (socket && appelEnCours?.appelId) {
          socket.emit('appel:partage_demande_refresh', { appelId: appelEnCours.appelId });
          // Signaler explicitement le démarrage du partage (diagnostic + trigger remote)
          socket.emit('appel:partage_demarrage', { appelId: appelEnCours.appelId });
          // initialiser l'accuse reception
          if (appelEnCours) appelEnCours.partageRecue = false;

          // Attendre un accusé de réception court; si absent, faire fallback: ouvrir un call séparé avec le flux écran
          (async () => {
            const attenteMs = 1200;
            await new Promise(r => setTimeout(r, attenteMs));
            try {
              if (!(appelEnCours && appelEnCours.partageRecue)) {
                // pas d'accusé => fallback
                const remoteId = appelEnCours?.peerIdDest || appelEnCours?.peerIdInitiateur;
                if (remoteId) {
                  try {
                    const callScreen = peer.call(remoteId, fluxEcran, { metadata: { type: 'screen-fallback' } });
                    appelEnCours.connexionScreenFallback = callScreen;
                    // optional: fermer le callScreen quand le fluxEcran s'arrête
                    fluxEcran.getVideoTracks()[0].onended = () => { try { callScreen.close(); } catch (e) {} };
                  } catch (e) { /* fallback call error */ }
                } else {
                  /* Fallback impossible — remote peer id absent */
                }
              } 
            } catch (e) { /* Erreur durant la logique fallback partage écran */ }
          })();
        }
      } catch (e) { /* erreur en émettant signal de partage */ }
    } catch (erreur) {
  
      afficherNotification("Partage d'écran annulé ou impossible.", 'erreur');
      return;
    }
  } else {
    // Arrêter le partage programmé via notre UI : restaurer la piste caméra
    try {
      if (pisteVideoOriginale) await sender.replaceTrack(pisteVideoOriginale);
    } catch (err) {
      afficherNotification("Impossible de restaurer la caméra après partage d'écran.", 'erreur');
    }

    const videoLocaleEl = document.getElementById('video-locale');
    if (videoLocaleEl) videoLocaleEl.srcObject = fluxLocal;

    partageEcranActif = false;
    document.getElementById('indicateur-partage').classList.add('cache');
    document.getElementById('bouton-partage-ecran').classList.remove('actif');

    // Informer l'abonné
    envoyerEtatControle();
  }
}

function envoyerEtatControle() {
  if (!appelEnCours) return;
  socket.emit('appel:controle', {
    appelId: appelEnCours.appelId,
    micro: fluxLocal?.getAudioTracks()[0]?.enabled ?? true,
    video: fluxLocal?.getVideoTracks()[0]?.enabled ?? true,
    partageEcran: partageEcranActif,
  });
}

// ============================================================================
// Fonctionnalité 5 — chronomètre mm:ss
// ============================================================================
function demarrerChronometre() {
  clearInterval(intervalChrono);
  const debut = Date.now();
  intervalChrono = setInterval(() => {
    const ecoule = Math.floor((Date.now() - debut) / 1000);
    const minutes = String(Math.floor(ecoule / 60)).padStart(2, '0');
    const secondes = String(ecoule % 60).padStart(2, '0');
    document.getElementById('chronometre').textContent = `${minutes}:${secondes}`;
  }, 1000);
}

function nettoyerAppel() {
  clearInterval(intervalChrono);
  fluxLocal?.getTracks().forEach((piste) => piste.stop());
  appelEnCours?.connexionMedia?.close();
  peer?.destroy();
  peer = null;
  fluxLocal = null;
  partageEcranActif = false;
  appelEnCours = null;
  masquerEcranAppel();
}

function raccrocher() {
  if (appelEnCours) socket.emit('appel:terminer', { appelId: appelEnCours.appelId });
  nettoyerAppel();
}

// ============================================================================
// Écouteurs socket liés aux appels — enregistrés depuis app.js une fois le
// socket réellement créé (voir en-tête du fichier).
// ============================================================================
function attacherEcouteursAppelsSocket(s) {
  // conserver le socket dans une variable globale pour les helpers (renegociation)
  socket = s;

  s.on('appel:entrant', (donnees) => {
    appelEnCours = { appelId: donnees.appelId, peerIdInitiateur: donnees.peerId_init, type: donnees.type };
    afficherSonnerie(donnees.initiateur.nom, donnees.type);
  });

  s.on('appel:accepte', ({ peerId_dest }) => {
    // conserver l'id du peer distant pour usages ultérieurs (partage d'écran fallback)
    if (appelEnCours) appelEnCours.peerIdDest = peerId_dest;

    const appelMedia = peer.call(peerId_dest, fluxLocal);
    appelMedia.on('stream', (fluxDistant) => {
      document.getElementById('video-distante').srcObject = fluxDistant;
    });
    if (appelEnCours) appelEnCours.connexionMedia = appelMedia;
    afficherEcranAppel();
    demarrerChronometre();
  });

  s.on('appel:controle', ({ micro, video, partageEcran }) => {
    document.getElementById('icone-micro-distant').classList.toggle('cache', micro);
    document.getElementById('icone-camera-distant').classList.toggle('cache', video);
    document.getElementById('indicateur-partage-distant').classList.toggle('cache', !partageEcran);

    // Si le remote indique partageEcran, forcer un rafraîchissement du video element
    try {
      const videoDist = document.getElementById('video-distante');
      if (partageEcran && videoDist && videoDist.srcObject) {
        const stream = videoDist.srcObject;
        // detach puis ré-attacher pour forcer la mise à jour visuelle si nécessaire
        videoDist.srcObject = null;
        setTimeout(() => {
          videoDist.srcObject = stream;
          videoDist.play().catch(() => {});
        }, 150);
      }
    } catch (e) { /* erreur rafraîchissement video-distante */ }
  });

  // Handler pour la demande explicite de refresh envoyée par l'initiateur du partage
  s.on('appel:partage_demande_refresh', ({ appelId }) => {
    try {
      const videoDist = document.getElementById('video-distante');
      if (videoDist && videoDist.srcObject) {
        const stream = videoDist.srcObject;
        videoDist.srcObject = null;
        setTimeout(() => {
          videoDist.srcObject = stream;
          videoDist.play().catch(() => {});
        }, 150);
      }
    } catch (e) { /* erreur en réponse au refresh de partage */ }
  });

  // Le destinataire répond au signal 'partage_demarrage' en envoyant un accusé de réception
  s.on('appel:partage_demarrage', ({ appelId }) => {
    // Tenter de reconstituer le stream depuis les receivers (déjà existant dans le code)
    try {
      if (appelEnCours?.connexionMedia?.peerConnection) {
        const pc = appelEnCours.connexionMedia.peerConnection;
        try {
          const receivers = pc.getReceivers();
          const tracks = receivers.map(r => r.track).filter(Boolean);
          if (tracks.length) {
            const rebuilt = new MediaStream(tracks);
            const videoDist = document.getElementById('video-distante');
            if (videoDist) {
              videoDist.srcObject = rebuilt;
              videoDist.play().catch(() => {});
            }
            // envoyer accusé de réception au serveur/agent
            s.emit('appel:partage_recu', { appelId, ok: true });
            return;
          }
        } catch (e) { /* erreur en inspectant receivers (partage_demarrage) */ }
      }

      // Si on n'a pas pu reconstituer, envoyer un accusé négatif pour que l'initiateur fasse fallback
      s.emit('appel:partage_recu', { appelId, ok: false });
    } catch (e) { /* erreur en traitant appel:partage_demarrage */ }
  });

  // Handler pour recevoir l'accusé de réception du partage (utilisé par l'initiateur)
  s.on('appel:partage_recu', ({ appelId, ok }) => {
    if (appelEnCours && appelEnCours.appelId === appelId) {
      appelEnCours.partageRecue = !!ok;
    }
  });

  // Handler renegociation SDP: offre depuis initiateur
  s.on('appel:renegocier_offre', async ({ appelId, sdp }) => {
    try {
      if (!appelEnCours?.connexionMedia?.peerConnection) {
        return;
      }
      const pc = appelEnCours.connexionMedia.peerConnection;
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('appel:renegocier_reponse', { appelId, sdp: pc.localDescription.sdp });
    } catch (e) { /* erreur en traitant renegociation offre */ }
  });

  // Handler renegociation SDP: réponse de l'autre pair
  s.on('appel:renegocier_reponse', async ({ appelId, sdp }) => {
    try {
      if (pendingReneg[appelId] && pendingReneg[appelId].resolve) {
        pendingReneg[appelId].resolve(sdp);
        delete pendingReneg[appelId];
      } else if (appelEnCours?.connexionMedia?.peerConnection) {
        const pc = appelEnCours.connexionMedia.peerConnection;
        await pc.setRemoteDescription({ type: 'answer', sdp });
      }
    } catch (e) { /* erreur en appliquant renegociation reponse */ }
  });

  s.on('appel:partage_demarrage', ({ appelId }) => {
    try {
      // Essayer d'inspecter les receivers sur la peerConnection pour reconstituer le stream
      if (appelEnCours?.connexionMedia?.peerConnection) {
        const pc = appelEnCours.connexionMedia.peerConnection;
        try {
          const receivers = pc.getReceivers();
          const tracks = receivers.map(r => r.track).filter(Boolean);
          if (tracks.length) {
            const rebuilt = new MediaStream(tracks);
            const videoDist = document.getElementById('video-distante');
            if (videoDist) {
              videoDist.srcObject = rebuilt;
              videoDist.play().catch(() => {});
            }
          } else {
          /* Aucun receiver contenant de piste trouvée */
          }
        } catch (e) { /* erreur en inspectant receivers */ }
      } else {
        /* Pas de peerConnection disponible pour inspecter les receivers */
      }

    } catch (e) { /* erreur en traitant appel:partage_demarrage */ }
  });

  s.on('appel:termine', () => {
    afficherNotification('Appel terminé.', 'info');
    nettoyerAppel();
  });

  s.on('appel:refuse', () => {
    afficherNotification('Appel refusé.', 'info');
    nettoyerAppel();
  });
}