# Gladys Nextcloud Talk

External integration for [Gladys Assistant](https://gladysassistant.com) to
chat with Gladys from [Nextcloud Talk](https://nextcloud.com/talk/), built with
the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

It is the external counterpart of the
[built-in Nextcloud Talk service](https://github.com/GladysAssistant/Gladys/tree/master/server/services/nextcloud-talk):
same Talk API (long polling of the conversations, images uploaded over WebDAV
then shared in the conversation), running in its own sandboxed container.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## How it works

The manifest declares a **bidirectional communication channel**
(`"type": "communication"`, `"messaging": { "receive": true }`):

- the Gladys admin configures **one Nextcloud account dedicated to the bot**
  (instance URL, login, app password);
- each Gladys user opens a **one-to-one conversation** with that account and
  sends the code given by **Link my account** in Gladys: the integration
  relays it with `gladys.linkContact(code, conversationToken, displayName)`;
- every message of a linked conversation goes to the brain with
  `gladys.publishMessage(conversationToken, text)`, and the answers (and the
  notifications of the scenes) come back through
  `gladys.onSendMessage({ id: conversationToken }, { text, file })`.

Group conversations are ignored on purpose: every member would speak with the
authority of the user who linked it.

## Project structure

```
.
├─ index.js                          # SDK wiring only (handlers, lifecycle)
├─ src/
│  ├─ bot.js                         # the bot: conversations, polling, linking, sending
│  ├─ nextcloud.js                   # minimal Nextcloud Talk client (OCS + WebDAV)
│  ├─ actions.js                     # "Test the connection" button
│  ├─ texts.js                       # texts the bot writes by itself (en/fr)
│  └─ config.js                      # config defaults + normalization
├─ docs/en.md, docs/fr.md            # user documentation, re-hosted by Gladys
├─ test/                             # unit tests (`node --test`), no network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
└─ .github/                          # CI, release and multi-arch build workflows
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="nextcloud-talk" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs inside its container; the SDK reads them automatically.

## Quality checks

The CI runs them on Node 22 and 24, and builds the Docker image:

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test
```

Before releasing, the store validator runs the same checks as the store
indexer:

```bash
npx github:GladysAssistant/integration-store .
```

## Publish

1. Add the GitHub topic `gladys-assistant-integration` to the repository.
2. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
3. Open **Actions → Release → Run workflow** and pick `patch`, `minor` or
   `major`: the workflow bumps the version (package, manifest, image tag),
   tags, builds the `linux/amd64` + `linux/arm64` image to `ghcr.io` and
   publishes the GitHub Release.

## License

Apache-2.0
