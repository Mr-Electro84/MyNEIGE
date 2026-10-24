'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { embeddedRequestAllowed, embeddedNavigationAllowed } = require('../src/main/embedded-content-policy');

const PLAYER = 'https://www.youtube.com/embed/fixture';
function fixture(page = 'https://cours.univ-avignon.fr/lesson') {
  const top = { url: page, parent: null }; top.top = top;
  const h5p = { url: 'https://avignon.h5p.com/content/123/embed', top, parent: top };
  const youtube = { url: PLAYER, top, parent: h5p };
  const contents = { mainFrame: top, isDestroyed: () => false };
  const child = { url: 'about:blank', top, parent: top };
  return { top, h5p, youtube, contents, child,
    request: { url: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=fixture', resourceType: 'media', frame: youtube, webContents: contents },
    navigation: { url: PLAYER, isMainFrame: false, frame: child } };
}
test('YouTube/H5P embed on any university site, with nested and empty frames', () => {
  for (const page of ['https://univ-avignon.fr/lesson', 'https://e-uapv.univ-avignon.fr/lesson', 'https://cours.univ-avignon.fr/lesson']) {
    const f = fixture(page);
    assert(embeddedNavigationAllowed(f.navigation));
    assert(embeddedNavigationAllowed({ ...f.navigation, url: 'https://www.youtube-nocookie.com/embed/fixture' }));
    assert(embeddedNavigationAllowed({ ...f.navigation, url: f.h5p.url }));
    assert(embeddedNavigationAllowed({ ...f.navigation, url: 'https://h5p.org/h5p/embed/123' }));
    assert(embeddedRequestAllowed(f.request));
    assert(embeddedRequestAllowed({ ...f.request, url: PLAYER, resourceType: 'subFrame', frame: f.child }));
    const blank = { url: 'about:srcdoc', top: f.top, parent: f.top };
    f.h5p.parent = blank;
    assert(embeddedRequestAllowed(f.request));
  }
});
test('H5P can bootstrap the YouTube API and thumbnails before the player exists', () => {
  const f = fixture();
  for (const [url, resourceType] of [['https://www.youtube.com/iframe_api', 'script'],
    ['https://www.youtube.com/player_api', 'script'], ['https://www.youtube.com/s/player/123/widget.js', 'script'],
    ['https://i.ytimg.com/vi/fixture/hqdefault.jpg', 'image'], ['https://avignon.h5p.com/js/h5p-resizer.js', 'script']])
    assert(embeddedRequestAllowed({ ...f.request, url, resourceType, frame: f.top }), url);
  assert(!embeddedRequestAllowed({ ...f.request, frame: f.top }));
  assert(!embeddedRequestAllowed({ ...f.request, frame: f.top, url: 'https://www.youtube.com/iframe_api', resourceType: 'xhr' }));
});
test('player resources and local MediaSource stay within the embedded course context', () => {
  const f = fixture();
  for (const host of ['youtubei.googleapis.com', 'youtube.googleapis.com', 'jnn-pa.googleapis.com', 'yt3.ggpht.com', 'www.gstatic.com'])
    assert(embeddedRequestAllowed({ ...f.request, url: `https://${host}/resource`, resourceType: 'xhr' }));
  assert(embeddedRequestAllowed({ ...f.request, url: 'blob:https://www.youtube.com/fixture' }));
  assert(!embeddedRequestAllowed({ ...f.request, url: 'blob:https://evil.test/fixture' }));
  assert(embeddedRequestAllowed({ ...f.request, url: 'https://eu-west-1.cdn.h5p.com/content.js', resourceType: 'script', frame: f.h5p }));
  assert(embeddedRequestAllowed({ ...f.request, url: 'https://fonts.googleapis.com/css?family=OpenSans', resourceType: 'stylesheet', frame: f.h5p }));
});
test('top-level video browsing, popups, non-embed frames and unrelated Google services stay refused', () => {
  const f = fixture();
  for (const url of ['https://www.youtube.com/watch?v=fixture', 'https://www.youtube.com/', 'https://youtu.be/fixture',
    'https://www.youtube.com.evil.test/embed/fixture', 'https://evilyoutube.com/embed/fixture',
    'http://www.youtube.com/embed/fixture', 'https://u@www.youtube.com/embed/fixture',
    'https://www.youtube.com:444/embed/fixture', 'https://avignon.h5p.com/login', 'file:///C:/secret']) {
    assert(!embeddedNavigationAllowed({ ...f.navigation, url }), url);
    assert(!embeddedRequestAllowed({ ...f.request, frame: f.child, url, resourceType: 'subFrame' }), url);
  }
  assert(!embeddedNavigationAllowed({ ...f.navigation, isMainFrame: true }));
  assert(!embeddedRequestAllowed({ ...f.request, url: PLAYER, resourceType: 'mainFrame' }));
  for (const url of ['https://drive.google.com/secret', 'https://storage.googleapis.com/secret', 'https://www.google.com/search?q=test',
    'https://evil.test/secret', 'http://rr1.googlevideo.com/file', 'https://googlevideo.com.evil.test/file'])
    assert(!embeddedRequestAllowed({ ...f.request, url }), url);
});
test('missing, destroyed or foreign frame ancestry cannot grant media access', () => {
  const f = fixture();
  for (const change of [{ frame: null }, { webContents: undefined },
    { webContents: { mainFrame: {}, isDestroyed: () => false } },
    { webContents: { mainFrame: f.top, isDestroyed: () => true } }])
    assert(!embeddedRequestAllowed({ ...f.request, ...change }));
  f.h5p.url = 'https://evil.test/';
  assert(!embeddedRequestAllowed(f.request));
  f.h5p.url = 'about:blank'; f.top.url = 'https://renater.fr/';
  assert(!embeddedRequestAllowed(f.request)); assert(!embeddedNavigationAllowed(f.navigation));
  f.top.url = 'https://cours.univ-avignon.fr/';
  Object.defineProperty(f.youtube, 'url', { get() { throw new Error('Frame détruite'); } });
  assert(!embeddedRequestAllowed(f.request));
});
