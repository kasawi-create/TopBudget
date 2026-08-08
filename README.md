# BudgetBacker — app mobile Android

Projet React (Vite) + Capacitor prêt à être compilé en `.apk` via GitHub Actions.

## 1. Mettre le projet sur GitHub

1. Crée un nouveau dépôt **vide** sur https://github.com/new (ne coche ni README ni .gitignore).
2. Dans un terminal, à la racine de ce dossier :

```bash
git init
git add .
git commit -m "Premier import"
git branch -M main
git remote add origin https://github.com/TON-COMPTE/TON-DEPOT.git
git push -u origin main
```

## 2. Récupérer l'APK compilé

1. Sur GitHub, ouvre l'onglet **Actions** de ton dépôt.
2. Le workflow **"Build APK"** se lance automatiquement après le push (~3-5 min).
   S'il ne démarre pas, clique dessus puis **"Run workflow"**.
3. Une fois terminé (coche verte ✅), ouvre l'exécution, descends jusqu'à
   **Artifacts** et télécharge `budgetbacker-debug-apk` (un `.zip` contenant
   `app-debug.apk`).

## 3. Installer l'APK sur ton téléphone

1. Transfère `app-debug.apk` sur ton téléphone (câble, Drive, WhatsApp…).
2. Ouvre le fichier depuis le téléphone. Android demandera d'autoriser
   l'installation depuis "cette source" — accepte (Réglages > Sécurité >
   Sources inconnues, selon la version d'Android).
3. L'app "BudgetBacker" s'installe et apparaît dans le menu des apps.

C'est un APK **debug** (signé avec la clé de debug par défaut) : parfait pour
tester sur ton téléphone. Il n'est pas destiné au Play Store tel quel (il
faudrait une signature "release" pour ça).

## Développement local (optionnel)

```bash
npm install
npm run dev        # aperçu dans le navigateur (http://localhost:5173)
npm run build       # build web de production dans dist/
npx cap sync android  # copie le build web dans le projet Android
```

Pour ouvrir le projet dans Android Studio (si tu l'installes plus tard) :

```bash
npx cap open android
```

## Notes sur les fonctionnalités

- **Stockage local** : les données sont sauvegardées sur l'appareil via
  `@capacitor/preferences` (voir `src/storage.js`), aucune connexion internet
  requise pour l'usage courant.
- **Export CSV / Excel** : utilise le panneau de partage natif Android
  (`@capacitor/filesystem` + `@capacitor/share`) au lieu du téléchargement
  navigateur.
- **Synchro Google Drive** : désactivée dans cette version (elle dépendait de
  l'environnement Claude.ai). Le bouton affiche un message clair au lieu
  d'échouer silencieusement — voir `saveToDrive`/`loadFromDrive` dans
  `src/BudgetTracker.jsx` si tu veux la remplacer par une vraie intégration
  plus tard.
