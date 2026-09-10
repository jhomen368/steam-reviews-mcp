import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import axios from 'axios';

import { SteamAPIClient } from '../build/utils/steam-api.js';

const config = {
  cacheEnabled: true,
  cacheTTL: { reviews: 900000, gameInfo: 7200000, statistics: 300000, analysis: 1800000 },
  cacheMaxSize: 10,
  rateLimitEnabled: false,
  maxRequestsPerMinute: 30,
  httpMode: false,
  port: 8086,
  logLevel: 'error',
};

/** Load a saved page without contacting Steam. */
const fixture = (name) => readFile(new URL(`fixtures/${name}.html`, import.meta.url), 'utf8');
const identifier = { appId: 620, forumId: '0', threadId: '4514379914249040961' };

/** Exercise public client behavior with an ordered queue of offline responses. */
class FixtureSteamClient extends SteamAPIClient {
  /** Prepare the responses and record requests for assertions. */
  constructor(...responses) {
    super(config);
    this.responses = responses;
    this.requests = [];
  }

  /** Substitute saved HTML or an error for the shared request boundary. */
  async get(url, cacheKey, cacheTTL, options) {
    this.requests.push({ url, cacheKey, cacheTTL, options });
    assert.ok(this.responses.length, 'unexpected request');
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return response;
  }
}

test('groups matching Community posts by thread without verifying their claims', async () => {
  const client = new FixtureSteamClient(await fixture('community-search'));
  const result = await client.searchDiscussions({ appId: 620, query: 'crash', sort: 'time' });

  assert.equal(result.status, 'available');
  assert.equal(result.experimental, true);
  assert.equal(result.source, 'steam_community_discussions');
  assert.match(result.evidenceNotice, /user claims/i);
  assert.match(result.evidenceNotice, /does not verify/i);
  assert.equal(result.threads.length, 2);
  assert.deepEqual(result.threads[0].identifier, {
    appId: 620,
    forumId: '0',
    threadId: '4514379914249040961',
  });
  assert.equal(result.threads[0].title, 'Portal 2 crash');
  assert.equal(result.threads[0].replyCount, 2);
  assert.equal(result.threads[0].matchingPostsObserved, 2);
  assert.deepEqual(
    result.threads[0].matches.map((match) => match.authorLabel),
    ['Player One', 'Player Two']
  );
  assert.equal(result.threads[0].matches[0].timestamp, 1786624750);
  assert.equal(result.threads[0].matches[0].snippet, 'Still crashing after update.');
  assert.equal(result.threads[0].matches[0].postId, '589560695544210390');
  assert.equal(result.threads[1].matches[0].postId, null);
  assert.equal(result.pagination.nextPage, 2);
  assert.equal(result.pagination.complete, false);
  assert.equal(result.pagination.pagesFetched, 1);
  assert.equal(client.requests.length, 1);
  const url = new URL(client.requests[0].url);
  assert.equal(url.origin + url.pathname, 'https://steamcommunity.com/app/620/discussions/search/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    q: 'crash',
    sort: 'time',
    p: '1',
    l: 'english',
  });
});

test('retrieves bounded thread pages from search identifiers, preserving links and Steam markers', async () => {
  const client = new FixtureSteamClient(
    await fixture('community-search'),
    await fixture('community-thread-page-1'),
    await fixture('community-thread-page-2')
  );
  const search = await client.searchDiscussions({ appId: 620, query: 'crash' });
  const identifier = search.threads[0].identifier;
  const first = await client.getDiscussionThread(identifier);
  assert.equal(
    first.pagination.nextPage,
    2,
    'parse the single-quoted callback URL used by live Steam'
  );
  const second = await client.getDiscussionThread({
    ...identifier,
    page: first.pagination.nextPage,
  });

  assert.equal(first.status, 'available');
  assert.equal(first.title, 'Portal 2 crash');
  assert.equal(first.opener.authorLabel, 'Example Dev');
  assert.deepEqual(first.opener.steamMarkers, [{ kind: 'developer', label: '[developer]' }]);
  assert.equal(
    first.opener.text,
    'Please describe the crash.\nSee this guide.\nOriginally posted by Player: game closes\nWe are investigating.'
  );
  assert.deepEqual(first.opener.links, [{ text: 'this guide', url: 'https://example.com/help' }]);
  assert.deepEqual(first.replies[0].steamMarkers, [{ kind: 'moderator', label: 'Moderator' }]);
  assert.equal(first.replies[0].timestamp, 1786624750);
  assert.equal(first.replies[0].links.length, 1);
  assert.equal(
    first.replies[0].links[0].url,
    'https://steamcommunity.com/app/620/discussions/0/4514379914249040961/#c589560695544210391'
  );
  assert.deepEqual(first.replies[1].steamMarkers, []);
  assert.equal(first.pagination.totalItems, 3);
  assert.equal(first.pagination.hasMore, true);
  assert.equal(first.pagination.complete, false);
  assert.equal(second.replies.length, 1);
  assert.equal(second.replies[0].id, '589560695544210392');
  assert.deepEqual(second.replies[0].steamMarkers, [{ kind: 'developer', label: '[developer]' }]);
  assert.equal(second.pagination.nextPage, null);
  assert.equal(second.pagination.hasMore, false);
  assert.equal(second.pagination.complete, false, 'page 2 alone is not a complete thread');
  assert.equal(client.requests.length, 3, 'one request per call, no link following');
  assert.equal(new URL(client.requests[2].url).searchParams.get('ctp'), '2');
});

test('distinguishes genuine empty search pages from blocked, missing, and changed Community pages', async () => {
  const empty = new FixtureSteamClient(await fixture('community-search-empty'));
  const result = await empty.searchDiscussions({ appId: 620, query: 'no-match' });
  assert.equal(result.status, 'available');
  assert.equal(result.pagination.complete, true);
  assert.equal(result.pagination.totalItems, 0);
  assert.deepEqual(result.threads, []);

  for (const [name, status, reason] of [
    ['community-mature', 'blocked', 'mature_content'],
    ['community-login', 'blocked', 'login_required'],
    ['community-private', 'blocked', 'restricted_content'],
    ['community-challenge', 'blocked', 'challenge'],
    ['community-deleted-thread', 'unavailable', 'not_found_or_deleted'],
    ['community-incomplete', 'unavailable', 'changed_markup'],
  ]) {
    const html = await fixture(name);
    const client = new FixtureSteamClient(html, html);
    const results = [
      await client.searchDiscussions({ appId: 620, query: 'crash' }),
      await client.getDiscussionThread(identifier),
    ];
    for (const page of results) {
      assert.equal(page.status, status, name);
      assert.equal(page.reason, reason, name);
      assert.equal(page.pagination.complete, false, name);
      assert.equal(page.pagination.hasMore, null, name);
      assert.equal(page.pagination.nextPage, null, name);
    }
    assert.equal(client.requests.length, 2, 'never submit forms or crawl an interstitial');
  }
});

test('reports deleted posts and incomplete thread markup without inventing missing evidence', async () => {
  const client = new FixtureSteamClient(
    await fixture('community-thread-deleted-post'),
    await fixture('community-thread-incomplete')
  );
  const deleted = await client.getDiscussionThread(identifier);
  assert.equal(deleted.status, 'available');
  assert.equal(deleted.pagination.complete, true);
  assert.equal(deleted.replies[0].status, 'deleted');
  assert.equal(deleted.replies[0].text, null);
  assert.equal(deleted.replies[0].authorLabel, null);
  assert.equal(deleted.replies[0].timestamp, null);
  assert.deepEqual(deleted.replies[0].steamMarkers, []);

  const incomplete = await client.getDiscussionThread(identifier);
  assert.equal(incomplete.status, 'partial');
  assert.equal(incomplete.opener.text, 'Game crashes.');
  assert.equal(incomplete.replies[0].text, null);
  assert.equal(incomplete.replies[0].status, 'unavailable');
  assert.equal(incomplete.pagination.complete, false);
  assert.equal(incomplete.pagination.hasMore, null);
  assert.ok(incomplete.reason);
});

test('Community requests reuse cache, rate limiting, retries, and bounded anonymous HTTP options', async () => {
  const html = await fixture('community-search');
  const originalGet = axios.get;
  const requests = [];
  const client = new SteamAPIClient({ ...config, rateLimitEnabled: true });
  axios.get = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1)
      throw new axios.AxiosError('temporary network failure', 'ECONNRESET');
    return { data: html };
  };
  try {
    const first = await client.searchDiscussions({ appId: 620, query: ' crash ', sort: 'time' });
    const cached = await client.searchDiscussions({ appId: 620, query: 'crash', sort: 'time' });
    assert.deepEqual(first, cached);
    assert.equal(requests.length, 2, 'one initial attempt and one retry; second call hits cache');
    assert.equal(client.getRateLimiterStatus().remaining, 29);
    assert.equal(client.getCacheStats().hits, 1);
    assert.equal(requests[0].options.maxRedirects, 0);
    assert.equal(requests[0].options.timeout, 15000);
    assert.equal(requests[0].options.maxContentLength, 2_000_000);
    assert.equal(requests[0].options.responseType, 'text');
    assert.ok(requests[0].options.headers['User-Agent']);
    assert.equal(requests[0].options.headers.Cookie, undefined);
    await client.searchDiscussions({ appId: 620, query: 'crash', sort: 'relevance' });
    await client.searchDiscussions({ appId: 620, query: 'crash', sort: 'time', page: 2 });
    assert.equal(requests.length, 4, 'ordering and page each get their own cache key');
  } finally {
    axios.get = originalGet;
  }
});

test('returns explicit HTTP failure reasons and never caches access or parsing failures', async () => {
  const originalGet = axios.get;
  let calls = 0;
  let response = await fixture('community-mature');
  let error;
  axios.get = async () => {
    calls++;
    if (error) throw error;
    return { data: response };
  };
  try {
    const client = new SteamAPIClient(config);
    const blocked = await client.getDiscussionThread(identifier);
    assert.equal(blocked.reason, 'mature_content');
    response = await fixture('community-thread-page-1');
    assert.equal((await client.getDiscussionThread(identifier)).status, 'available');
    assert.equal(calls, 2, 'interstitials must not persist in cache');
    client.clearCache();
    response = '<html>unexpected upstream document</html>';
    assert.equal((await client.getDiscussionThread(identifier)).reason, 'changed_markup');
    response = await fixture('community-thread-page-1');
    assert.equal((await client.getDiscussionThread(identifier)).status, 'available');
    assert.equal(calls, 4);

    for (const [status, expectedStatus, reason] of [
      [302, 'blocked', 'redirect_not_followed'],
      [401, 'blocked', 'login_required'],
      [403, 'blocked', 'access_denied'],
      [404, 'unavailable', 'not_found_or_deleted'],
      [410, 'unavailable', 'not_found_or_deleted'],
    ]) {
      client.clearCache();
      error = new axios.AxiosError('Steam failure', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status,
        data: '',
      });
      const result = await client.getDiscussionThread(identifier);
      assert.equal(result.status, expectedStatus);
      assert.equal(result.reason, reason);
      assert.equal(result.pagination.pagesFetched, 0);
      assert.equal(result.pagination.complete, false);
      assert.equal(result.opener, null);
    }
  } finally {
    axios.get = originalGet;
  }
});

test('pagination never treats a missing, mismatched, or out-of-range page as complete evidence', async () => {
  const thread = await fixture('community-thread-page-1');
  const search = await fixture('community-search');
  const client = new FixtureSteamClient(
    await fixture('community-search-empty'),
    search.replace(/Showing 1-3 of 13 entries/, 'Unknown paging layout'),
    search,
    thread,
    thread.replace('"total_count":3', '"total_count":2'),
    thread
      .replace('"total_count":3', '"total_count":0')
      .replace('"start":0', '"start":2')
      .replace(/<div class="forumtopic_comments">[\s\S]*?<script>/, '</div><script>'),
    thread.replace('"pagesize":2', '"pagesize":15')
  );
  const emptyLater = await client.searchDiscussions({ appId: 620, query: 'no-match', page: 2 });
  assert.equal(emptyLater.pagination.complete, false);
  assert.equal(
    emptyLater.pagination.totalItems,
    null,
    'empty later page does not establish zero matching posts'
  );

  const missingPaging = await client.searchDiscussions({ appId: 620, query: 'crash' });
  assert.equal(missingPaging.status, 'partial');
  assert.equal(missingPaging.reason, 'pagination_unavailable');
  assert.equal(missingPaging.threads.length, 2);
  assert.equal(missingPaging.pagination.hasMore, null);

  const wrongSearchPage = await client.searchDiscussions({ appId: 620, query: 'crash', page: 2 });
  assert.equal(wrongSearchPage.status, 'partial');
  assert.equal(wrongSearchPage.pagination.nextPage, null);
  const wrongThreadPage = await client.getDiscussionThread({ ...identifier, page: 2 });
  assert.equal(wrongThreadPage.status, 'partial');
  assert.equal(wrongThreadPage.pagination.hasMore, null);

  const completeThread = await client.getDiscussionThread(identifier);
  assert.equal(completeThread.pagination.complete, true);
  assert.equal(completeThread.pagination.totalItems, 2);
  const outOfRange = await client.getDiscussionThread({ ...identifier, page: 2 });
  assert.equal(outOfRange.reason, 'page_out_of_range');
  assert.equal(outOfRange.pagination.complete, false);

  const missingReply = await client.getDiscussionThread(identifier);
  assert.equal(missingReply.status, 'partial');
  assert.equal(missingReply.reason, 'changed_markup');
  assert.equal(missingReply.pagination.complete, false);
});

test('caps post text and fetched records without claiming complete results', async () => {
  const thread = await fixture('community-thread-page-1');
  const search = await fixture('community-search');
  const longText = 'x'.repeat(20001);
  const rows = Array.from(
    { length: 51 },
    (_, index) =>
      `<div class="post_searchresult"><div class="searchresult_matches"><a class="post_searchresult_simplereply" href="https://steamcommunity.com/app/620/discussions/0/4514379914249040961/#c${index + 1}"><div class="forum_searchresult_reply_inner">crash</div></a></div></div>`
  ).join('');
  const client = new FixtureSteamClient(
    thread.replace('Still crashing.', longText).replace('"total_count":3', '"total_count":2'),
    search.replace('Same crash here.', longText),
    search
      .replace('<div class="post_searchresult">', rows + '<div class="post_searchresult">')
      .replace('Showing 1-3 of 13 entries', 'Showing 1-54 of 54 entries')
  );
  const longThread = await client.getDiscussionThread(identifier);
  assert.equal(longThread.replies[1].text.length, 20000);
  assert.equal(longThread.replies[1].truncated, true);
  assert.equal(longThread.status, 'partial');
  assert.equal(longThread.reason, 'content_truncated');
  assert.equal(longThread.pagination.complete, false);
  const longSearch = await client.searchDiscussions({ appId: 620, query: 'crash' });
  assert.equal(longSearch.threads[0].matches[1].snippet.length, 20000);
  assert.equal(longSearch.threads[0].matches[1].truncated, true);
  assert.equal(longSearch.status, 'partial');
  const capped = await client.searchDiscussions({ appId: 620, query: 'crash' });
  assert.equal(capped.threads[0].matchingPostsObserved, 50);
  assert.equal(capped.status, 'partial');
  assert.equal(capped.reason, 'item_limit');
  assert.equal(capped.pagination.complete, false);
});

test('validates public inputs before any request and keeps Community identifiers app-scoped', async () => {
  const client = new FixtureSteamClient();
  for (const input of [
    { appId: 0, query: 'crash' },
    { appId: 1.5, query: 'crash' },
    { appId: 4294967296, query: 'crash' },
    { appId: 620, query: ' ' },
    { appId: 620, query: 'x'.repeat(257) },
    { appId: 620, query: 'crash', sort: 'newest' },
    { appId: 620, query: 'crash', page: 10001 },
  ])
    await assert.rejects(client.searchDiscussions(input));
  for (const input of [
    { ...identifier, forumId: '../login' },
    { ...identifier, forumId: '01' },
    { ...identifier, threadId: 4514379914249040961 },
    { ...identifier, threadId: '0' },
    { ...identifier, threadId: '1'.repeat(21) },
    { ...identifier, page: 0 },
    { ...identifier, page: 1.5 },
  ])
    await assert.rejects(client.getDiscussionThread(input));
  assert.equal(client.requests.length, 0);

  const html = await fixture('community-search');
  const wrongApp = new FixtureSteamClient(
    html.replaceAll('/app/620/discussions/0/', '/app/570/discussions/0/')
  );
  const filtered = await wrongApp.searchDiscussions({ appId: 620, query: 'crash' });
  assert.equal(filtered.status, 'partial');
  assert.equal(filtered.reason, 'changed_markup');
  assert.deepEqual(
    filtered.threads.map((thread) => thread.identifier.threadId),
    ['573795381137157331']
  );

  const wrongForum = new FixtureSteamClient(await fixture('community-thread-page-1'));
  const mismatched = await wrongForum.getDiscussionThread({ ...identifier, forumId: '1' });
  assert.equal(mismatched.status, 'unavailable');
  assert.equal(mismatched.reason, 'changed_markup');
  assert.equal(mismatched.opener, null);
});

test('changed search markup cannot invent complete coverage or collapse unresolved replies', async () => {
  const html = await fixture('community-search');
  const client = new FixtureSteamClient(
    html.replace('Showing 1-3 of 13 entries', 'Showing 11-13 of 13 entries'),
    html.replaceAll('#c589560695544210', '#reply589560695544210'),
    html.replaceAll('/discussions/0/', '/discussions/00/'),
    html.replaceAll('forum_searchresult_reply_inner', 'unknown_snippet')
  );
  const inconsistentRange = await client.searchDiscussions({ appId: 620, query: 'crash' });
  assert.equal(inconsistentRange.status, 'partial');
  assert.equal(inconsistentRange.reason, 'pagination_unavailable');
  assert.equal(inconsistentRange.pagination.complete, false);
  assert.equal(inconsistentRange.pagination.hasMore, null);

  for (let index = 0; index < 2; index++) {
    const invalidLink = await client.searchDiscussions({ appId: 620, query: 'crash' });
    assert.equal(invalidLink.status, 'partial');
    assert.equal(invalidLink.reason, 'changed_markup');
    assert.equal(invalidLink.pagination.complete, false);
    assert.deepEqual(
      invalidLink.threads.map((thread) => thread.identifier.threadId),
      ['573795381137157331']
    );
  }
  const unreadable = await client.searchDiscussions({ appId: 620, query: 'crash' });
  assert.equal(unreadable.status, 'unavailable');
  assert.equal(unreadable.reason, 'changed_markup');
  assert.deepEqual(unreadable.threads, []);
  assert.equal(unreadable.pagination.hasMore, null);
});
