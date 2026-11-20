// Creating an SOS is shared by the public page and the control room (helpline calls).
import { HttpError } from './api.js';
import { one } from './db.js';
import { embedOne, sosText, toPgVector } from './embeddings.js';
import { id, num, oneOf, phone, str } from './validate.js';

const NEED_VALUES = ['rescue', 'medical', 'food', 'water', 'shelter'];

export function parseSos(b) {
  const needs = Array.isArray(b.needs) ? [...new Set(b.needs)] : [];
  if (!needs.length) throw new HttpError(400, 'Choose at least one kind of help needed.');
  needs.forEach((n) => oneOf(n, 'Need', NEED_VALUES));
  return {
    incidentId: id(b.incidentId, 'Incident'),
    name: str(b.name, 'Your name', { min: 2, max: 80 }),
    phone: phone(b.phone),
    lat: num(b.lat, 'Latitude', { min: 6, max: 37.5 }),
    lng: num(b.lng, 'Longitude', { min: 68, max: 97.5 }),
    landmark: str(b.landmark, 'Landmark', { max: 160, optional: true }),
    description: str(b.description, 'Description', { min: 5, max: 1000 }),
    people: num(b.people, 'Number of people', { min: 1, max: 500, integer: true }),
    children: num(b.children ?? 0, 'Children', { min: 0, max: 500, integer: true }),
    elderly: num(b.elderly ?? 0, 'Elderly', { min: 0, max: 500, integer: true }),
    injured: num(b.injured ?? 0, 'Injured', { min: 0, max: 500, integer: true }),
    needs,
  };
}

/** Embeds the description (multilingual), then fn_create_sos inserts it and checks for duplicates. */
export async function createSos(s, { channel, userId = null }) {
  const vec = await embedOne(sosText({ description: s.description, landmark: s.landmark }));
  return one(
    `SELECT * FROM fn_create_sos($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::need_type[], $13, $14::vector, $15)`,
    [s.incidentId, s.name, s.phone, s.lat, s.lng, s.landmark, s.description, s.people, s.children, s.elderly, s.injured,
     s.needs, channel, toPgVector(vec), userId]
  );
}
