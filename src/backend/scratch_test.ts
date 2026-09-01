import { parsePodcastRssXml } from './src/utils/rssParser';

async function testFastXmlCdata() {
  const url = 'https://capitalfm.africa/podcasts/feed/';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  const xml = await res.text();
  console.log('Fetched XML length:', xml.length);
  const channel = parsePodcastRssXml(xml);
  console.log('Channel title:', channel.title, 'Total episodes parsed:', channel.episodes.length);
  if (channel.episodes.length > 0) {
    console.log('First episode:', JSON.stringify(channel.episodes[0], null, 2));
  }
}

testFastXmlCdata();
