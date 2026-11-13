import { detectYouTubeVideo, parseYouTubeUrl } from '../utils/youtubeDetector';

const ID = 'U9x-X1Un5sw';

function detected(id: string, url: string, isShort = false) {
  return {
    provider: 'youtube',
    id,
    url,
    watch_url: `https://www.youtube.com/watch?v=${id}`,
    embed_url: `https://www.youtube.com/embed/${id}`,
    thumbnail: {
      default: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      medium: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      max: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    },
    is_short: isShort,
    source: 'detected',
  };
}

const intro = '<p>NAIROBI, Kenya, Nov 13 &#8211; The story opens here.</p>\n';

describe('detectYouTubeVideo: embedded players', () => {
  it('detects an iframe player', () => {
    const src = `https://www.youtube.com/embed/${ID}?feature=oembed`;
    const html = `${intro}<iframe width="560" height="315" src="${src}" frameborder="0" allowfullscreen></iframe>`;
    expect(detectYouTubeVideo(html)).toEqual(detected(ID, src));
  });

  it('detects a privacy-mode (youtube-nocookie) iframe and a lazy-loaded data-src iframe', () => {
    const nocookie = `https://www.youtube-nocookie.com/embed/${ID}`;
    expect(detectYouTubeVideo(`<iframe src='${nocookie}'></iframe>`)).toMatchObject({
      id: ID,
      url: nocookie,
    });

    const lazy = `<iframe data-src="https://www.youtube.com/embed/${ID}?rel=0&amp;start=5" src="about:blank"></iframe>`;
    expect(detectYouTubeVideo(lazy)).toMatchObject({
      id: ID,
      url: `https://www.youtube.com/embed/${ID}?rel=0&start=5`,
    });
  });

  it('detects a WordPress embed block (rendered figure with the iframe)', () => {
    const html = `${intro}<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-16-9 wp-has-aspect-ratio"><div class="wp-block-embed__wrapper">
<iframe title="Story video" width="500" height="281" src="https://www.youtube.com/embed/${ID}?feature=oembed" allowfullscreen></iframe>
</div></figure>`;
    expect(detectYouTubeVideo(html)).toMatchObject({ id: ID, is_short: false, source: 'detected' });
  });

  it('detects a WordPress embed block that holds only the link (oEmbed not resolved)', () => {
    const url = `https://www.youtube.com/watch?v=${ID}&amp;t=30s`;
    const html = `${intro}<figure class="wp-block-embed is-provider-youtube"><div class="wp-block-embed__wrapper">${url}</div><figcaption>Watch</figcaption></figure>`;
    expect(detectYouTubeVideo(html)).toEqual(
      detected(ID, `https://www.youtube.com/watch?v=${ID}&t=30s`),
    );
  });

  it('detects the embed block comment with escaped JSON slashes', () => {
    const html = `<!-- wp:embed {"url":"https:\\/\\/youtu.be\\/${ID}","type":"video","providerNameSlug":"youtube"} -->\n<!-- /wp:embed -->`;
    expect(detectYouTubeVideo(html)).toMatchObject({ id: ID, url: `https://youtu.be/${ID}` });
  });

  it('detects an [embed] shortcode', () => {
    expect(detectYouTubeVideo(`${intro}[embed]https://youtu.be/${ID}[/embed]`)).toMatchObject({
      id: ID,
    });
  });
});

describe('detectYouTubeVideo: bare URL on its own line', () => {
  it.each([
    [
      'a youtu.be link in its own paragraph',
      `<p>https://youtu.be/${ID}?si=abc</p>`,
      `https://youtu.be/${ID}?si=abc`,
    ],
    [
      'a watch link on its own line',
      `Text above.\nhttps://www.youtube.com/watch?v=${ID}\nText below.`,
      `https://www.youtube.com/watch?v=${ID}`,
    ],
    [
      'a mobile watch link with nbsp padding',
      `<p>&nbsp;https://m.youtube.com/watch?v=${ID}&nbsp;</p>`,
      `https://m.youtube.com/watch?v=${ID}`,
    ],
    [
      'a link between line breaks',
      `Above<br />https://youtu.be/${ID}<br>Below`,
      `https://youtu.be/${ID}`,
    ],
    [
      'an auto-linked URL alone in its paragraph',
      `<p><a href="https://youtu.be/${ID}">https://youtu.be/${ID}</a></p>`,
      `https://youtu.be/${ID}`,
    ],
    [
      'a /live/ link',
      `<p>https://www.youtube.com/live/${ID}</p>`,
      `https://www.youtube.com/live/${ID}`,
    ],
  ])('detects %s', (_name, body, url) => {
    expect(detectYouTubeVideo(`${intro}${body}`)).toEqual(detected(ID, url));
  });

  it('marks /shorts/ links as is_short', () => {
    const url = `https://youtube.com/shorts/${ID}?feature=share`;
    expect(detectYouTubeVideo(`${intro}<p>${url}</p>`)).toEqual(detected(ID, url, true));
  });

  it('returns the first video in the body when there are several', () => {
    const html = `<p>https://youtu.be/AAAAAAAAAAA</p><iframe src="https://www.youtube.com/embed/BBBBBBBBBBB"></iframe>`;
    expect(detectYouTubeVideo(html)?.id).toBe('AAAAAAAAAAA');
    const reversed = `<iframe src="https://www.youtube.com/embed/BBBBBBBBBBB"></iframe><p>https://youtu.be/AAAAAAAAAAA</p>`;
    expect(detectYouTubeVideo(reversed)?.id).toBe('BBBBBBBBBBB');
  });
});

describe('detectYouTubeVideo: false positives', () => {
  it.each([
    [
      'an inline text link',
      `<p>Watch the full interview <a href="https://youtu.be/${ID}">on YouTube</a> tonight.</p>`,
    ],
    [
      'an inline link alone in a paragraph but with its own text',
      `<p><a href="https://youtu.be/${ID}">Watch the interview</a></p>`,
    ],
    ['a bare URL inside running text', `<p>The clip (https://youtu.be/${ID}) went viral.</p>`],
    ['a channel link on its own line', `<p>https://www.youtube.com/@CapitalFMKenya</p>`],
    ['a /channel/ link', `<p>https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv</p>`],
    [
      'a /c/ and /user/ link',
      `<p>https://www.youtube.com/c/CapitalFM</p>\n<p>https://www.youtube.com/user/capitalfm</p>`,
    ],
    [
      'a playlist link and a playlist player',
      `<p>https://www.youtube.com/playlist?list=PL123</p><iframe src="https://www.youtube.com/embed/videoseries?list=PL123"></iframe>`,
    ],
    [
      'a channel link in an embed block',
      `<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">https://www.youtube.com/@CapitalFMKenya</div></figure>`,
    ],
    ['a non-YouTube player', `<iframe src="https://player.vimeo.com/video/123456"></iframe>`],
    [
      'a look-alike host',
      `<p>https://notyoutube.com/watch?v=${ID}</p><p>https://youtube.com.evil.example/watch?v=${ID}</p>`,
    ],
    ['a malformed id', `<p>https://youtu.be/short</p>`],
  ])('ignores %s', (_name, body) => {
    expect(detectYouTubeVideo(`${intro}${body}`)).toBeNull();
  });

  it('returns null for empty or non-string bodies', () => {
    expect(detectYouTubeVideo('')).toBeNull();
    expect(detectYouTubeVideo(undefined)).toBeNull();
    expect(detectYouTubeVideo({ html: 'x' })).toBeNull();
  });
});

describe('parseYouTubeUrl', () => {
  it('reads the id from each link form', () => {
    expect(parseYouTubeUrl(`https://youtu.be/${ID}`)).toEqual({ id: ID, isShort: false });
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&list=PL1`)).toEqual({
      id: ID,
      isShort: false,
    });
    expect(parseYouTubeUrl(`https://www.youtube.com/embed/${ID}`)).toEqual({
      id: ID,
      isShort: false,
    });
    expect(parseYouTubeUrl(`https://www.youtube.com/shorts/${ID}`)).toEqual({
      id: ID,
      isShort: true,
    });
    expect(parseYouTubeUrl(`http://youtube.com/v/${ID}`)).toEqual({ id: ID, isShort: false });
  });

  it('rejects watch pages without a video and non-http schemes', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch')).toBeNull();
    expect(parseYouTubeUrl(`javascript:https://youtu.be/${ID}`)).toBeNull();
  });
});
