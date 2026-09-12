import { getScheduleNow, getWeeklySchedules } from './src/services/scheduleService';
import { getEvents } from './src/services/eventService';
import { getPresenters } from './src/services/presenterService';
import { getNewsCategories, getTrendingArticles } from './src/services/wordpressService';

async function runLiveTests() {
  console.log('=== Capital FM Live Public API Integration Verification ===\n');

  try {
    console.log('1. Testing /schedule/now...');
    const nowState = await getScheduleNow();
    console.log('  -> Generated At:', nowState.meta.generated_at);
    console.log('  -> On Air Show:', nowState.data.on_air ? nowState.data.on_air.show : 'GAP (null on_air)');
    console.log('  -> Up Next Show:', nowState.data.up_next?.show);
    console.log('  -> Live Stream URL:', nowState.data.live.stream_url);

    console.log('\n2. Testing /schedule?day=today...');
    const weeklySchedule = await getWeeklySchedules('today');
    console.log(`  -> Day (${weeklySchedule.day}): Total Slots = ${weeklySchedule.schedule.length}`);
    if (weeklySchedule.schedule.length > 0) {
      console.log(`  -> Sample Slot: "${weeklySchedule.schedule[0].title}" (${weeklySchedule.schedule[0].startTime} - ${weeklySchedule.schedule[0].endTime})`);
    }

    console.log('\n3. Testing /events...');
    const eventsList = await getEvents({ status: 'upcoming', per_page: 5 });
    console.log(`  -> Total Events = ${eventsList.meta.total}, Page Count = ${eventsList.data.length}`);
    if (eventsList.data.length > 0) {
      console.log(`  -> Sample Event Title: "${eventsList.data[0].title?.rendered || eventsList.data[0].title}"`);
    }

    console.log('\n4. Testing /presenters...');
    const presenters = await getPresenters({ per_page: 5 });
    console.log(`  -> Total Presenters = ${presenters.meta.total}, Returned Count = ${presenters.data.length}`);

    console.log('\n5. Testing /categories (verticals)...');
    const categories = await getNewsCategories();
    console.log(`  -> Total Categories = ${categories.length}`);
    console.log('  -> Verticals:', categories.map((c: any) => c.name).join(', '));

    console.log('\n6. Testing /articles/trending...');
    const trending = await getTrendingArticles(7);
    console.log(`  -> Total Trending Articles = ${trending.length}`);
    if (trending.length > 0) {
      console.log(`  -> #1 Trending Article: "${trending[0].title}"`);
    }

    console.log('\n=== ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ===');
    process.exit(0);
  } catch (err) {
    console.error('Integration Test Error:', err);
    process.exit(1);
  }
}

runLiveTests();
