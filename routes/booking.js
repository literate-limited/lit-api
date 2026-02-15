/**
 * Booking Routes
 * Migrated from lit-bloated/server/routes/bookingNative.route.js
 * Adapted to lit-mvp architecture (ES modules, direct SQL)
 */

import { Router } from 'express';
import { DateTime } from 'luxon';
import db from '../db.js';
import { brandResolver } from '../middleware/brandResolver.js';
import { verifyToken, optionalAuth } from '../middleware/auth.js';

const router = Router();

// Apply brand resolver to all routes
router.use(brandResolver);

const DURATION_OPTIONS = [5, 10, 15, 20, 30, 35, 40, 45, 50, 55, 60];

// Helper functions
function weekdayKey(dt) {
  return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][dt.weekday - 1];
}

function parseView(viewRaw) {
  const v = String(viewRaw || 'week').toLowerCase();
  if (v === 'month' || v === 'monthly') return { kind: 'month' };
  return { kind: 'week' };
}

function computeRange({ viewKind, zone, startISODate }) {
  const anchor = startISODate
    ? DateTime.fromISO(startISODate, { zone })
    : DateTime.now().setZone(zone);

  if (!anchor.isValid) {
    const now = DateTime.now().setZone(zone);
    return { from: now.startOf('week'), to: now.startOf('week').plus({ weeks: 1 }) };
  }

  if (viewKind === 'month') {
    const from = anchor.startOf('month');
    const to = from.plus({ months: 1 });
    return { from, to };
  }

  const from = anchor.startOf('week');
  const to = from.plus({ weeks: 1 });
  return { from, to };
}

function timeOnDate(dateISO, hhmm, zone) {
  return DateTime.fromISO(`${dateISO}T${hhmm}`, { zone });
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function normalizeDurations(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = list
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && DURATION_OPTIONS.includes(n));
  return Array.from(new Set(cleaned)).sort((a, b) => a - b);
}

function minDuration(list) {
  const clean = normalizeDurations(list);
  return clean.length ? clean[0] : 5;
}

function shrinkByBuffer(startDT, endDT, bufferMinutes) {
  if (!bufferMinutes) return { startDT, endDT };
  const s = startDT.plus({ minutes: bufferMinutes });
  const e = endDT.minus({ minutes: bufferMinutes });
  return { startDT: s, endDT: e };
}

function subtractRange(blocks, blackoutStart, blackoutEnd) {
  const out = [];
  for (const block of blocks) {
    const bStart = block.start;
    const bEnd = block.end;
    if (!overlaps(bStart, bEnd, blackoutStart, blackoutEnd)) {
      out.push(block);
      continue;
    }
    if (blackoutStart <= bStart && blackoutEnd >= bEnd) {
      continue;
    }
    if (blackoutStart > bStart && blackoutEnd < bEnd) {
      out.push({ start: bStart, end: blackoutStart });
      out.push({ start: blackoutEnd, end: bEnd });
      continue;
    }
    if (blackoutStart <= bStart && blackoutEnd < bEnd) {
      out.push({ start: blackoutEnd, end: bEnd });
      continue;
    }
    if (blackoutStart > bStart && blackoutEnd >= bEnd) {
      out.push({ start: bStart, end: blackoutStart });
    }
  }
  return out;
}

async function findUserByHandle(handle, brandId) {
  if (!handle) return null;
  const normalized = String(handle).toLowerCase().trim();
  let user = await db.one(
    'SELECT * FROM users WHERE handle = $1 AND brand_id = $2',
    [normalized, brandId]
  );
  if (!user) {
    user = await db.one(
      'SELECT * FROM users WHERE LOWER(name) = $1 AND brand_id = $2',
      [normalized, brandId]
    );
  }
  return user;
}

async function getOptionalUser(req) {
  const authHeader = req.headers.authorization || '';
  const [type, token] = authHeader.split(' ');
  if (!token || String(type).toLowerCase() !== 'bearer') return null;
  try {
    const jwt = await import('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
    const decoded = jwt.default.verify(token.trim(), JWT_SECRET);
    if (!decoded?.userId) return null;

    const user = await db.one('SELECT * FROM users WHERE id = $1 AND brand_id = $2', [
      decoded.userId,
      req.brandId
    ]);
    return user;
  } catch {
    return null;
  }
}

async function ensureDefaultAvailabilityRule(userId, brandId) {
  const existing = await db.one(
    'SELECT * FROM availability_rules WHERE user_id = $1 AND brand_id = $2',
    [userId, brandId]
  );
  
  if (existing) return existing;

  const defaults = {
    time_zone: 'UTC',
    weekly: JSON.stringify({
      mon: [{ start: '09:00', end: '17:00' }],
      tue: [{ start: '09:00', end: '17:00' }],
      wed: [{ start: '09:00', end: '17:00' }],
      thu: [{ start: '09:00', end: '17:00' }],
      fri: [{ start: '09:00', end: '17:00' }],
      sat: [],
      sun: []
    }),
    allowed_durations: JSON.stringify([5, 15, 30, 60]),
    slot_minutes: 5,
    buffer_minutes: 0,
    active: true
  };

  const { v4: uuidv4 } = await import('uuid');
  const id = uuidv4();
  
  await db.query(
    `INSERT INTO availability_rules (id, user_id, brand_id, time_zone, weekly, allowed_durations, slot_minutes, buffer_minutes, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, userId, brandId, defaults.time_zone, defaults.weekly, defaults.allowed_durations, 
     defaults.slot_minutes, defaults.buffer_minutes, defaults.active]
  );

  return await db.one('SELECT * FROM availability_rules WHERE id = $1', [id]);
}

async function ensureDefaultBookingTypes(userId, brandId) {
  const existing = await db.many(
    'SELECT * FROM booking_types WHERE user_id = $1 AND brand_id = $2 AND active = true',
    [userId, brandId]
  );
  if (existing.length > 0) return existing;

  const { v4: uuidv4 } = await import('uuid');
  const id = uuidv4();
  
  await db.query(
    `INSERT INTO booking_types (id, user_id, brand_id, name, description, active)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [id, userId, brandId, 'Lesson', '']
  );

  return [await db.one('SELECT * FROM booking_types WHERE id = $1', [id])];
}

async function buildSlotsForRange(hostUserId, brandId, fromUTC, toUTC) {
  const rule = await ensureDefaultAvailabilityRule(hostUserId, brandId);
  
  if (!rule.active) {
    const allowedDurations = normalizeDurations(JSON.parse(rule.allowed_durations || '[]'));
    return {
      slots: [],
      meta: {
        timeZone: rule.time_zone,
        slotMinutes: rule.slot_minutes,
        allowedDurations: allowedDurations.length ? allowedDurations : [5, 15, 30, 60]
      }
    };
  }

  const zone = rule.time_zone || 'UTC';
  const allowedDurations = normalizeDurations(JSON.parse(rule.allowed_durations || '[]'));
  const fallbackDurations = allowedDurations.length ? allowedDurations : [5, 15, 30, 60];
  const slotMinutes = minDuration(fallbackDurations.length ? fallbackDurations : [rule.slot_minutes]);
  const bufferMinutes = Number(rule.buffer_minutes || 0);

  const fromDateISO = fromUTC.setZone(zone).toISODate();
  const toDateISO = toUTC.setZone(zone).minus({ days: 1 }).toISODate();

  const overrides = await db.many(
    `SELECT * FROM availability_overrides 
     WHERE user_id = $1 AND brand_id = $2 AND date BETWEEN $3 AND $4`,
    [hostUserId, brandId, fromDateISO, toDateISO]
  );

  const overridesByDate = new Map();
  for (const ov of overrides) {
    const entry = overridesByDate.get(ov.date) || { extra: [], blackout: [], closed: false };
    if (ov.kind === 'extra') {
      entry.extra = entry.extra.concat(Array.isArray(ov.blocks) ? ov.blocks : []);
    } else {
      if (ov.closed) entry.closed = true;
      entry.blackout = entry.blackout.concat(Array.isArray(ov.blocks) ? ov.blocks : []);
    }
    overridesByDate.set(ov.date, entry);
  }

  const confirmedBookings = await db.many(
    `SELECT * FROM bookings 
     WHERE status = 'ACCEPTED' AND brand_id = $1 AND host_user_id = $2 
     AND start_at < $3 AND end_at > $4`,
    [brandId, hostUserId, toUTC.toJSDate(), fromUTC.toJSDate()]
  );

  const bookingBlocked = confirmedBookings.map((b) => {
    const bStartUTC = DateTime.fromJSDate(b.start_at, { zone: 'utc' });
    const bEndUTC = DateTime.fromJSDate(b.end_at, { zone: 'utc' });
    return {
      startUTC: bufferMinutes ? bStartUTC.minus({ minutes: bufferMinutes }) : bStartUTC,
      endUTC: bufferMinutes ? bEndUTC.plus({ minutes: bufferMinutes }) : bEndUTC
    };
  });

  const out = [];
  const weekly = JSON.parse(rule.weekly || '{}');

  for (let day = fromUTC.setZone(zone).startOf('day'); day < toUTC.setZone(zone); day = day.plus({ days: 1 })) {
    const dateISO = day.toISODate();
    const ov = overridesByDate.get(dateISO);

    if (ov?.closed) continue;

    const baseBlocks = Array.isArray(weekly[weekdayKey(day)]) ? weekly[weekdayKey(day)] : [];
    const blocks = baseBlocks.concat(ov?.extra || []);

    if (!Array.isArray(blocks) || blocks.length === 0) continue;

    let availBlocks = blocks
      .map((block) => ({
        start: timeOnDate(dateISO, block.start, zone),
        end: timeOnDate(dateISO, block.end, zone)
      }))
      .filter((block) => block.start.isValid && block.end.isValid && block.end > block.start);

    const blackouts = Array.isArray(ov?.blackout) ? ov.blackout : [];
    for (const blk of blackouts) {
      const bStart = timeOnDate(dateISO, blk.start, zone);
      const bEnd = timeOnDate(dateISO, blk.end, zone);
      if (!bStart.isValid || !bEnd.isValid || bEnd <= bStart) continue;
      availBlocks = subtractRange(availBlocks, bStart, bEnd);
    }

    for (const block of availBlocks) {
      const shrunk = shrinkByBuffer(block.start, block.end, bufferMinutes);
      const startDT = shrunk.startDT;
      const endDT = shrunk.endDT;
      if (endDT <= startDT) continue;

      for (let s = startDT; s.plus({ minutes: slotMinutes }) <= endDT; s = s.plus({ minutes: slotMinutes })) {
        const e = s.plus({ minutes: slotMinutes });
        const sUTC = s.toUTC();
        const eUTC = e.toUTC();

        let blocked = false;
        for (const b of bookingBlocked) {
          if (overlaps(sUTC, eUTC, b.startUTC, b.endUTC)) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        out.push({ start: sUTC.toISO(), end: eUTC.toISO() });
      }
    }
  }

  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  return {
    slots: out,
    meta: {
      timeZone: zone,
      slotMinutes,
      bufferMinutes,
      allowedDurations: fallbackDurations
    }
  };
}

async function assertNoOverlap(hostUserId, guestUserId, brandId, startUTC, endUTC, ignoreId) {
  const hostConflict = await db.one(
    `SELECT id FROM bookings 
     WHERE status = 'ACCEPTED' AND brand_id = $1 AND host_user_id = $2 
     AND start_at < $3 AND end_at > $4 ${ignoreId ? 'AND id != $5' : ''}
     LIMIT 1`,
    ignoreId ? [brandId, hostUserId, endUTC.toJSDate(), startUTC.toJSDate(), ignoreId] 
             : [brandId, hostUserId, endUTC.toJSDate(), startUTC.toJSDate()]
  );
  
  if (hostConflict) return { ok: false, reason: 'HOST_OVERLAP' };

  if (guestUserId) {
    const guestConflict = await db.one(
      `SELECT id FROM bookings 
       WHERE status = 'ACCEPTED' AND brand_id = $1 AND guest_user_id = $2 
       AND start_at < $3 AND end_at > $4 ${ignoreId ? 'AND id != $5' : ''}
       LIMIT 1`,
      ignoreId ? [brandId, guestUserId, endUTC.toJSDate(), startUTC.toJSDate(), ignoreId]
               : [brandId, guestUserId, endUTC.toJSDate(), startUTC.toJSDate()]
    );
    if (guestConflict) return { ok: false, reason: 'GUEST_OVERLAP' };
  }

  return { ok: true };
}

async function validateSlotForDuration(hostUserId, brandId, startUTC, durationMinutes) {
  const rule = await ensureDefaultAvailabilityRule(hostUserId, brandId);
  const zone = rule.time_zone || 'UTC';
  const hostDayStart = startUTC.setZone(zone).startOf('day');
  const dayStart = hostDayStart.toUTC();
  const dayEnd = hostDayStart.plus({ days: 1 }).toUTC();

  const built = await buildSlotsForRange(hostUserId, brandId, dayStart, dayEnd);
  const slotMinutes = built.meta.slotMinutes || 5;
  const slotsSet = new Set(built.slots.map((s) => s.start));

  const steps = Math.ceil(durationMinutes / slotMinutes);
  for (let i = 0; i < steps; i += 1) {
    const nextStart = startUTC.plus({ minutes: i * slotMinutes }).toISO();
    if (!slotsSet.has(nextStart)) return { ok: false };
  }

  return { ok: true, slotMinutes };
}

// Routes

// Get booking meta for a user handle
router.get('/:handle/meta', async (req, res) => {
  try {
    const brandId = req.brandId;
    if (!brandId) return res.status(400).json({ success: false, error: 'BRAND_REQUIRED' });

    const handle = String(req.params.handle || '').toLowerCase().trim();
    if (!handle) return res.status(400).json({ success: false, error: 'HANDLE_REQUIRED' });

    const host = await findUserByHandle(handle, brandId);
    if (!host) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });

    const rule = await ensureDefaultAvailabilityRule(host.id, brandId);
    const bookingTypes = await ensureDefaultBookingTypes(host.id, brandId);

    return res.json({
      success: true,
      bookingEnabled: !!host.booking_enabled,
      bookingVisibility: host.booking_visibility || 'public',
      hostTimeZone: rule.time_zone || 'UTC',
      allowedDurations: normalizeDurations(JSON.parse(rule.allowed_durations || '[]')),
      bookingTypes: bookingTypes.filter((t) => t.active !== false)
    });
  } catch (err) {
    console.error('booking meta error:', err);
    return res.status(500).json({ success: false, error: 'BOOKING_META_FAILED', details: err.message });
  }
});

// Get availability for a user handle
router.get('/:handle/availability', async (req, res) => {
  try {
    const brandId = req.brandId;
    if (!brandId) return res.status(400).json({ success: false, error: 'BRAND_REQUIRED' });

    const handle = String(req.params.handle || '').toLowerCase().trim();
    if (!handle) return res.status(400).json({ success: false, error: 'HANDLE_REQUIRED' });

    const host = await findUserByHandle(handle, brandId);
    if (!host) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });

    const viewer = await getOptionalUser(req);
    const view = parseView(req.query.view);
    const viewerZone = String(req.query.tz || viewer?.selected_time_zone || 'UTC');
    const start = req.query.start ? String(req.query.start) : null;

    const { from, to } = computeRange({ viewKind: view.kind, zone: viewerZone, startISODate: start });
    const fromUTC = from.toUTC();
    const toUTC = to.toUTC();

    const built = await buildSlotsForRange(host.id, brandId, fromUTC, toUTC);
    const bookingTypes = await ensureDefaultBookingTypes(host.id, brandId);

    return res.json({
      success: true,
      range: {
        from: fromUTC.toISO(),
        to: toUTC.toISO(),
        view: view.kind,
        start: from.setZone(viewerZone).toISODate()
      },
      slots: built.slots,
      meta: {
        hostTimeZone: built.meta.timeZone,
        viewerTimeZone: viewerZone,
        slotMinutes: built.meta.slotMinutes,
        allowedDurations: built.meta.allowedDurations,
        bookingTypes: bookingTypes.filter((t) => t.active !== false)
      }
    });
  } catch (err) {
    console.error('booking availability error:', err);
    return res.status(500).json({ success: false, error: 'AVAILABILITY_FAILED', details: err.message });
  }
});

// Get my booking settings
router.get('/me/settings', verifyToken, async (req, res) => {
  try {
    const brandId = req.brandId;
    const userId = req.user.id;

    const rule = await ensureDefaultAvailabilityRule(userId, brandId);
    const bookingTypes = await ensureDefaultBookingTypes(userId, brandId);

    const overrides = await db.many(
      'SELECT * FROM availability_overrides WHERE user_id = $1 AND brand_id = $2',
      [userId, brandId]
    );

    const blackouts = overrides.filter((o) => o.kind !== 'extra');
    const extras = overrides.filter((o) => o.kind === 'extra');

    return res.json({
      success: true,
      bookingEnabled: !!req.user?.booking_enabled,
      bookingVisibility: req.user?.booking_visibility || 'public',
      timeZone: rule.time_zone || 'UTC',
      weekly: JSON.parse(rule.weekly || '{}'),
      allowedDurations: normalizeDurations(JSON.parse(rule.allowed_durations || '[]')),
      blackouts,
      extras,
      bookingTypes: bookingTypes.filter((t) => t.active !== false)
    });
  } catch (err) {
    console.error('booking settings error:', err);
    return res.status(500).json({ success: false, error: 'BOOKING_SETTINGS_FAILED', details: err.message });
  }
});

// Setup booking
router.post('/me/setup', verifyToken, async (req, res) => {
  try {
    const brandId = req.brandId;
    const userId = req.user.id;

    const { timeZone, weekly, allowedDurations, blackouts, extras, bookingVisibility } = req.body || {};

    const rule = await ensureDefaultAvailabilityRule(userId, brandId);

    if (timeZone) {
      rule.time_zone = String(timeZone);
    }

    if (weekly && typeof weekly === 'object') {
      rule.weekly = JSON.stringify(weekly);
    }

    const durations = normalizeDurations(allowedDurations);
    if (durations.length) {
      rule.allowed_durations = JSON.stringify(durations);
      rule.slot_minutes = minDuration(durations);
    }

    rule.active = true;
    
    await db.query(
      `UPDATE availability_rules 
       SET time_zone = $1, weekly = $2, allowed_durations = $3, slot_minutes = $4, active = $5
       WHERE id = $6`,
      [rule.time_zone, rule.weekly, rule.allowed_durations, rule.slot_minutes, rule.active, rule.id]
    );

    await db.query('DELETE FROM availability_overrides WHERE user_id = $1 AND brand_id = $2', [userId, brandId]);

    const { v4: uuidv4 } = await import('uuid');
    const overrideDocs = [];
    const blackoutList = Array.isArray(blackouts) ? blackouts : [];
    const extraList = Array.isArray(extras) ? extras : [];

    blackoutList.forEach((b) => {
      if (!b?.date) return;
      overrideDocs.push({
        id: uuidv4(),
        user_id: userId,
        brand_id: brandId,
        date: b.date,
        kind: 'blackout',
        closed: !!b.closed,
        blocks: JSON.stringify(Array.isArray(b.blocks) ? b.blocks : Array.isArray(b.ranges) ? b.ranges : [])
      });
    });

    extraList.forEach((e) => {
      if (!e?.date) return;
      overrideDocs.push({
        id: uuidv4(),
        user_id: userId,
        brand_id: brandId,
        date: e.date,
        kind: 'extra',
        closed: false,
        blocks: JSON.stringify(Array.isArray(e.blocks) ? e.blocks : Array.isArray(e.ranges) ? e.ranges : [])
      });
    });

    for (const doc of overrideDocs) {
      await db.query(
        `INSERT INTO availability_overrides (id, user_id, brand_id, date, kind, closed, blocks)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [doc.id, doc.user_id, doc.brand_id, doc.date, doc.kind, doc.closed, doc.blocks]
      );
    }

    const visibility = ['public', 'friends', 'invitations', 'invites_friends'].includes(String(bookingVisibility))
      ? String(bookingVisibility)
      : 'public';

    await db.query(
      'UPDATE users SET booking_enabled = true, booking_visibility = $1 WHERE id = $2 AND brand_id = $3',
      [visibility, userId, brandId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('booking setup error:', err);
    return res.status(500).json({ success: false, error: 'BOOKING_SETUP_FAILED', details: err.message });
  }
});

// Get my bookings
router.get('/me', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const brandId = req.brandId;

    const bookings = await db.many(
      `SELECT b.*, 
        host.first_name as host_first_name, host.last_name as host_last_name, host.email as host_email,
        guest.first_name as guest_first_name, guest.last_name as guest_last_name, guest.email as guest_email,
        bt.name as booking_type_name
       FROM bookings b
       LEFT JOIN users host ON host.id = b.host_user_id
       LEFT JOIN users guest ON guest.id = b.guest_user_id
       LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
       WHERE b.brand_id = $1 AND (b.host_user_id = $2 OR b.guest_user_id = $2)
       ORDER BY b.start_at ASC`,
      [brandId, userId]
    );

    const now = new Date();
    const upcoming = bookings.filter(
      (b) => b.start_at && b.start_at >= now && !['REJECTED', 'CANCELLED'].includes(b.status)
    );
    const pending = bookings.filter((b) => b.status === 'PENDING');
    const reschedule = bookings.filter((b) => b.status === 'RESCHEDULE_PROPOSED');

    return res.json({ success: true, upcoming, pending, reschedule });
  } catch (err) {
    console.error('booking list error:', err);
    return res.status(500).json({ success: false, error: 'BOOKING_LIST_FAILED', details: err.message });
  }
});

// Create booking request
router.post('/:handle/request', async (req, res) => {
  try {
    const brandId = req.brandId;

    const handle = String(req.params.handle || '').toLowerCase().trim();
    if (!handle) return res.status(400).json({ success: false, error: 'HANDLE_REQUIRED' });

    const host = await findUserByHandle(handle, brandId);
    if (!host) return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });

    const viewer = await getOptionalUser(req);

    const rule = await ensureDefaultAvailabilityRule(host.id, brandId);
    const allowedDurations = normalizeDurations(JSON.parse(rule.allowed_durations || '[]'));

    const durationMinutes = Number(req.body?.durationMinutes || 0);
    if (!allowedDurations.includes(durationMinutes)) {
      return res.status(400).json({ success: false, error: 'INVALID_DURATION' });
    }

    const bookingTypeId = String(req.body?.bookingTypeId || '').trim();
    const bookingType = await db.one(
      'SELECT * FROM booking_types WHERE id = $1 AND user_id = $2 AND brand_id = $3 AND active = true',
      [bookingTypeId, host.id, brandId]
    );
    
    if (!bookingType) {
      return res.status(400).json({ success: false, error: 'INVALID_BOOKING_TYPE' });
    }

    const startISO = String(req.body?.startISO || '').trim();
    const startUTC = DateTime.fromISO(startISO, { zone: 'utc' });
    if (!startUTC.isValid) {
      return res.status(400).json({ success: false, error: 'INVALID_TIME' });
    }
    const endUTC = startUTC.plus({ minutes: durationMinutes });

    const availabilityOk = await validateSlotForDuration(host.id, brandId, startUTC, durationMinutes);
    if (!availabilityOk.ok) {
      return res.status(409).json({ success: false, error: 'SLOT_UNAVAILABLE' });
    }

    const overlapCheck = await assertNoOverlap(
      host.id,
      viewer?.id,
      brandId,
      startUTC,
      endUTC,
      null
    );
    
    if (!overlapCheck.ok) {
      return res.status(409).json({ success: false, error: overlapCheck.reason });
    }

    const guestName = viewer?.first_name || String(req.body?.guestName || '').trim();
    const guestEmail = viewer?.email || String(req.body?.guestEmail || '').trim().toLowerCase();

    if (!guestName || !guestEmail) {
      return res.status(400).json({ success: false, error: 'GUEST_REQUIRED' });
    }

    const { v4: uuidv4 } = await import('uuid');
    const bookingId = uuidv4();

    await db.query(
      `INSERT INTO bookings (id, host_user_id, guest_user_id, guest_name, guest_email, 
        booking_type_id, start_at, end_at, status, duration_minutes, brand_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [bookingId, host.id, viewer?.id || null, guestName, guestEmail, bookingTypeId,
       startUTC.toJSDate(), endUTC.toJSDate(), 'PENDING', durationMinutes, brandId]
    );

    return res.json({ success: true, bookingId, status: 'PENDING' });
  } catch (err) {
    console.error('booking request error:', err);
    return res.status(500).json({ success: false, error: 'BOOKING_REQUEST_FAILED', details: err.message });
  }
});

// Accept booking
router.post('/:bookingId/accept', verifyToken, async (req, res) => {
  try {
    const brandId = req.brandId;
    const userId = req.user.id;

    const booking = await db.one(
      'SELECT * FROM bookings WHERE id = $1 AND brand_id = $2',
      [req.params.bookingId, brandId]
    );
    
    if (!booking) return res.status(404).json({ success: false, error: 'BOOKING_NOT_FOUND' });

    if (String(booking.host_user_id) !== String(userId)) {
      return res.status(403).json({ success: false, error: 'NOT_HOST' });
    }

    if (booking.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: 'INVALID_STATUS' });
    }

    const startUTC = DateTime.fromJSDate(booking.start_at, { zone: 'utc' });
    const endUTC = DateTime.fromJSDate(booking.end_at, { zone: 'utc' });

    const overlapCheck = await assertNoOverlap(
      booking.host_user_id,
      booking.guest_user_id,
      brandId,
      startUTC,
      endUTC,
      booking.id
    );
    
    if (!overlapCheck.ok) {
      return res.status(409).json({ success: false, error: overlapCheck.reason });
    }

    await db.query(
      "UPDATE bookings SET status = 'ACCEPTED', updated_at = NOW() WHERE id = $1",
      [booking.id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('booking accept error:', err);
    return res.status(500).json({ success: false, error: 'BOOKING_ACCEPT_FAILED', details: err.message });
  }
});

// Reject booking
router.post('/:bookingId/reject', verifyToken, async (req, res) => {
  try {
    const brandId = req.brandId;
    const userId = req.user.id;

    const booking = await db.one(
      'SELECT * FROM bookings WHERE id = $1 AND brand_id = $2',
      [req.params.bookingId, brandId]
    );
    
    if (!booking) return res.status(404).json({ success: false, error: 'BOOKING_NOT_FOUND' });

    if (String(booking.host_user_id) !== String(userId)) {
      return res.status(403).json({ success: false, error: 'NOT_HOST' });
    }

    await db.query(
      "UPDATE bookings SET status = 'REJECTED', updated_at = NOW() WHERE id = $1",
      [booking.id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('booking reject error:', err);
    return res.status(500).json({ success: false, error: 'BOOKING_REJECT_FAILED', details: err.message });
  }
});

// Cancel booking
router.post('/:bookingId/cancel', async (req, res) => {
  try {
    const brandId = req.brandId;

    const booking = await db.one(
      'SELECT * FROM bookings WHERE id = $1 AND brand_id = $2',
      [req.params.bookingId, brandId]
    );
    
    if (!booking) return res.status(404).json({ success: false, error: 'BOOKING_NOT_FOUND' });

    const viewer = await getOptionalUser(req);

    const isHost = viewer && String(booking.host_user_id) === String(viewer.id);
    const isGuest = viewer && booking.guest_user_id && String(booking.guest_user_id) === String(viewer.id);

    if (!isHost && !isGuest) {
      return res.status(403).json({ success: false, error: 'NOT_ALLOWED' });
    }

    await db.query(
      "UPDATE bookings SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1",
      [booking.id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('booking cancel error:', err);
    return res.status(500).json({ success: false, error: 'BOOKING_CANCEL_FAILED', details: err.message });
  }
});

export default router;
