import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SteamAPIClient } from '../build/utils/steam-api.js';

const config = {
  cacheEnabled: true,
  cacheTTL: {
    reviews: 900000,
    gameInfo: 7200000,
    statistics: 300000,
    analysis: 1800000,
  },
  cacheMaxSize: 10,
  rateLimitEnabled: false,
  maxRequestsPerMinute: 30,
  httpMode: false,
  port: 8086,
  logLevel: 'error',
};

async function loadFixture(name) {
  const contents = await readFile(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8');
  return JSON.parse(contents);
}

class FixtureSteamClient extends SteamAPIClient {
  constructor(response) {
    super(config);
    this.response = response;
    this.requests = [];
  }

  async get(url, cacheKey, cacheTTL) {
    this.requests.push({ url, cacheKey, cacheTTL });
    const response = structuredClone(this.response);
    const count = Number(new URL(url).searchParams.get('count'));
    if (Array.isArray(response.appnews?.newsitems)) {
      response.appnews.newsitems = response.appnews.newsitems.slice(0, count);
    }
    return response;
  }
}

test('retrieves full official app announcements through the shared request path', async () => {
  const client = new FixtureSteamClient(await loadFixture('app-announcements-complete'));

  const result = await client.getAppAnnouncements(620, { limit: 1 });

  const request = client.requests[0];
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    appid: '620',
    count: '1',
    maxlength: '0',
    feeds: 'steam_community_announcements',
    format: 'json',
  });
  assert.equal(request.cacheKey, 'app_announcements_620_1_latest');
  assert.equal(request.cacheTTL, config.cacheTTL.gameInfo);
  assert.equal(typeof result.nextCursor, 'string');
  assert.deepEqual({ ...result, nextCursor: undefined }, {
    appId: 620,
    source: 'official_app_announcements',
    announcements: [
      {
        id: '1001',
        appId: 620,
        source: 'official_app_announcement',
        title: 'Portal 2 update',
        authorLabel: 'Kerry',
        publishedAt: 1710000100,
        steamUrl:
          'https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1001',
        body: '[h2]Patch notes[/h2]<br>Fixed co-op. [img]{STEAM_CLAN_IMAGE}/images/fix.png[/img]',
        bodyFormat: 'steam_markup',
        bodyStatus: 'full_requested',
        containsSteamImagePlaceholders: true,
        tags: ['patchnotes'],
      },
    ],
    nextCursor: undefined,
  });
});

test('marks a trailing ellipsis as possible truncation and uses the default count', async () => {
  const client = new FixtureSteamClient(await loadFixture('app-announcements-truncated'));

  const result = await client.getAppAnnouncements(620);

  assert.equal(new URL(client.requests[0].url).searchParams.get('count'), '20');
  assert.equal(result.announcements[0].bodyStatus, 'possibly_truncated');
});

test('paginates every announcement that shares a boundary timestamp', async () => {
  const client = new FixtureSteamClient(await loadFixture('app-announcements-pagination'));

  const first = await client.getAppAnnouncements(620, { limit: 1 });
  const second = await client.getAppAnnouncements(620, {
    limit: 1,
    cursor: first.nextCursor,
  });
  const third = await client.getAppAnnouncements(620, {
    limit: 1,
    cursor: second.nextCursor,
  });

  assert.deepEqual(
    [first, second, third].map((page) => page.announcements[0].id),
    ['1003', '1004', '1007']
  );
  assert.deepEqual(
    client.requests.map((request) => new URL(request.url).searchParams.get('count')),
    ['1', '2', '3']
  );
  assert.deepEqual(
    client.requests.map((request) => new URL(request.url).searchParams.get('enddate')),
    [null, '1700000200', '1700000200']
  );
});

test('rejects a malformed announcement cursor before requesting Steam', async () => {
  const client = new FixtureSteamClient(await loadFixture('app-announcements-empty'));
  const alteredCursor = `${Buffer.from(
    JSON.stringify({ before: 1700000200, seenIds: ['1003'] })
  ).toString('base64url')}!!!`;

  for (const cursor of ['not-a-valid-cursor', alteredCursor]) {
    await assert.rejects(
      client.getAppAnnouncements(620, { cursor }),
      /Invalid app announcement cursor/
    );
  }
  assert.equal(client.requests.length, 0);
});

test('returns a valid empty official announcement feed', async () => {
  const client = new FixtureSteamClient(await loadFixture('app-announcements-empty'));

  const result = await client.getAppAnnouncements(620);

  assert.deepEqual(result.announcements, []);
  assert.equal(result.nextCursor, null);
});

test('excludes external feeds and announcements for other apps', async () => {
  const client = new FixtureSteamClient(await loadFixture('app-announcements-unrelated'));

  const result = await client.getAppAnnouncements(620);

  assert.deepEqual(
    result.announcements.map((announcement) => announcement.id),
    ['1005']
  );
});

test('reports a malformed announcement body without inventing text', async () => {
  const client = new FixtureSteamClient(await loadFixture('app-announcements-malformed-body'));

  const result = await client.getAppAnnouncements(620);

  assert.equal(result.announcements[0].body, null);
  assert.equal(result.announcements[0].bodyStatus, 'malformed');
});
