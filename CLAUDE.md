# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `communication`
(bidirectional channel, `messaging.receive: true`): a Node.js service (Node
22+, ESM, no build step) that runs in its own sandboxed Docker container and
bridges Nextcloud Talk and Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/bot.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/bot.js                        TalkBot: one-to-one conversations, long polling, linking, sending
src/nextcloud.js                  Nextcloud Talk client (OCS API + WebDAV), injectable fetch
src/actions.js                    manifest `actions` handlers
src/texts.js                      texts the bot writes by itself (en/fr)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest) + normalization
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test; test/helpers/fakeGladys.js stands in for the SDK
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **The contact id is the Talk conversation token.** Linked contacts are
  stored by Gladys under it: changing what is used as contact id unlinks
  every user. The same goes for every key users store: manifest
  `config_schema` and `actions` keys.
- **One-to-one conversations only.** A linked conversation speaks with the
  authority of its Gladys user; never accept group conversations.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log the bot password or message contents above
  `debug`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
- **User-facing text** is bilingual (English and French): bot messages,
  action messages, manifest texts, and `docs/en.md` / `docs/fr.md`, kept in
  sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
