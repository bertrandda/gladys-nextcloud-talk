// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by a Gladys admin, from the `config_schema`
// declared in `gladys-assistant-integration.json`: the Nextcloud instance and
// the credentials of the Nextcloud account the bot speaks with. The SDK
// fetches it (`gladys.getConfig()`) and notifies every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined`.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (none of these fields declares one: an empty
// value means "not configured yet").
export const DEFAULT_CONFIG = {
  nextcloud_url: '', // e.g. https://cloud.example.com
  bot_username: '', // login of the Nextcloud account dedicated to the bot
  bot_password: '', // app password of that account
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    // A trailing slash would produce `//ocs/...` URLs, which some reverse
    // proxies refuse.
    nextcloud_url: String(raw.nextcloud_url ?? '')
      .trim()
      .replace(/\/+$/, ''),
    bot_username: String(raw.bot_username ?? '').trim(),
    // Never trimmed: a password is used exactly as typed.
    bot_password: String(raw.bot_password ?? ''),
  };
}

/**
 * Whether the config holds everything needed to reach Nextcloud.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function isConfigured(config) {
  return Boolean(config.nextcloud_url && config.bot_username && config.bot_password);
}
