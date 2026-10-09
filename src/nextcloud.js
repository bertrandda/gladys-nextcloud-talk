// -----------------------------------------------------------------------------
// Minimal Nextcloud Talk client (OCS API + WebDAV), on the global `fetch`.
//
// Only the calls the bot needs, the same ones the Gladys built-in Nextcloud
// Talk service uses:
//   - who am I (the bot account)          GET  /ocs/v2.php/cloud/user
//   - the conversations of the bot        GET  /ocs/v2.php/apps/spreed/api/v4/room
//   - new messages of a conversation      GET  /ocs/v2.php/apps/spreed/api/v1/chat/{token}
//     (long polling: the server holds the request until a message arrives)
//   - post a message                      POST /ocs/v2.php/apps/spreed/api/v1/chat/{token}
//   - post an image: upload it to the bot's files over WebDAV, then share it
//     into the conversation (share type 10 = Talk conversation).
//
// `fetch` is injectable so the tests never touch the network.
// -----------------------------------------------------------------------------

const OCS_ROOMS = '/ocs/v2.php/apps/spreed/api/v4/room';
const OCS_CHAT = '/ocs/v2.php/apps/spreed/api/v1/chat';
const OCS_USER = '/ocs/v2.php/cloud/user';
const OCS_SHARES = '/ocs/v2.php/apps/files_sharing/api/v1/shares';

// Talk room types (see the Talk API documentation, "Conversation types").
export const ROOM_TYPES = {
  ONE_TO_ONE: 1,
  GROUP: 2,
  PUBLIC: 3,
  CHANGELOG: 4,
  FORMER_ONE_TO_ONE: 5,
  NOTE_TO_SELF: 6,
};

// Share type of a Talk conversation in the files_sharing API.
const SHARE_TYPE_ROOM = 10;

// How long the Talk server holds a chat request open when nothing arrives
// (its maximum is 30 s), and the client-side safety margin on top of it.
export const LONG_POLL_TIMEOUT_SECONDS = 30;
const LONG_POLL_REQUEST_TIMEOUT_MS = (LONG_POLL_TIMEOUT_SECONDS + 15) * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

// Folder of the bot account where the images sent by Gladys are uploaded.
const ATTACHMENT_FOLDER = 'Talk';

// Gladys sends images as `image/<type>;base64,<data>` (the camera format),
// sometimes with the standard `data:` prefix.
const IMAGE_DATA_URI = /^(?:data:)?image\/([a-z0-9.+-]+);base64,(.+)$/is;

/** Error of a Nextcloud HTTP call, carrying the HTTP status. */
export class NextcloudError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'NextcloudError';
    this.status = status;
  }
}

/**
 * Decode a Gladys image (`image/jpg;base64,...`) into bytes.
 * @param {string} file
 * @returns {{ buffer: Buffer, extension: string, contentType: string }}
 */
export function decodeImage(file) {
  const match = IMAGE_DATA_URI.exec(file ?? '');
  if (!match) {
    throw new Error('Unsupported attachment: expected a base64 image');
  }
  const type = match[1].toLowerCase();
  const subtype = type === 'jpg' ? 'jpeg' : type;
  return {
    buffer: Buffer.from(match[2], 'base64'),
    extension: subtype === 'jpeg' ? 'jpg' : subtype.replace(/\W.*$/, ''),
    contentType: `image/${subtype}`,
  };
}

export class NextcloudTalkClient {
  /**
   * @param {{ url: string, username: string, password: string, fetch?: typeof fetch }} options
   */
  constructor({ url, username, password, fetch: fetchImpl = globalThis.fetch }) {
    this.url = url;
    this.username = username;
    this.fetch = fetchImpl;
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  async request(method, path, { query, json, body, headers, signal, timeoutMs } = {}) {
    const url = new URL(`${this.url}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const timeout = AbortSignal.timeout(timeoutMs ?? REQUEST_TIMEOUT_MS);
    const response = await this.fetch(url, {
      method,
      headers: {
        Authorization: this.authorization,
        Accept: 'application/json',
        'OCS-APIRequest': 'true',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    return response;
  }

  // OCS call whose answer is `{ ocs: { data } }`.
  async ocs(method, path, options) {
    const response = await this.request(method, path, options);
    if (!response.ok) {
      throw new NextcloudError(
        response.status,
        `Nextcloud answered ${response.status} to ${method} ${path}`,
      );
    }
    const payload = await response.json();
    return payload?.ocs?.data;
  }

  /** The bot account: `{ id, displayname }`. Fails with 401 on bad credentials. */
  async getCurrentUser() {
    return this.ocs('GET', OCS_USER);
  }

  /** Every conversation the bot account takes part in. */
  async listRooms() {
    return (await this.ocs('GET', OCS_ROOMS)) ?? [];
  }

  /**
   * Long-poll the messages posted after `lastKnownMessageId`.
   * @returns {Promise<{ messages: object[], lastGiven: number | null }>} the new
   *   messages, oldest first, and the id to poll from next time.
   */
  async receiveMessages(token, lastKnownMessageId, { signal } = {}) {
    const path = `${OCS_CHAT}/${encodeURIComponent(token)}`;
    const response = await this.request('GET', path, {
      query: {
        lookIntoFuture: 1,
        timeout: LONG_POLL_TIMEOUT_SECONDS,
        lastKnownMessageId,
        includeLastKnown: 0,
      },
      signal,
      timeoutMs: LONG_POLL_REQUEST_TIMEOUT_MS,
    });
    // 304: the timeout elapsed without any new message.
    if (response.status === 304) {
      return { messages: [], lastGiven: null };
    }
    if (!response.ok) {
      throw new NextcloudError(
        response.status,
        `Nextcloud answered ${response.status} to GET ${path}`,
      );
    }
    const payload = await response.json();
    const lastGiven = Number(response.headers.get('x-chat-last-given'));
    return {
      messages: payload?.ocs?.data ?? [],
      lastGiven: Number.isFinite(lastGiven) && lastGiven > 0 ? lastGiven : null,
    };
  }

  /** Post a text message in a conversation. */
  async sendMessage(token, message) {
    return this.ocs('POST', `${OCS_CHAT}/${encodeURIComponent(token)}`, { json: { message } });
  }

  /**
   * Post an image in a conversation: upload it to the bot's files, then share
   * it with the conversation (Talk shows it inline).
   * @param {string} token conversation token
   * @param {string} file Gladys image, `image/jpg;base64,...`
   * @param {string} userId id of the bot account (WebDAV path)
   */
  async shareImage(token, file, userId) {
    const { buffer, extension, contentType } = decodeImage(file);
    const davFolder = `/remote.php/dav/files/${encodeURIComponent(userId)}/${ATTACHMENT_FOLDER}`;

    // 201: created; 405: it already exists. Anything else is left to the PUT.
    await this.request('MKCOL', davFolder);

    const fileName = `gladys-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${extension}`;
    const upload = await this.request('PUT', `${davFolder}/${fileName}`, {
      body: buffer,
      headers: { 'Content-Type': contentType },
    });
    if (!upload.ok) {
      throw new NextcloudError(upload.status, `Nextcloud answered ${upload.status} to the upload`);
    }

    return this.ocs('POST', OCS_SHARES, {
      json: {
        path: `/${ATTACHMENT_FOLDER}/${fileName}`,
        shareType: SHARE_TYPE_ROOM,
        shareWith: token,
      },
    });
  }
}
