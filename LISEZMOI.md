# Carnet de cueillette – installation

Application web installable (PWA) : carte IGN, trouvailles avec photos, zones « rien trouvé »,
traces GPS datées, guide des champignons par saison, secteurs proposés dans les Bouches-du-Rhône.

## Pourquoi il faut l'héberger
Le GPS d'un téléphone n'est accessible à une page web que si elle est servie en **https://**.
Ouvrir `index.html` directement depuis les fichiers du téléphone ne marchera pas pour le GPS.

## Option 1 – Netlify Drop (la plus simple, gratuite)
1. Sur un ordinateur, ouvrir https://app.netlify.com/drop
2. Glisser-déposer le **dossier** décompressé (celui qui contient `index.html`).
3. Netlify donne une adresse du type `https://nom-au-hasard.netlify.app`. La noter.
   (Créer un compte gratuit permet de garder l'adresse dans le temps.)

## Option 2 – GitHub Pages (gratuite)
1. Créer un dépôt sur github.com, y envoyer tous les fichiers (bouton « Add file > Upload files »).
2. Settings > Pages > Source : branche `main`, dossier `/ (root)`.
3. L'adresse sera `https://<votre-compte>.github.io/<dépôt>/`.

## Sur le téléphone
- Ouvrir l'adresse https, accepter l'accès à la position.
- Android (Chrome) : menu ⋮ > « Ajouter à l'écran d'accueil ».
- iPhone (Safari) : bouton Partager > « Sur l'écran d'accueil ».

## Utilisation
- **Démarrer la sortie** en arrivant : la trace se dessine en rouge, avec date et heures.
- **J'ai trouvé** : espèce, quantité, note, photos (appareil ou galerie).
- **Rien ici** : cercle de 25 à 500 m autour de vous, ou zone dessinée à la main.
- **Signet** : parking, coin à revoir, etc.
- Appui long sur la carte : ajouter un repère à cet endroit précis.
- Le bouton de calques (en haut à droite) : Plan IGN, photos aériennes, OpenStreetMap, et
  affichage/masquage des traces, zones et secteurs proposés.

## Limites à connaître
- Une appli web **ne peut pas enregistrer la trace écran verrouillé** ou en arrière-plan.
  Pendant une sortie, l'appli demande à garder l'écran allumé (si le téléphone l'accepte).
- Les données restent **sur le téléphone** (stockage du navigateur). Faire régulièrement
  « Sauvegarder tout » dans Lieux & infos (fichier .json avec photos) ; « Restaurer » pour récupérer.
- Hors réseau : l'appli s'ouvre, seules les zones de carte déjà affichées restent visibles.
- Les photos d'espèces viennent de Wikipédia (connexion nécessaire la première fois).

## Modifier le contenu
- `especes.js` : fiches comestibles et toxiques (mois de pousse, habitat, confusions).
- `lieux.js` : secteurs proposés (nom, coordonnées, rayon, conseils).
Après modification, changer `cueillette-app-v1` en `v2` dans `sw.js` pour forcer la mise à jour.

**Aucune fiche ne remplace un contrôle par un pharmacien ou un mycologue.**
Centre antipoison de Marseille : 04 91 75 25 25 – urgence vitale : 15 ou 112.
