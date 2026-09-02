import { getStreamGuysSessionCookie } from './src/services/streamGuysService';

async function testRecastFeeds() {
  console.log('Authenticating with StreamGuys Recast portal...');
  const cookie = await getStreamGuysSessionCookie();
  console.log('Session Cookie:', cookie);

  if (cookie) {
    const listUrl = 'https://atunwadigital-recast.streamguys1.com/sgrecast/podcasts/feeds/list?page=1&table-id=0&ct-length=50&ct-sort-column=created_at&ct-sort-order=desc';
    const res = await fetch(listUrl, {
      headers: {
        'Cookie': cookie,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    console.log('List API Status:', res.status);
    if (res.ok) {
      const data: any = await res.json();
      console.log('Total items in StreamGuys API:', data.total || (data.data ? data.data.length : 'Unknown'));
      console.log('Sample item:', JSON.stringify(data.data ? data.data[0] : data, null, 2));
    }
  }
}

testRecastFeeds();
