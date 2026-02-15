/**
 * Calendar Routes
 * Migrated from lit-bloated/server/routes/calendar.route.js
 * Google Calendar integration for booking lessons
 */

import { Router } from 'express';
import { google } from 'googleapis';
import { brandResolver } from '../middleware/brandResolver.js';

const router = Router();

// Apply brand resolver
router.use(brandResolver);

// Auth setup using GOOGLE_APPLICATION_CREDENTIALS env var
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

// Book a lesson
router.post('/book', async (req, res) => {
  const { name, email, time } = req.body;
  const start = new Date(time);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour

  try {
    const client = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: client });

    // 1. locate covering "available" event
    const { data } = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true
    });

    const availEvent = data.items.find(ev =>
      ev.summary?.toLowerCase().startsWith('available') &&
      new Date(ev.start.dateTime) <= start &&
      new Date(ev.end.dateTime) >= end
    );

    if (!availEvent) {
      return res.status(409).json({ success: false, error: 'Slot no longer free' });
    }

    // 2. delete the old "available"
    await calendar.events.delete({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      eventId: availEvent.id
    });

    // 3. create the lesson
    const lesson = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: `Lesson with ${name}`,
        description: 'Lesson booked via LIT',
        start: { dateTime: start.toISOString(), timeZone: 'Australia/Brisbane' },
        end: { dateTime: end.toISOString(), timeZone: 'Australia/Brisbane' }
      }
    });

    // 4. split the leftover time (if any)
    const aStart = new Date(availEvent.start.dateTime);
    const aEnd = new Date(availEvent.end.dateTime);

    const blocks = [];
    if (aStart < start) blocks.push({ s: aStart, e: start });
    if (end < aEnd) blocks.push({ s: end, e: aEnd });

    for (const b of blocks) {
      await calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        requestBody: {
          summary: 'available',
          start: { dateTime: b.s.toISOString(), timeZone: 'Australia/Brisbane' },
          end: { dateTime: b.e.toISOString(), timeZone: 'Australia/Brisbane' }
        }
      });
    }

    res.json({ success: true, eventLink: lesson.data.htmlLink });
  } catch (err) {
    console.error('Calendar booking error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get available slots
router.get('/availability', async (req, res) => {
  try {
    const client = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: client });

    const now = new Date();
    const response = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      timeMin: now.toISOString(),
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];

    const availableSlots = events
      .filter((event) => event.summary?.toLowerCase().startsWith('available'))
      .map((event) => ({
        start: event.start.dateTime,
        end: event.end.dateTime,
      }));

    res.status(200).json({ success: true, slots: availableSlots });
  } catch (error) {
    console.error('Error fetching availability:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
