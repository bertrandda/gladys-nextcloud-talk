// -----------------------------------------------------------------------------
// Texts the bot writes in Nextcloud Talk by itself (everything else is a
// Gladys answer, already in the user's language).
//
// Before the contact is linked, the bot does not know the user's language:
// those messages carry both languages.
// -----------------------------------------------------------------------------

const TEXTS = {
  notLinked: {
    en: 'This conversation is not linked to a Gladys account yet. In Gladys, open Integrations → Nextcloud Talk, click "Link my account" and send me the code it shows.',
    fr: "Cette conversation n'est pas encore liée à un compte Gladys. Dans Gladys, ouvrez Intégrations → Nextcloud Talk, cliquez sur « Lier mon compte » et envoyez-moi le code affiché.",
  },
  invalidCode: {
    en: 'This is not a valid linking code, or it expired. In Gladys, open Integrations → Nextcloud Talk, click "Link my account" and send me the new code within 15 minutes.',
    fr: "Ce n'est pas un code de liaison valide, ou il a expiré. Dans Gladys, ouvrez Intégrations → Nextcloud Talk, cliquez sur « Lier mon compte » et envoyez-moi le nouveau code dans les 15 minutes.",
  },
  linked: {
    en: (name) => `Hello ${name}! This conversation is now linked to your Gladys account.`,
    fr: (name) => `Bonjour ${name} ! Cette conversation est maintenant liée à votre compte Gladys.`,
  },
};

/** Pick the French text for a French-speaking user, English otherwise. */
export function pickLanguage(language) {
  return String(language ?? '')
    .toLowerCase()
    .startsWith('fr')
    ? 'fr'
    : 'en';
}

/** Both languages, French first (the bot cannot tell which one the user reads). */
function bilingual({ en, fr }) {
  return `${fr}\n\n${en}`;
}

export const notLinkedText = () => bilingual(TEXTS.notLinked);

export const invalidCodeText = () => bilingual(TEXTS.invalidCode);

export const linkedText = (user) =>
  TEXTS.linked[pickLanguage(user?.language)](user?.first_name ?? '');
