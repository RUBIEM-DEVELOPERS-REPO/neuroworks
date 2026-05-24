---
name: travel-itinerary
description: Build a complete travel itinerary from booking confirmations — times, addresses, transfers, reminders, and contingencies.
applies_to: [draft-other, plan, summarize]
---

# Skill: Travel itinerary

## Goal

The traveler opens ONE doc on the road and knows: where they need to be, when, how they're getting there, and what they need with them.

## Process

1. **Extract every booking** — flights, hotels, ground transport, restaurant reservations, meeting locations, conference sessions. Put them in chronological order.
2. **Compute transfer windows.** Between each segment, calculate (and surface) the buffer — "1h 35min between BA flight arrival and hotel check-in including immigration estimate".
3. **Geocode addresses.** Every venue gets a full address, ideally with the area / district so the traveler can sanity-check distances.
4. **Pull confirmation numbers** for every booking. Tag prominently — these are what you need at the front desk.
5. **Add contingency notes** — what if the flight is late, what if the hotel doesn't have the reservation, who to call.
6. **Flag time-zone changes** — every segment shows local time AND traveler's home-time delta the first time the TZ changes.

## Output shape

```
# Trip: <Origin → Destination> · <Start date> – <End date>

**Traveler:** <Name>
**Time zones:** <Home TZ> → <Dest TZ> (UTC offset change: ±N hours)
**Total duration:** <N days N nights>
**Currency on the ground:** <ISO code>

## Quick reference

- **Emergency contact (you):** <phone>
- **Emergency contact (booking agent):** <phone>
- **Travel insurance policy:** <number, contact>
- **Embassy / consulate:** <number, address>

## Day-by-day

### Day 1 — <Date> (<weekday>)

#### 06:30 local · Depart home
- **Get to:** <Airport name + terminal>
- **Mode:** <Uber / Lyft / train>
- **Buffer to flight:** 2h 30min

#### 09:45 → 17:20 local · Flight <Airline + flight number>
- **From:** <Origin airport (IATA)> · **To:** <Dest airport (IATA)>
- **Class:** <Economy / Business> · **Seat:** <if assigned>
- **Booking ref / PNR:** <XYZ123>
- **Check-in:** Online opens 24h before; counter closes 60 min before departure.

#### 18:00 local · Hotel check-in
- **<Hotel name>** — <full address, district>
- **Confirmation #:** <XYZ>
- **Check-in cutoff:** <time>
- **Loyalty number:** <if applicable>
- **Notes:** <breakfast included? Wi-Fi password? early-check-in fee?>

#### 19:30 local · Dinner reservation
- **<Restaurant>** — <address>
- **Party of:** <N>
- **Held under:** <name>

### Day 2 — <Date> (<weekday>)
<...>

## Reminders

- [ ] Passport (check expiry ≥6 months past return date)
- [ ] Visa if required for <destination>
- [ ] Power adapter for <destination plug type>
- [ ] Mobile roaming activated / local SIM plan
- [ ] Cards notified of travel dates
- [ ] Out-of-office set on email + Slack
- [ ] Briefing docs for <main meeting / event>

## Contingencies

- **If flight is late:** <Who at destination needs to know — name + phone>
- **If hotel reservation issue:** <Backup hotel within 1km — name + phone>
- **If you lose your passport:** <Embassy phone + address>
- **If a meeting needs to reschedule:** <Calendar holder + how to reach them>
```

## Rules

- **Local time first.** Traveler is at the destination — local time wins, home-time is the cross-reference.
- **Buffer windows are explicit.** "1h between landing and meeting" only helps if the reader sees the calculation.
- **Confirmation numbers are surfaced, not buried** — every booking has one, prominently displayed.
- **Reminders are a checklist** — passive prose ("don't forget your passport") doesn't get used.
- **One contingency per likely failure mode.** Don't enumerate every disaster scenario.

## Pitfalls

- Burying transfers as small text — a missed connection is the #1 trip-killer.
- Vague venue addresses ("Hotel name, city") — no postal code = unusable in a taxi at 1am.
- Forgetting to surface time-zone deltas — schedules drift.
- Padding the contingency section with low-probability scenarios that distract from the real risks.
- Missing the loyalty / status numbers — upgrades depend on them.
