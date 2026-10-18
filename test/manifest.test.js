// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest declares (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...(manifest.actions ?? []).flatMap((item) => item.fields ?? []),
];

const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('the integration is a bidirectional communication channel', () => {
  // Linking by code (receive: true) is what lets a Talk conversation speak to
  // the brain; a send-only channel would need a contact_schema instead.
  assert.equal(manifest.type, 'communication');
  assert.deepEqual(manifest.messaging, { receive: true });
  assert.equal(manifest.contact_schema, undefined, 'contact_schema is for send-only channels');
});

test('every manifest action has a handler, and vice versa', () => {
  const declared = (manifest.actions ?? []).map((action) => action.key);
  for (const key of declared) {
    assert.equal(typeof ACTIONS[key], 'function', `manifest action "${key}" has no handler`);
  }
  for (const key of Object.keys(ACTIONS)) {
    assert.ok(declared.includes(key), `handler "${key}" is not declared in actions`);
  }
});

test('every stored config key is known to DEFAULT_CONFIG, with the same default', () => {
  for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
    assert.ok(field.key in DEFAULT_CONFIG, `DEFAULT_CONFIG misses "${field.key}"`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of "${field.key}"`);
    }
  }
});

test('the bot password is a secret field', () => {
  const password = manifest.config_schema.find((f) => f.key === 'bot_password');
  assert.equal(password.type, 'secret');
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    // A section stores NO value: declaring `required`, `default` or
    // `placeholder` on it rejects the manifest.
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(section.placeholder, undefined, `section "${section.key}" has a placeholder`);
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(!(section.key in DEFAULT_CONFIG), `section "${section.key}" stores no value`);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(
    isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  assert.ok(manifest.description.en, 'the description needs an English text');
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('every text of a field is a multi-language object', () => {
  // A plain string rejects the manifest.
  for (const field of allFields) {
    for (const prop of ['label', 'description', 'placeholder']) {
      if (field[prop] !== undefined) {
        assert.equal(typeof field[prop], 'object', `field "${field.key}": ${prop}`);
        assert.ok(field[prop].en, `field "${field.key}": ${prop} needs an English text`);
        assert.ok(field[prop].fr, `field "${field.key}": ${prop} needs a French text`);
      }
    }
  }
});
