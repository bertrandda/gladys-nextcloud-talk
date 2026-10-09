// -----------------------------------------------------------------------------
// The Nextcloud Talk bot: bridges the private conversations of the bot account
// and Gladys.
//
// Identity model (bidirectional communication channel, manifest
// `messaging.receive: true`):
//   - ONE Nextcloud account is the bot, configured by the admin;
//   - each Gladys user opens a one-to-one conversation with it and sends the
//     linking code generated in the Gladys UI: the conversation token becomes
//     the contact id (`gladys.linkContact(code, token, name)`);
//   - from then on, every message of that conversation is published with the
//     authority of the linked user (`gladys.publishMessage(token, text)`), and
//     Gladys answers through `onSendMessage({ id: token }, message)`.
//
// Only ONE-TO-ONE conversations are handled: in a group conversation every
// member would speak with the authority of the user who linked it.
//
// Incoming messages: the bot lists its conversations every ROOM_REFRESH_MS
// and keeps one long-polling loop per one-to-one conversation (the Talk server
// holds each request up to 30 s until a message arrives).
// -----------------------------------------------------------------------------

import { setTimeout as delay } from 'node:timers/promises';
import { createLogger } from '@gladysassistant/integration-sdk';
import { ROOM_TYPES } from './nextcloud.js';
import { invalidCodeText, linkedText, notLinkedText } from './texts.js';

const defaultLogger = createLogger({ name: 'talk-bot' });

export const ROOM_REFRESH_MS = 30 * 1000;
// Pause before polling a conversation again after a failure.
export const RETRY_DELAY_MS = 15 * 1000;
// Longest text Gladys accepts from a channel.
export const MAX_MESSAGE_LENGTH = 4096;
// What a linking code can look like: one short word. Anything else sent in a
// conversation not linked yet gets the linking instructions.
const LINK_CODE = /^[A-Za-z0-9-]{4,32}$/;
// A message made only of a rich object placeholder (a shared file, a poll…).
const RICH_OBJECT_ONLY = /^\{[a-z0-9-]+\}$/i;

const STATUS_MESSAGES = {
  unauthorized: {
    en: 'Nextcloud refused the bot credentials: check the login and the app password.',
    fr: "Nextcloud a refusé les identifiants du bot : vérifiez l'identifiant et le mot de passe d'application.",
  },
  unreachable: {
    en: 'Nextcloud is unreachable, check the URL and the integration logs.',
    fr: "Nextcloud est injoignable, vérifiez l'URL et les logs de l'intégration.",
  },
};

/** Connection status message for a Nextcloud failure. */
export function statusMessageFor(error) {
  return error?.status === 401 || error?.status === 403
    ? STATUS_MESSAGES.unauthorized
    : STATUS_MESSAGES.unreachable;
}

const isAbort = (error) => error?.name === 'AbortError';

export class TalkBot {
  /**
   * @param {{
   *   gladys: import('@gladysassistant/integration-sdk').GladysIntegration,
   *   client: import('./nextcloud.js').NextcloudTalkClient,
   *   logger?: ReturnType<typeof createLogger>,
   *   roomRefreshMs?: number,
   *   retryDelayMs?: number,
   * }} options
   */
  constructor({
    gladys,
    client,
    logger = defaultLogger,
    roomRefreshMs = ROOM_REFRESH_MS,
    retryDelayMs = RETRY_DELAY_MS,
  }) {
    this.gladys = gladys;
    this.client = client;
    this.logger = logger;
    this.roomRefreshMs = roomRefreshMs;
    this.retryDelayMs = retryDelayMs;
    this.botUserId = null;
    this.pollers = new Map(); // conversation token -> { lastKnownMessageId }
    this.running = false;
    this.healthy = true;
    this.refreshTimer = null;
    this.abortController = null;
  }

  /**
   * Check the credentials and start listening. Throws when Nextcloud refuses
   * or cannot be reached: the caller reports it.
   */
  async start() {
    this.stop();
    this.abortController = new AbortController();
    this.running = true;
    try {
      const me = await this.client.getCurrentUser();
      this.botUserId = me.id;
      this.logger.info(`Connected to Nextcloud as "${me.id}"`);
      // At startup, skip the history: a command sent while the integration was
      // down must not run hours later.
      await this.syncRooms(await this.client.listRooms(), { skipHistory: true });
    } catch (error) {
      this.stop();
      throw error;
    }
    if (!this.running) {
      return; // stopped meanwhile (new configuration, disconnection)
    }
    this.healthy = true;
    await this.gladys.setConnectionStatus(true);
    this.scheduleRefresh();
  }

  stop() {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.pollers.clear();
  }

  scheduleRefresh() {
    if (!this.running) {
      return;
    }
    this.refreshTimer = setTimeout(async () => {
      await this.refreshRooms();
      this.scheduleRefresh();
    }, this.roomRefreshMs);
  }

  /** List the conversations again, and report the reachability of Nextcloud. */
  async refreshRooms() {
    try {
      const rooms = await this.client.listRooms();
      if (!this.running) {
        return;
      }
      await this.syncRooms(rooms, { skipHistory: false });
      if (!this.healthy) {
        this.healthy = true;
        await this.gladys.setConnectionStatus(true);
      }
    } catch (error) {
      if (!this.running) {
        return;
      }
      this.logger.warn(`Listing the Nextcloud Talk conversations failed: ${error.message}`);
      if (this.healthy) {
        this.healthy = false;
        await this.gladys
          .setConnectionStatus(false, statusMessageFor(error))
          .catch((err) => this.logger.error('Reporting the connection status failed', err));
      }
    }
  }

  /**
   * Start a polling loop for every new one-to-one conversation, stop the ones
   * of the conversations that disappeared.
   */
  async syncRooms(rooms, { skipHistory }) {
    const oneToOne = rooms.filter((room) => room.type === ROOM_TYPES.ONE_TO_ONE);
    const tokens = new Set(oneToOne.map((room) => room.token));

    for (const token of [...this.pollers.keys()]) {
      if (!tokens.has(token)) {
        this.logger.debug(`Conversation ${token} is gone, stop polling it`);
        this.pollers.delete(token);
      }
    }

    for (const room of oneToOne) {
      if (this.pollers.has(room.token)) {
        continue;
      }
      // A conversation discovered while running was created after startup:
      // its first message (often the linking code) may already be there, so
      // start from what the bot has not read yet.
      const startFrom = Number(skipHistory ? room.lastMessage?.id : room.lastReadMessage);
      const lastKnownMessageId = Number.isFinite(startFrom) && startFrom > 0 ? startFrom : 0;
      this.logger.debug(`Polling conversation ${room.token} from message ${lastKnownMessageId}`);
      const poller = { lastKnownMessageId };
      this.pollers.set(room.token, poller);
      this.pollLoop(room.token, poller);
    }
  }

  async pollLoop(token, poller) {
    const signal = this.abortController?.signal;
    // The poller entry is replaced or removed when the conversation goes away
    // or the bot stops: the loop ends by itself.
    while (this.running && this.pollers.get(token) === poller) {
      try {
        const { messages, lastGiven } = await this.client.receiveMessages(
          token,
          poller.lastKnownMessageId,
          { signal },
        );
        if (this.pollers.get(token) !== poller) {
          return;
        }
        for (const message of messages) {
          await this.handleMessage(token, message).catch((error) =>
            this.logger.error(`Handling a message of conversation ${token} failed`, error),
          );
        }
        const lastId = messages.length > 0 ? Math.max(...messages.map((m) => m.id)) : null;
        poller.lastKnownMessageId = lastGiven ?? lastId ?? poller.lastKnownMessageId;
      } catch (error) {
        if (isAbort(error) && !this.running) {
          return;
        }
        this.logger.warn(
          `Polling conversation ${token} failed (${error.message}), retrying in ${this.retryDelayMs / 1000} s`,
        );
        try {
          await delay(this.retryDelayMs, undefined, { signal });
        } catch {
          return; // aborted: the bot stopped
        }
      }
    }
  }

  /** A message read in a one-to-one conversation. */
  async handleMessage(token, message) {
    if (
      message.actorType !== 'users' ||
      message.actorId === this.botUserId ||
      message.messageType !== 'comment'
    ) {
      return;
    }
    const text = String(message.message ?? '').trim();
    if (!text || RICH_OBJECT_ONLY.test(text)) {
      return;
    }

    try {
      await this.gladys.publishMessage(token, text.slice(0, MAX_MESSAGE_LENGTH), {
        createdAt: new Date(message.timestamp * 1000),
      });
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
      // 404: this conversation is not linked to any Gladys user yet.
      await this.handleUnlinkedMessage(token, message, text);
    }
  }

  async handleUnlinkedMessage(token, message, text) {
    if (!LINK_CODE.test(text)) {
      await this.client.sendMessage(token, notLinkedText());
      return;
    }
    try {
      const user = await this.gladys.linkContact(
        text,
        token,
        message.actorDisplayName || message.actorId,
      );
      this.logger.info(`Conversation ${token} linked to the Gladys user "${user.selector}"`);
      await this.client.sendMessage(token, linkedText(user));
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
      await this.client.sendMessage(token, invalidCodeText());
    }
  }

  /**
   * Gladys sends a message (an answer, a notification) to a linked contact.
   * @param {{ id: string }} contact the conversation token
   * @param {{ text: string, file: string | null }} message
   */
  async send(contact, message) {
    if (!this.running || !this.botUserId) {
      throw new Error('Nextcloud Talk is not connected');
    }
    if (message.text) {
      await this.client.sendMessage(contact.id, message.text);
    }
    if (message.file) {
      await this.client.shareImage(contact.id, message.file, this.botUserId);
    }
  }
}
