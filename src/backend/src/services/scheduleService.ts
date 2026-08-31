export interface ShowSlot {
  id: string;
  title: string;
  presenters: string[];
  startTime: string; // e.g. "06:00"
  endTime: string;   // e.g. "10:00"
  dayOfWeek: string; // "monday", "tuesday", etc.
  description: string;
  coverImageUrl?: string;
  isLiveNow?: boolean;
}

const WEEKLY_SCHEDULE: Record<string, ShowSlot[]> = {
  monday: [
    {
      id: 'jam-984-mon',
      title: 'Capital In The Morning',
      presenters: ['Fareed Khimani', 'Davina Leonard'],
      startTime: '06:00',
      endTime: '10:00',
      dayOfWeek: 'monday',
      description: 'Kickstart your weekday morning with high energy, global news, comedic commentary, and great hits.',
    },
    {
      id: 'hits-not-homework-mon',
      title: 'The Jam',
      presenters: ['Martin Kariuki', 'June Gachui'],
      startTime: '15:00',
      endTime: '19:00',
      dayOfWeek: 'monday',
      description: 'Your drive-home companion packed with Nairobi traffic updates, trending topics, and hit music.',
    },
  ],
  tuesday: [
    {
      id: 'jam-984-tue',
      title: 'Capital In The Morning',
      presenters: ['Fareed Khimani', 'Davina Leonard'],
      startTime: '06:00',
      endTime: '10:00',
      dayOfWeek: 'tuesday',
      description: 'Kickstart your weekday morning with high energy, global news, comedic commentary, and great hits.',
    },
  ],
  wednesday: [
    {
      id: 'jam-984-wed',
      title: 'Capital In The Morning',
      presenters: ['Fareed Khimani', 'Davina Leonard'],
      startTime: '06:00',
      endTime: '10:00',
      dayOfWeek: 'wednesday',
      description: 'Kickstart your weekday morning with high energy, global news, comedic commentary, and great hits.',
    },
  ],
  thursday: [
    {
      id: 'jam-984-thu',
      title: 'Capital In The Morning',
      presenters: ['Fareed Khimani', 'Davina Leonard'],
      startTime: '06:00',
      endTime: '10:00',
      dayOfWeek: 'thursday',
      description: 'Kickstart your weekday morning with high energy, global news, comedic commentary, and great hits.',
    },
  ],
  friday: [
    {
      id: 'jam-984-fri',
      title: 'Capital In The Morning',
      presenters: ['Fareed Khimani', 'Davina Leonard'],
      startTime: '06:00',
      endTime: '10:00',
      dayOfWeek: 'friday',
      description: 'Kickstart your weekday morning with high energy, global news, comedic commentary, and great hits.',
    },
  ],
  saturday: [
    {
      id: 'capital-jazz-sat',
      title: 'Capital Jazz Club',
      presenters: ['DJ Adrian'],
      startTime: '18:00',
      endTime: '22:00',
      dayOfWeek: 'saturday',
      description: 'Smooth jazz melodies, soul classics, and weekend vibes.',
    },
  ],
  sunday: [
    {
      id: 'sunday-soul-sun',
      title: 'Sunday Soul Sessions',
      presenters: ['DJ Leo'],
      startTime: '14:00',
      endTime: '18:00',
      dayOfWeek: 'sunday',
      description: 'The finest classic soul, neo-soul, and old-school R&B.',
    },
  ],
};

/**
 * Helper to get current Date object offset to East Africa Time (EAT: UTC+3).
 */
export function getEatDate(date: Date = new Date()): Date {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60 * 1000;
  return new Date(utcMs + 3 * 60 * 60 * 1000);
}

export function formatEatIsoString(date: Date = new Date()): string {
  const eat = getEatDate(date);
  const year = eat.getFullYear();
  const month = String(eat.getMonth() + 1).padStart(2, '0');
  const day = String(eat.getDate()).padStart(2, '0');
  const hours = String(eat.getHours()).padStart(2, '0');
  const minutes = String(eat.getMinutes()).padStart(2, '0');
  const seconds = String(eat.getSeconds()).padStart(2, '0');
  const millis = String(eat.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}+03:00`;
}

export function getTodayName(): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const eatDate = getEatDate();
  return days[eatDate.getDay()];
}

export async function getWeeklySchedules(day?: string): Promise<{ day: string; schedule: ShowSlot[] }> {
  const targetDay = (day || getTodayName()).toLowerCase();
  const schedule = WEEKLY_SCHEDULE[targetDay] || WEEKLY_SCHEDULE['monday'];

  // Calculate live show status using East Africa Time (EAT = UTC+3)
  const eatNow = getEatDate();
  const currentHours = eatNow.getHours().toString().padStart(2, '0');
  const currentMinutes = eatNow.getMinutes().toString().padStart(2, '0');
  const currentTimeStr = `${currentHours}:${currentMinutes}`;

  const enrichedSchedule = schedule.map((slot) => ({
    ...slot,
    isLiveNow: currentTimeStr >= slot.startTime && currentTimeStr <= slot.endTime,
  }));

  return {
    day: targetDay,
    schedule: enrichedSchedule,
  };
}

export async function getCurrentLiveShow(): Promise<ShowSlot | null> {
  const { schedule } = await getWeeklySchedules();
  const liveShow = schedule.find((slot) => slot.isLiveNow);
  return liveShow || null;
}
