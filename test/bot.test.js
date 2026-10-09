import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { TalkBot, MAX_MESSAGE_LENGTH } from '../src/bot.js';
import { NextcloudError } from '../src/nextcloud.js';
import { invalidCodeText, linkedText, notLinkedText } from '../src/texts.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const silent = createLogger({ level: 'silent' });

const ONE_TO_ONE = 1;
const GROUP = 2;

// A Talk client double. `receiveMessages` answers from `polls` (one queue per
// conversation), then hangs until the bot aborts the request, like a long poll
// with nothing new.
function createFakeClient({ rooms = [], polls = {}, user = { id: 'gladys' } } = {}) {
  const sent = [];
  const images = [];
  const receives = [];
  let listRoomsError = null;
  let pollWaiter = null;

  return {
    rooms,
    sent,
    images,
    receives,
    failListRooms(error) {
      listRoomsError = error;
    },
    // Resolves once the bot asked for new messages `count` times in total.
    waitForReceives(count) {
      return new Promise((resolve) => {
        const check = () => (receives.length >= count ? resolve() : (pollWaiter = check));
        check();
      });
    },
    async getCurrentUser() {
      return user;
    },
    async listRooms() {
      if (listRoomsError) {
        throw listRoomsError;
      }
      return rooms;
    },
    receiveMessages(token, lastKnownMessageId, { signal }) {
      receives.push({ token, lastKnownMessageId });
      const waiter = pollWaiter;
      pollWaiter = null;
      waiter?.();
      const next = polls[token]?.shift();
      if (next) {
        return Promise.resolve(next);
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    },
    async sendMessage(token, text) {
      sent.push({ token, text });
    },
    async shareImage(token, file, userId) {
      images.push({ token, file, userId });
    },
  };
}

const userMessage = (overrides = {}) => ({
  id: 100,
  actorType: 'users',
  actorId: 'alice',
  actorDisplayName: 'Alice',
  messageType: 'comment',
  systemMessage: '',
  timestamp: 1760000000,
  message: 'Quelle est la température du salon ?',
  ...overrides,
});

async function startedBot({ gladys = createFakeGladys(), client = createFakeClient() } = {}) {
  const bot = new TalkBot({ gladys, client, logger: silent, roomRefreshMs: 60_000 });
  await bot.start();
  return { bot, gladys, client };
}

test('a message of a linked conversation is published to Gladys', async () => {
  const { bot, gladys } = await startedBot({ gladys: createFakeGladys({ linked: ['room1'] }) });
  await bot.handleMessage('room1', userMessage());
  assert.equal(gladys.messages.length, 1);
  const [published] = gladys.messages;
  assert.equal(published.contactId, 'room1');
  assert.equal(published.text, 'Quelle est la température du salon ?');
  assert.equal(published.options.createdAt.getTime(), 1760000000 * 1000);
  bot.stop();
});

test('own, system, non-user and attachment-only messages are ignored', async () => {
  const { bot, gladys, client } = await startedBot({
    gladys: createFakeGladys({ linked: ['room1'] }),
  });
  await bot.handleMessage('room1', userMessage({ actorId: 'gladys' }));
  await bot.handleMessage(
    'room1',
    userMessage({ messageType: 'system', systemMessage: 'call_started' }),
  );
  await bot.handleMessage('room1', userMessage({ actorType: 'guests' }));
  await bot.handleMessage('room1', userMessage({ actorType: 'bots' }));
  await bot.handleMessage('room1', userMessage({ message: '{file}' }));
  await bot.handleMessage('room1', userMessage({ message: '   ' }));
  assert.equal(gladys.messages.length, 0);
  assert.equal(client.sent.length, 0);
  bot.stop();
});

test('long messages are truncated to what Gladys accepts', async () => {
  const { bot, gladys } = await startedBot({ gladys: createFakeGladys({ linked: ['room1'] }) });
  await bot.handleMessage('room1', userMessage({ message: 'a'.repeat(MAX_MESSAGE_LENGTH + 10) }));
  assert.equal(gladys.messages[0].text.length, MAX_MESSAGE_LENGTH);
  bot.stop();
});

test('a valid code sent in a conversation not linked yet links it', async () => {
  const user = { selector: 'alice', first_name: 'Alice', language: 'fr' };
  const { bot, gladys, client } = await startedBot({
    gladys: createFakeGladys({ codes: { A1B2C3: user } }),
  });
  await bot.handleMessage('room1', userMessage({ message: ' A1B2C3 ' }));
  assert.deepEqual(gladys.links, [{ code: 'A1B2C3', contactId: 'room1', contactName: 'Alice' }]);
  assert.deepEqual(client.sent, [{ token: 'room1', text: linkedText(user) }]);
  assert.match(linkedText(user), /Bonjour Alice/);

  // From then on, the conversation speaks to Gladys.
  await bot.handleMessage('room1', userMessage({ id: 101 }));
  assert.equal(gladys.messages.length, 1);
  bot.stop();
});

test('an invalid code gets an explanation', async () => {
  const { bot, gladys, client } = await startedBot();
  await bot.handleMessage('room1', userMessage({ message: 'ZZZZ99' }));
  assert.equal(gladys.links.length, 0);
  assert.deepEqual(client.sent, [{ token: 'room1', text: invalidCodeText() }]);
  bot.stop();
});

test('any other text in a conversation not linked yet gets the linking instructions', async () => {
  const { bot, gladys, client } = await startedBot();
  await bot.handleMessage('room1', userMessage({ message: 'Bonjour Gladys' }));
  assert.equal(gladys.links.length, 0);
  assert.deepEqual(client.sent, [{ token: 'room1', text: notLinkedText() }]);
  bot.stop();
});

test('start polls the one-to-one conversations only, from their latest message', async () => {
  const client = createFakeClient({
    rooms: [
      { token: 'private', type: ONE_TO_ONE, lastMessage: { id: 57 }, lastReadMessage: 12 },
      { token: 'group', type: GROUP, lastMessage: { id: 99 } },
    ],
  });
  const { bot, gladys } = await startedBot({ client });
  await client.waitForReceives(1);
  assert.deepEqual([...bot.pollers.keys()], ['private']);
  // At startup the history is skipped: no stale command runs.
  assert.deepEqual(client.receives, [{ token: 'private', lastKnownMessageId: 57 }]);
  assert.deepEqual(gladys.connectionStatuses, [{ connected: true, message: undefined }]);
  bot.stop();
});

test('a conversation created while running is polled from what the bot has not read', async () => {
  const client = createFakeClient();
  const { bot } = await startedBot({ client });
  client.rooms.push({
    token: 'new',
    type: ONE_TO_ONE,
    lastMessage: { id: 8 },
    lastReadMessage: 0,
  });
  await bot.refreshRooms();
  await client.waitForReceives(1);
  // The first message (often the linking code) is not skipped.
  assert.deepEqual(client.receives, [{ token: 'new', lastKnownMessageId: 0 }]);

  // A conversation that disappears is no longer polled.
  client.rooms.length = 0;
  await bot.refreshRooms();
  assert.equal(bot.pollers.size, 0);
  bot.stop();
});

test('the polling loop publishes every new message and moves on', async () => {
  const client = createFakeClient({
    rooms: [{ token: 'room1', type: ONE_TO_ONE, lastMessage: { id: 10 } }],
    polls: {
      room1: [
        {
          messages: [
            userMessage({ id: 11, message: 'one' }),
            userMessage({ id: 12, message: 'two' }),
          ],
          lastGiven: 12,
        },
      ],
    },
  });
  const { bot, gladys } = await startedBot({
    client,
    gladys: createFakeGladys({ linked: ['room1'] }),
  });
  await client.waitForReceives(2);
  assert.deepEqual(
    gladys.messages.map((m) => m.text),
    ['one', 'two'],
  );
  assert.deepEqual(client.receives[1], { token: 'room1', lastKnownMessageId: 12 });
  bot.stop();
});

test('an unreachable Nextcloud is reported once, then its recovery', async () => {
  const client = createFakeClient();
  const { bot, gladys } = await startedBot({ client });
  client.failListRooms(new NextcloudError(502, 'Bad gateway'));
  await bot.refreshRooms();
  await bot.refreshRooms();
  client.failListRooms(null);
  await bot.refreshRooms();
  assert.deepEqual(
    gladys.connectionStatuses.map((s) => s.connected),
    [true, false, true],
  );
  assert.ok(gladys.connectionStatuses[1].message.fr);
  bot.stop();
});

test('start fails when Nextcloud refuses the credentials', async () => {
  const client = createFakeClient();
  client.getCurrentUser = async () => {
    throw new NextcloudError(401, 'Unauthorized');
  };
  const bot = new TalkBot({ gladys: createFakeGladys(), client, logger: silent });
  await assert.rejects(bot.start(), { status: 401 });
  assert.equal(bot.running, false);
});

test('send posts the text, then the image, in the linked conversation', async () => {
  const { bot, client } = await startedBot();
  await bot.send({ id: 'room1' }, { text: 'Voici la caméra', file: 'image/jpg;base64,AAAA' });
  assert.deepEqual(client.sent, [{ token: 'room1', text: 'Voici la caméra' }]);
  assert.deepEqual(client.images, [
    { token: 'room1', file: 'image/jpg;base64,AAAA', userId: 'gladys' },
  ]);
  bot.stop();
  await assert.rejects(bot.send({ id: 'room1' }, { text: 'x', file: null }));
});
