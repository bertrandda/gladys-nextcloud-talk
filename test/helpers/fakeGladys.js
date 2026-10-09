// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the bot relies on, and records every call so
// tests can assert them:
//   - publishMessage(contactId, text, opts) -> 404 for a contact not linked
//   - linkContact(code, contactId, name)    -> 404 for an unknown code
//   - setConnectionStatus(connected, message)
// -----------------------------------------------------------------------------

function notFound(message) {
  const error = new Error(message);
  error.name = 'GladysApiError';
  error.status = 404;
  return error;
}

/**
 * @param {{ linked?: string[], codes?: Record<string, object> }} options
 *   `linked`: contact ids already linked; `codes`: valid linking codes and the
 *   user each one links to.
 */
export function createFakeGladys({ linked = [], codes = {} } = {}) {
  const linkedContacts = new Set(linked);
  const messages = [];
  const links = [];
  const connectionStatuses = [];

  return {
    messages,
    links,
    connectionStatuses,

    async publishMessage(contactId, text, options = {}) {
      if (!linkedContacts.has(contactId)) {
        throw notFound('Contact not linked');
      }
      messages.push({ contactId, text, options });
      return { success: true };
    },

    async linkContact(code, contactId, contactName) {
      const user = codes[code];
      if (!user) {
        throw notFound('Invalid code');
      }
      delete codes[code]; // single use
      linkedContacts.add(contactId);
      links.push({ code, contactId, contactName });
      return user;
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },
  };
}
