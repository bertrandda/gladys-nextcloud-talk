# Nextcloud Talk

Chat with Gladys from [Nextcloud Talk](https://nextcloud.com/talk/): ask
questions about your home, start scenes, and receive the notifications and
camera images Gladys sends you, in a private conversation with a bot account.

## How it works

The integration logs into your Nextcloud with **one account dedicated to
Gladys** (the bot). Each Gladys user opens a **private (one-to-one)
conversation** with that account in Talk, and links it to their Gladys
account with a short code. From then on, what they write in this
conversation reaches Gladys with their authority, and Gladys answers there.

Only one-to-one conversations are taken into account: in a group
conversation, every member would speak in the name of the user who linked
it. Group conversations of the bot account are simply ignored.

## 1. Create the bot account (Nextcloud admin)

1. In Nextcloud, create a user for Gladys, for example `gladys`, with a
   display name such as "Gladys". Make sure the Talk app is enabled for it.
2. Log in as this user, open **Settings → Security**, and under **Devices &
   sessions** create an **app password** (name it "Gladys"). Copy it: it is
   only shown once. An app password can be revoked at any time without
   changing the account password, and it keeps working with two-factor
   authentication.

## 2. Configure the integration (Gladys admin)

1. Open the **Configuration** tab of the Nextcloud Talk integration.
2. Fill in:
   - **Nextcloud URL**: the address of your instance as Gladys can reach it,
     for example `https://cloud.example.com` (add the sub-path if Nextcloud is
     not at the root, e.g. `https://example.com/nextcloud`);
   - **Bot login**: the login of the account created above;
   - **Bot app password**: the app password created above.
3. Save, then click **Test the connection**: it shows the account Gladys is
   logged in with and how many private conversations it can see.

## 3. Link your account (each Gladys user)

1. In Nextcloud Talk, start a **private conversation** with the bot account
   (search for its name in "Start a new conversation").
2. In Gladys, open the Nextcloud Talk integration and click **Link my
   account**: Gladys shows a short code, valid for 15 minutes.
3. Send this code in the Talk conversation. The bot answers that the
   conversation is now linked to your account.

You can now write to Gladys in this conversation ("what is the temperature in
the living room?"), and select Nextcloud Talk in the scenes that send you
messages. You can revoke the link at any time from the same screen.

## Good to know

- The bot answers within a few seconds: it listens to each conversation
  continuously. A new conversation is noticed within 30 seconds.
- Messages written while the integration is stopped are not executed when it
  starts again, so that an old command (opening a door…) never runs late.
- Images sent by Gladys (camera snapshots) are uploaded to the `Talk` folder
  of the bot account, then shared in the conversation.

## Troubleshooting

- **"Nextcloud refused the bot credentials"**: check the login, and create a
  new app password if needed. The login is the user id, not the e-mail.
- **"Nextcloud is unreachable"**: check that the URL is reachable from the
  machine running Gladys (not only from your browser) and that its HTTPS
  certificate is valid.
- **The bot does not answer**: make sure the conversation is a one-to-one
  conversation with the bot account, and look at the integration logs in
  Gladys.
- **"This is not a valid linking code, or it expired"**: generate a new code in Gladys and
  send it within 15 minutes; each code can only be used once.
