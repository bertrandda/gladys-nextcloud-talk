# Nextcloud Talk

Discutez avec Gladys depuis [Nextcloud Talk](https://nextcloud.com/fr/talk/) :
posez des questions sur votre maison, lancez des scènes, et recevez les
notifications et les images de caméras que Gladys vous envoie, dans une
conversation privée avec un compte bot.

## Fonctionnement

L'intégration se connecte à votre Nextcloud avec **un compte dédié à
Gladys** (le bot). Chaque utilisateur de Gladys ouvre une **conversation
privée (en tête-à-tête)** avec ce compte dans Talk, et la lie à son compte
Gladys avec un code court. Dès lors, ce qu'il écrit dans cette conversation
parvient à Gladys avec ses droits, et Gladys y répond.

Seules les conversations en tête-à-tête sont prises en compte : dans une
conversation de groupe, chaque membre parlerait au nom de l'utilisateur qui
l'a liée. Les conversations de groupe du compte bot sont simplement ignorées.

## 1. Créer le compte bot (administrateur Nextcloud)

1. Dans Nextcloud, créez un utilisateur pour Gladys, par exemple `gladys`,
   avec un nom d'affichage comme « Gladys ». Vérifiez que l'application Talk
   lui est accessible.
2. Connectez-vous avec cet utilisateur, ouvrez **Paramètres → Sécurité**, et
   dans **Appareils & sessions** créez un **mot de passe d'application**
   (nommez-le « Gladys »). Copiez-le : il n'est affiché qu'une fois. Un mot de
   passe d'application se révoque à tout moment sans changer le mot de passe
   du compte, et fonctionne même avec l'authentification à deux facteurs.

## 2. Configurer l'intégration (administrateur Gladys)

1. Ouvrez l'onglet **Configuration** de l'intégration Nextcloud Talk.
2. Renseignez :
   - **URL de Nextcloud** : l'adresse de votre instance telle que Gladys peut
     la joindre, par exemple `https://cloud.example.com` (ajoutez le
     sous-chemin si Nextcloud n'est pas à la racine, ex.
     `https://example.com/nextcloud`) ;
   - **Identifiant du bot** : l'identifiant du compte créé plus haut ;
   - **Mot de passe d'application du bot** : le mot de passe d'application
     créé plus haut.
3. Enregistrez, puis cliquez sur **Tester la connexion** : le compte utilisé
   par Gladys et le nombre de conversations privées visibles s'affichent.

## 3. Lier votre compte (chaque utilisateur de Gladys)

1. Dans Nextcloud Talk, démarrez une **conversation privée** avec le compte
   bot (cherchez son nom dans « Démarrer une nouvelle conversation »).
2. Dans Gladys, ouvrez l'intégration Nextcloud Talk et cliquez sur **Lier mon
   compte** : Gladys affiche un code court, valable 15 minutes.
3. Envoyez ce code dans la conversation Talk. Le bot répond que la
   conversation est désormais liée à votre compte.

Vous pouvez maintenant écrire à Gladys dans cette conversation (« quelle est
la température du salon ? »), et choisir Nextcloud Talk dans les scènes qui
vous envoient des messages. Vous pouvez révoquer la liaison à tout moment
depuis le même écran.

## Bon à savoir

- Le bot répond en quelques secondes : il écoute chaque conversation en
  continu. Une nouvelle conversation est détectée en moins de 30 secondes.
- Les messages écrits pendant que l'intégration est arrêtée ne sont pas
  exécutés à son redémarrage, pour qu'un ancien ordre (ouvrir une porte…) ne
  s'exécute jamais en retard.
- Les images envoyées par Gladys (captures de caméras) sont déposées dans le
  dossier `Talk` du compte bot, puis partagées dans la conversation.

## Dépannage

- **« Nextcloud a refusé les identifiants du bot »** : vérifiez
  l'identifiant, et créez un nouveau mot de passe d'application si besoin.
  L'identifiant est celui de l'utilisateur, pas son adresse e-mail.
- **« Nextcloud est injoignable »** : vérifiez que l'URL est joignable depuis
  la machine qui fait tourner Gladys (pas seulement depuis votre navigateur)
  et que son certificat HTTPS est valide.
- **Le bot ne répond pas** : vérifiez qu'il s'agit d'une conversation en
  tête-à-tête avec le compte bot, et consultez les logs de l'intégration dans
  Gladys.
- **« Ce n'est pas un code de liaison valide, ou il a expiré »** : générez un nouveau code dans
  Gladys et envoyez-le dans les 15 minutes ; chaque code ne sert qu'une fois.
