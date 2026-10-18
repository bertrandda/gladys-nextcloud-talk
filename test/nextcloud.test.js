import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextcloudTalkClient, NextcloudError, decodeImage } from '../src/nextcloud.js';

// A fetch that answers from a queue of `Response`s and records every request.
function createFakeFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: new URL(url), ...init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected request ${init.method} ${url}`);
    }
    return next;
  };
  return { fetch, calls };
}

const ocs = (data, init = {}) =>
  new Response(JSON.stringify({ ocs: { meta: { status: 'ok' }, data } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

function createClient(responses) {
  const fake = createFakeFetch(responses);
  const client = new NextcloudTalkClient({
    url: 'https://cloud.example.com',
    username: 'gladys',
    password: 'app-password',
    fetch: fake.fetch,
  });
  return { client, calls: fake.calls };
}

test('OCS requests carry the Basic auth and the OCS headers', async () => {
  const { client, calls } = createClient([ocs({ id: 'gladys', displayname: 'Gladys' })]);
  const me = await client.getCurrentUser();
  assert.deepEqual(me, { id: 'gladys', displayname: 'Gladys' });
  const [call] = calls;
  assert.equal(call.method, 'GET');
  assert.equal(call.url.href, 'https://cloud.example.com/ocs/v2.php/cloud/user');
  assert.equal(
    call.headers.Authorization,
    `Basic ${Buffer.from('gladys:app-password').toString('base64')}`,
  );
  assert.equal(call.headers['OCS-APIRequest'], 'true');
  assert.equal(call.headers.Accept, 'application/json');
});

test('an HTTP error becomes a NextcloudError carrying the status', async () => {
  const { client } = createClient([new Response('', { status: 401 })]);
  await assert.rejects(client.listRooms(), (error) => {
    assert.ok(error instanceof NextcloudError);
    assert.equal(error.status, 401);
    return true;
  });
});

test('listRooms returns the conversations of the bot', async () => {
  const rooms = [{ token: 'abc', type: 1 }];
  const { client, calls } = createClient([ocs(rooms)]);
  assert.deepEqual(await client.listRooms(), rooms);
  assert.equal(calls[0].url.pathname, '/ocs/v2.php/apps/spreed/api/v4/room');
});

test('receiveMessages long-polls after the last known message', async () => {
  const messages = [{ id: 43, message: 'hello' }];
  const { client, calls } = createClient([
    ocs(messages, { headers: { 'X-Chat-Last-Given': '43' } }),
  ]);
  const result = await client.receiveMessages('abc', 42);
  assert.deepEqual(result, { messages, lastGiven: 43 });
  const { url } = calls[0];
  assert.equal(url.pathname, '/ocs/v2.php/apps/spreed/api/v1/chat/abc');
  assert.equal(url.searchParams.get('lookIntoFuture'), '1');
  assert.equal(url.searchParams.get('lastKnownMessageId'), '42');
  assert.equal(url.searchParams.get('timeout'), '30');
});

test('receiveMessages treats 304 as "nothing new"', async () => {
  const { client } = createClient([new Response(null, { status: 304 })]);
  assert.deepEqual(await client.receiveMessages('abc', 42), { messages: [], lastGiven: null });
});

test('sendMessage posts the text as JSON', async () => {
  const { client, calls } = createClient([ocs({ id: 44 })]);
  await client.sendMessage('abc', 'It is 21 °C');
  const [call] = calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.url.pathname, '/ocs/v2.php/apps/spreed/api/v1/chat/abc');
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.body), { message: 'It is 21 °C' });
});

test('decodeImage reads the Gladys image format, with or without data:', () => {
  const data = Buffer.from('fake-jpeg').toString('base64');
  for (const file of [`image/jpg;base64,${data}`, `data:image/jpeg;base64,${data}`]) {
    const image = decodeImage(file);
    assert.equal(image.buffer.toString(), 'fake-jpeg');
    assert.equal(image.extension, 'jpg');
    assert.equal(image.contentType, 'image/jpeg');
  }
  assert.equal(decodeImage(`image/png;base64,${data}`).extension, 'png');
  assert.throws(() => decodeImage('not an image'));
});

test('shareImage uploads the image over WebDAV then shares it with the conversation', async () => {
  const { client, calls } = createClient([
    new Response(null, { status: 405 }), // MKCOL: the folder already exists
    new Response(null, { status: 201 }), // PUT
    ocs({ id: 7 }), // share
  ]);
  const data = Buffer.from('fake-jpeg').toString('base64');
  await client.shareImage('abc', `image/jpg;base64,${data}`, 'gladys');

  const [mkcol, put, share] = calls;
  assert.equal(mkcol.method, 'MKCOL');
  assert.equal(mkcol.url.pathname, '/remote.php/dav/files/gladys/Talk');
  assert.equal(put.method, 'PUT');
  assert.match(put.url.pathname, /^\/remote\.php\/dav\/files\/gladys\/Talk\/gladys-.+\.jpg$/);
  assert.equal(put.headers['Content-Type'], 'image/jpeg');
  assert.equal(put.body.toString(), 'fake-jpeg');
  assert.equal(share.url.pathname, '/ocs/v2.php/apps/files_sharing/api/v1/shares');
  const fileName = put.url.pathname.split('/').pop();
  assert.deepEqual(JSON.parse(share.body), {
    path: `/Talk/${fileName}`,
    shareType: 10,
    shareWith: 'abc',
  });
});

test('shareImage fails when the upload is refused', async () => {
  const { client } = createClient([
    new Response(null, { status: 201 }),
    new Response(null, { status: 507 }), // insufficient storage
  ]);
  const data = Buffer.from('x').toString('base64');
  await assert.rejects(client.shareImage('abc', `image/jpg;base64,${data}`, 'gladys'), {
    status: 507,
  });
});
