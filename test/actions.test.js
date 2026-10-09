import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../src/actions.js';
import { NextcloudError } from '../src/nextcloud.js';

const config = {
  nextcloud_url: 'https://cloud.example.com',
  bot_username: 'gladys',
  bot_password: 'app-password',
};

test('test_connection asks for the configuration when it is incomplete', async () => {
  const message = await ACTIONS.test_connection({
    config: { ...config, bot_password: '' },
    createClient: () => assert.fail('no request without a configuration'),
  });
  assert.match(message.en, /Fill in/);
});

test('test_connection reports the bot account and its private conversations', async () => {
  const message = await ACTIONS.test_connection({
    config,
    createClient: () => ({
      getCurrentUser: async () => ({ id: 'gladys', displayname: 'Gladys' }),
      listRooms: async () => [{ type: 1 }, { type: 1 }, { type: 2 }],
    }),
  });
  assert.equal(message.en, 'Connected as Gladys: 2 private conversation(s).');
  assert.match(message.fr, /Connecté en tant que Gladys/);
});

test('test_connection explains refused credentials', async () => {
  const message = await ACTIONS.test_connection({
    config,
    createClient: () => ({
      getCurrentUser: async () => {
        throw new NextcloudError(401, 'Unauthorized');
      },
    }),
  });
  assert.match(message.en, /refused the bot credentials/);
});
