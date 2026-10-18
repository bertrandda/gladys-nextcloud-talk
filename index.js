// -----------------------------------------------------------------------------
// Entry point of the Nextcloud Talk integration for Gladys.
//
// Role of this file: wire the SDK to the Talk bot (src/bot.js). It holds NO
// Nextcloud logic. It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. (re)starts the bot with the configuration filled in by the admin.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig } from './src/config.js';
import { NextcloudTalkClient } from './src/nextcloud.js';
import { TalkBot, statusMessageFor } from './src/bot.js';
import { ACTIONS } from './src/actions.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();
let bot = null;

const createClient = (cfg) =>
  new NextcloudTalkClient({
    url: cfg.nextcloud_url,
    username: cfg.bot_username,
    password: cfg.bot_password,
  });

// --- Outgoing: Gladys answers a user, or notifies them ----------------------
// `contact.id` is the token of the conversation the user linked. Throwing acks
// the delivery as failed.
gladys.onSendMessage(async (contact, message) => {
  logger.debug(`onSendMessage -> conversation ${contact.id}`);
  if (!bot) {
    throw new Error('Nextcloud Talk is not configured');
  }
  await bot.send(contact, message);
});

// --- Manifest actions: buttons in the Configuration screen -------------------
for (const [actionKey, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(actionKey, (fields) => handler({ fields, config, createClient }));
}

// --- Configuration updated by the admin --------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> restarting the bot');
  config = normalizeConfig(newConfig);
  await startBot();
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK itself logs the WebSocket lifecycle under the `gladys-sdk` name.
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    await startBot();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

// Messages read while disconnected from Gladys could not be published: stop
// reading, the next connection starts again from the latest message.
gladys.on('disconnected', () => stopBot());

// (Re)start the bot with the current configuration and report the outcome in
// the Configuration screen.
async function startBot() {
  stopBot();
  if (!isConfigured(config)) {
    await gladys.setConnectionStatus(false, {
      en: 'Fill in the Nextcloud URL, the bot login and its app password.',
      fr: "Renseignez l'URL de Nextcloud, l'identifiant du bot et son mot de passe d'application.",
    });
    return;
  }
  const candidate = new TalkBot({ gladys, client: createClient(config) });
  bot = candidate;
  try {
    // Reports the connected status itself once Nextcloud answered.
    await candidate.start();
  } catch (err) {
    if (bot !== candidate) {
      return; // superseded by a newer configuration
    }
    bot = null;
    logger.error(`Connecting to Nextcloud failed: ${err.message}`);
    await gladys.setConnectionStatus(false, statusMessageFor(err));
  }
}

function stopBot() {
  bot?.stop();
  bot = null;
}

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopBot();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Nextcloud Talk integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
