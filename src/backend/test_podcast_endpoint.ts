import { getPodcastChannel } from './src/services/podcastService';

async function testPodcastEndpoint() {
  console.log('Fetching podcasts via backend Podcast Service...');
  try {
    const channel = await getPodcastChannel();
    console.log('\n=== PODCAST CHANNEL RESULT ===');
    console.log('Title:', channel.title);
    console.log('Description:', channel.description);
    console.log('Total Episodes / Feeds:', channel.episodes.length);
    console.log('\nSample Episodes / Mixmasters:');
    channel.episodes.slice(0, 5).forEach((ep, i) => {
      console.log(` ${i + 1}. [${ep.title}] - Audio URL: ${ep.audioUrl}`);
    });
    console.log('\n=== PODCAST API CONFIRMED WORKING SUCCESSFULLY! ===');
    process.exit(0);
  } catch (error) {
    console.error('Error fetching podcasts:', error);
    process.exit(1);
  }
}

testPodcastEndpoint();
