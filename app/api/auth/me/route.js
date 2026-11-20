import { handler, requireUser } from '@/lib/api';

export const GET = handler(async (request) => {
  const s = await requireUser(request);
  return { user: { id: s.uid, name: s.name, role: s.role, teamId: s.teamId, campId: s.campId, unit: s.unit } };
});
