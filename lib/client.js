'use client';
// Browser-side helpers: fetch wrapper, formatting, labels, small hooks.
import { useCallback, useEffect, useRef, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/help')) {
    window.location.href = '/login';
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.code = data?.code;
    throw err;
  }
  return data;
}

/**
 * const { data, error, loading, reload } = useApi('/api/x')
 * Data is tagged with the path it was fetched for, so switching filters never shows the
 * previous filter's rows, and late responses are ignored. refreshMs > 0 polls (live boards).
 */
export function useApi(path, { refreshMs = 0 } = {}) {
  const [state, setState] = useState({ path: null, data: null, error: null, loading: true });
  const current = useRef(path);
  current.current = path;
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api(path);
      if (current.current === path) setState({ path, data, error: null, loading: false });
    } catch (e) {
      if (current.current === path) setState({ path, data: null, error: e.message, loading: false });
    }
  }, [path]);
  useEffect(() => {
    load();
    if (!refreshMs) return undefined;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  const fresh = state.path === path;
  return {
    data: fresh ? state.data : null,
    error: fresh ? state.error : null,
    loading: !fresh || state.loading,
    reload: load,
  };
}

export const fmtDateTime = (v) =>
  v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
export const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-');
export const fmtDay = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '-');
export const fmtNum = (v, digits = 0) =>
  v === null || v === undefined ? '-' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: digits });

export function ago(v) {
  if (!v) return '-';
  const min = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min ago`;
  return `${Math.floor(h / 24)} d ${h % 24} h ago`;
}

export const NEEDS = [
  ['rescue', 'Rescue / evacuation'],
  ['medical', 'Medical help'],
  ['food', 'Food'],
  ['water', 'Drinking water'],
  ['shelter', 'Shelter'],
];
export const NEED_ICON = { rescue: '🛟', medical: '🩺', food: '🍚', water: '💧', shelter: '⛺' };
export const TEAM_ICON = { boat: '🚤', search_rescue: '🧗', medical: '🚑', supply: '🚚' };

const SOS_BADGE = {
  new: 'red',
  triaged: 'amber',
  assigned: 'blue',
  in_progress: 'blue',
  resolved: 'green',
  duplicate: 'grey',
  cancelled: 'grey',
};
export const sosBadge = (s) => SOS_BADGE[s] || 'grey';
export const label = (s) => (s ? String(s).replace(/_/g, ' ') : '');

export function priorityBadge(p) {
  return p >= 60 ? 'red' : p >= 35 ? 'amber' : 'green';
}
export function teamBadge(s) {
  return s === 'available' ? 'green' : s === 'off_duty' ? 'grey' : s === 'on_scene' ? 'red' : 'blue';
}
export function severityBadge(s) {
  return s === 'critical' ? 'red' : s === 'warning' ? 'amber' : 'blue';
}
export function daysBadge(d) {
  if (d === null || d === undefined) return 'grey';
  return d < 1 ? 'red' : d < 2 ? 'amber' : 'green';
}

/** for HTML strings put into map popups */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
