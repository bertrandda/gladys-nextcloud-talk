import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, isConfigured, DEFAULT_CONFIG } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig trims the URL and the login, and drops trailing slashes', () => {
  const config = normalizeConfig({
    nextcloud_url: '  https://cloud.example.com/nextcloud//  ',
    bot_username: ' gladys ',
    bot_password: ' secret ',
  });
  assert.equal(config.nextcloud_url, 'https://cloud.example.com/nextcloud');
  assert.equal(config.bot_username, 'gladys');
  // A password is used exactly as typed.
  assert.equal(config.bot_password, ' secret ');
});

test('isConfigured requires the URL, the login and the password', () => {
  const full = {
    nextcloud_url: 'https://cloud.example.com',
    bot_username: 'gladys',
    bot_password: 'x',
  };
  assert.equal(isConfigured(normalizeConfig(full)), true);
  for (const key of Object.keys(full)) {
    assert.equal(isConfigured(normalizeConfig({ ...full, [key]: '' })), false, `missing ${key}`);
  }
});
