// -----------------------------------------------------------------------------
// Handlers of the buttons declared in the manifest `actions` field, keyed by
// their `key`; index.js registers each one with `gladys.onAction(key, ...)`.
// The resolved multi-language message is displayed under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured } from './config.js';
import { ROOM_TYPES } from './nextcloud.js';
import { statusMessageFor } from './bot.js';

const logger = createLogger({ name: 'actions' });

export const ACTIONS = {
  /**
   * Check the URL and the credentials of the saved configuration, and count
   * the private conversations the bot can answer in.
   * @param {{ config: object, createClient: (config: object) => import('./nextcloud.js').NextcloudTalkClient }} context
   */
  async test_connection({ config, createClient }) {
    if (!isConfigured(config)) {
      return {
        en: 'Fill in the Nextcloud URL, the bot login and its app password, then save.',
        fr: "Renseignez l'URL de Nextcloud, l'identifiant du bot et son mot de passe d'application, puis enregistrez.",
      };
    }
    const client = createClient(config);
    try {
      const me = await client.getCurrentUser();
      const rooms = await client.listRooms();
      const count = rooms.filter((room) => room.type === ROOM_TYPES.ONE_TO_ONE).length;
      const name = me.displayname || me.id;
      return {
        en: `Connected as ${name}: ${count} private conversation(s).`,
        fr: `Connecté en tant que ${name} : ${count} conversation(s) privée(s).`,
      };
    } catch (error) {
      logger.warn(`Connection test failed: ${error.message}`);
      return statusMessageFor(error);
    }
  },
};
