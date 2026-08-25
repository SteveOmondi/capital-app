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

export async function getWeeklySchedules(day?: string): Promise<{ day: string; schedule: ShowSlot[] }> {
  const targetDay = (day || getTodayName()).toLowerCase();
  const schedule = WEEKLY_SCHEDULE[targetDay] || WEEKLY_SCHEDULE['monday'];

  // Calculate live show status
  const now = new Date();
  const currentHours = now.getHours().toString().padStart(2, '0');
  const currentMinutes = now.getMinutes().toString().padStart(2, '0');
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

function getTodayName(): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date().getDay()];
}
