import { assertCampAccess, CONTROL_ROLES, handler, readJson, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { embedOne, personText, toPgVector } from '@/lib/embeddings';
import { logActivity } from '@/lib/mongo';
import { id, num, oneOf, phone, str } from '@/lib/validate';

// POST /api/camps/:id/residents - register an evacuee and check them in (one transaction in
// fn_register_evacuee). The capacity trigger refuses if the camp is full and names the nearest
// camp with space; open missing-person reports are checked and alerts raised for likely matches.
export const POST = handler(async (request, { params }) => {
  const s = await requireUser(request, [...CONTROL_ROLES, 'camp_manager']);
  const campId = id((await params).id);
  assertCampAccess(s, campId);
  const b = await readJson(request);
  const p = {
    full_name: str(b.fullName, 'Name', { min: 2, max: 100 }),
    age: num(b.age, 'Age', { min: 0, max: 120, integer: true, optional: true }),
    gender: oneOf(b.gender || 'unknown', 'Gender', ['male', 'female', 'other', 'unknown']),
    phone: phone(b.phone, 'Phone', { optional: true }),
    home_village: str(b.village, 'Village', { max: 80, optional: true }),
    marks: str(b.marks, 'Identifying details', { max: 300, optional: true }),
  };
  const medical = !!b.needsMedical;
  const vec = await embedOne(personText(p));
  const r = await one(
    'SELECT * FROM fn_register_evacuee($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9::vector, $10)',
    [campId, p.full_name, p.age, p.gender, p.phone, p.home_village, p.marks, medical, toPgVector(vec), s.uid]
  );
  logActivity({ userId: s.uid, role: s.role, action: 'camp.checkin', entity: 'person', entityId: r.person_id, meta: { campId } });
  return r;
});
