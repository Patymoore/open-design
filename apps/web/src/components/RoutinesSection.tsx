import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CreateRoutineRequest,
  Routine,
  RoutineProjectTarget,
  RoutineRun,
  RoutineSchedule,
  Weekday,
  Workspace,
  WorkspaceMembership,
} from '@open-design/contracts';

import { Icon } from './Icon';
import { navigate } from '../router';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';

// Shared translator signature: every sub-component in this file is module-scoped,
// so `t` from `useT()` is threaded down as a prop rather than re-hooked.
type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

type ProjectSummary = { id: string; name: string };

type RoutinesSectionProps = {
  onClose?: () => void;
  currentWorkspaceId?: string;
  currentWorkspaceName?: string;
  currentWorkspaceRole?: Workspace['currentUserRole'];
};

type ScheduleKind = RoutineSchedule['kind'];

const SCHEDULE_KINDS: ScheduleKind[] = ['hourly', 'daily', 'weekdays', 'weekly'];

// IANA `Date.getDay()` order: 0 = Sunday … 6 = Saturday. Display labels come
// from the `routines.weekday.*` i18n keys, keyed by this same index.
const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

// Fallback list used only when the runtime doesn't expose
// `Intl.supportedValuesOf('timeZone')`. The backend validator accepts any
// IANA zone, so the picker should match — see `listSupportedTimezones`.
const FALLBACK_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
];

function detectLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Returns every IANA zone the platform recognizes, so the picker stays in
// sync with the backend validator (which accepts any IANA timezone). Falls
// back to a curated subset on older runtimes that lack `supportedValuesOf`.
// `UTC` is always prepended because `Intl.supportedValuesOf('timeZone')`
// returns only canonical region names on current runtimes (e.g. Node 24)
// and would otherwise drop the most common non-local zone — which the
// backend validator and contract examples still accept.
function listSupportedTimezones(): string[] {
  try {
    const fn = (Intl as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf;
    if (typeof fn === 'function') {
      const list = fn('timeZone');
      if (Array.isArray(list) && list.length > 0) {
        return list.includes('UTC') ? list : ['UTC', ...list];
      }
    }
  } catch {
    // fall through
  }
  return FALLBACK_TIMEZONES;
}

// "GMT+8", "GMT-5:30", "GMT" — short label that mirrors the screenshot's
// "Shanghai (GMT+8)" pattern for legibility.
function gmtLabel(timezone: string, at = new Date()): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const part = dtf.formatToParts(at).find((p) => p.type === 'timeZoneName');
    return part?.value ?? 'GMT';
  } catch {
    return 'GMT';
  }
}

function tzCityLabel(timezone: string): string {
  if (timezone === 'UTC') return 'UTC';
  const last = timezone.split('/').pop() ?? timezone;
  return last.replace(/_/g, ' ');
}

function tzOptionLabel(timezone: string): string {
  // The GMT offset is intentionally omitted: it would drift seasonally for
  // DST-observing zones (e.g. `America/New_York` is GMT-5 in winter and
  // GMT-4 in summer) and a picker label that depends on `new Date()` is
  // misleading. The IANA city stays stable year-round.
  return tzCityLabel(timezone);
}

function formatTime12h(time: string, t: TranslateFn): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const mm = m[2];
  const suffix = h >= 12 ? t('routines.timePm') : t('routines.timeAm');
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${mm} ${suffix}`;
}

function describeSchedule(
  schedule: RoutineSchedule,
  t: TranslateFn,
  nextRunAt?: number | null,
): string {
  if (schedule.kind === 'hourly') {
    const mm = String(schedule.minute).padStart(2, '0');
    return t('routines.describe.hourly', { minute: mm });
  }
  // Anchor the GMT offset to the next actual fire time so DST-observing
  // zones don't drift seasonally — a New York routine created in winter
  // would otherwise still render `GMT-5` after DST starts. When we don't
  // know the next fire (e.g. the live preview while the form is open),
  // fall back to the IANA city, which is stable year-round.
  const tz = nextRunAt
    ? gmtLabel(schedule.timezone, new Date(nextRunAt))
    : tzCityLabel(schedule.timezone);
  if (schedule.kind === 'daily') {
    return t('routines.describe.daily', {
      time: formatTime12h(schedule.time, t),
      tz,
    });
  }
  if (schedule.kind === 'weekdays') {
    return t('routines.describe.weekdays', {
      time: formatTime12h(schedule.time, t),
      tz,
    });
  }
  const day = t(`routines.weekday.long.${schedule.weekday}`);
  return t('routines.describe.weekly', {
    day,
    time: formatTime12h(schedule.time, t),
    tz,
  });
}

function formatRelative(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatRunTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function runFailureReason(run: {
  status: RoutineRun['status'];
  error?: string | null;
  summary?: string | null;
} | null | undefined): string | null {
  if (!run || run.status !== 'failed') return null;
  const reason = (run.error || run.summary || '').trim();
  return reason || null;
}

type FormState = {
  name: string;
  prompt: string;
  kind: ScheduleKind;
  minute: number; // hourly
  time: string; // daily/weekdays/weekly (HH:MM)
  weekday: Weekday; // weekly
  timezone: string;
  mode: 'create_each_run' | 'reuse';
  projectId: string;
};

function emptyForm(): FormState {
  return {
    name: '',
    prompt: '',
    kind: 'daily',
    minute: 0,
    time: '09:00',
    weekday: 1,
    timezone: detectLocalTimezone(),
    mode: 'create_each_run',
    projectId: '',
  };
}

function formFromRoutine(routine: Routine): FormState {
  const base = emptyForm();
  const schedule = routine.schedule;
  if (schedule.kind === 'hourly') {
    base.kind = 'hourly';
    base.minute = schedule.minute;
  } else if (schedule.kind === 'weekly') {
    base.kind = 'weekly';
    base.weekday = schedule.weekday;
    base.time = schedule.time;
    base.timezone = schedule.timezone;
  } else {
    base.kind = schedule.kind;
    base.time = schedule.time;
    base.timezone = schedule.timezone;
  }
  if (routine.target.mode === 'reuse') {
    base.mode = 'reuse';
    base.projectId = routine.target.projectId;
  } else {
    base.mode = 'create_each_run';
    base.projectId = '';
  }
  base.name = routine.name;
  base.prompt = routine.prompt;
  return base;
}

function buildSchedule(form: FormState): RoutineSchedule {
  if (form.kind === 'hourly') {
    return { kind: 'hourly', minute: form.minute };
  }
  if (form.kind === 'weekly') {
    return {
      kind: 'weekly',
      weekday: form.weekday,
      time: form.time,
      timezone: form.timezone,
    };
  }
  return {
    kind: form.kind,
    time: form.time,
    timezone: form.timezone,
  };
}

function StatusPill({
  status,
  t,
}: {
  status: RoutineRun['status'];
  t: TranslateFn;
}) {
  return (
    <span className={`routines-status routines-status-${status}`}>
      {t(`routines.status.${status}`)}
    </span>
  );
}

function ScheduleEditor({
  form,
  setForm,
  timezones,
  t,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  timezones: string[];
  t: TranslateFn;
}) {
  return (
    <div className="routines-schedule-editor">
      <div className="routines-field-label">{t('routines.fieldSchedule')}</div>
      <div className="subtab-pill routines-kind-pills" role="tablist">
        {SCHEDULE_KINDS.map((kind) => (
          <button
            type="button"
            key={kind}
            role="tab"
            aria-selected={form.kind === kind}
            className={form.kind === kind ? 'active' : ''}
            onClick={() => setForm({ ...form, kind })}
          >
            {t(`routines.kind.${kind}`)}
          </button>
        ))}
      </div>

      {form.kind === 'hourly' ? (
        <div className="routines-fieldrow">
          <label className="routines-field">
            <span>{t('routines.fieldMinute')}</span>
            <input
              type="number"
              min={0}
              max={59}
              step={1}
              value={form.minute}
              onChange={(e) =>
                setForm({
                  ...form,
                  minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)),
                })
              }
            />
          </label>
        </div>
      ) : null}

      {form.kind === 'weekly' ? (
        <div className="routines-weekday-row">
          {WEEKDAYS.map((value) => (
            <button
              type="button"
              key={value}
              className={`routines-weekday${form.weekday === value ? ' active' : ''}`}
              onClick={() => setForm({ ...form, weekday: value })}
              aria-pressed={form.weekday === value}
            >
              {t(`routines.weekday.short.${value}`)}
            </button>
          ))}
        </div>
      ) : null}

      {form.kind !== 'hourly' ? (
        <div className="routines-fieldrow routines-fieldrow-2col">
          <label className="routines-field">
            <span>{t('routines.fieldTime')}</span>
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
          </label>
          <label className="routines-field">
            <span>{t('routines.fieldTimezone')}</span>
            <select
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tzOptionLabel(tz)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <p className="routines-schedule-hint">
        {describeSchedule(buildSchedule(form), t)}
      </p>
    </div>
  );
}

function RunHistory({
  routineId,
  refreshKey,
  onClose,
  t,
}: {
  routineId: string;
  refreshKey: number;
  onClose?: () => void;
  t: TranslateFn;
}) {
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/routines/${routineId}/runs?limit=10`);
        if (!res.ok) throw new Error(`runs: ${res.status}`);
        const json = await res.json();
        if (!cancelled) setRuns(json.runs ?? []);
      } catch {
        if (!cancelled) setRuns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routineId, refreshKey]);

  if (runs === null)
    return (
      <div className="routines-history-empty">
        {t('routines.runHistoryLoading')}
      </div>
    );
  if (runs.length === 0)
    return (
      <div className="routines-history-empty">{t('routines.runHistoryEmpty')}</div>
    );

  return (
    <ul className="routines-history">
      {runs.map((r) => {
        const failureReason = runFailureReason(r);
        return (
          <li key={r.id} className="routines-history-row">
            <StatusPill status={r.status} t={t} />
            <span className="routines-history-time">{formatRunTimestamp(r.startedAt)}</span>
            <span className="routines-history-trigger">
              {r.trigger === 'manual'
                ? t('routines.triggerManual')
                : t('routines.triggerScheduled')}
            </span>
            <button
              type="button"
              className="routines-history-link"
              onClick={() => {
                // Issue #1505: deep-link to this run's specific
                // conversation, not just the project root. Without the
                // conversation id, parallel runs that share a project
                // (reuse mode) all resolve to the same default
                // conversation in the project view, which made earlier
                // runs look "absorbed" by the latest one.
                navigate({
                  kind: 'project',
                  projectId: r.projectId,
                  conversationId: r.conversationId ?? null,
                  fileName: null,
                });
                onClose?.();
              }}
              title={t('routines.openProjectTitle')}
            >
              {t('routines.openProject')}
              <Icon name="chevron-right" size={12} />
            </button>
            {failureReason ? (
              <div className="routines-history-error">{failureReason}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function RoutinesSection({
  onClose,
  currentWorkspaceId,
  currentWorkspaceName = 'Personal Workspace',
  currentWorkspaceRole,
}: RoutinesSectionProps) {
  const t = useT();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [members, setMembers] = useState<WorkspaceMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ownerTargets, setOwnerTargets] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const refreshSerialRef = useRef(0);
  const currentWorkspaceIdRef = useRef(currentWorkspaceId);
  currentWorkspaceIdRef.current = currentWorkspaceId;
  const canManageRoutines = currentWorkspaceId
    ? currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin'
    : currentWorkspaceRole == null || currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin';

  const timezones = useMemo(() => {
    const local = detectLocalTimezone();
    // Pin the user's local zone first, then expose every IANA zone the
    // backend would accept so the picker matches the validator.
    const set = new Set<string>([local, ...listSupportedTimezones()]);
    return Array.from(set);
  }, []);

  const refresh = async (options: { clear?: boolean } = {}) => {
    const refreshSerial = refreshSerialRef.current + 1;
    refreshSerialRef.current = refreshSerial;
    setError(null);
    if (options.clear) {
      setLoading(true);
      setRoutines([]);
      setProjects([]);
      setMembers([]);
    }
    try {
      const workspaceQuery = currentWorkspaceId
        ? `?workspaceId=${encodeURIComponent(currentWorkspaceId)}`
        : '';
      const [rRes, pRes, mRes] = await Promise.all([
        fetch(`/api/routines${workspaceQuery}`),
        fetch(`/api/projects${workspaceQuery}`),
        currentWorkspaceId
          ? fetch(`/api/workspaces/${encodeURIComponent(currentWorkspaceId)}/members`)
          : Promise.resolve(null),
      ]);
      if (refreshSerial !== refreshSerialRef.current) return;
      if (!rRes.ok) throw new Error(`routines: ${rRes.status}`);
      const rJson = await rRes.json();
      if (refreshSerial !== refreshSerialRef.current) return;
      setRoutines(rJson.routines ?? []);
      if (pRes.ok) {
        const pJson = await pRes.json();
        if (refreshSerial !== refreshSerialRef.current) return;
        setProjects(
          (pJson.projects ?? []).map((p: ProjectSummary) => ({
            id: p.id,
            name: p.name,
          })),
        );
      }
      if (mRes?.ok) {
        const mJson = await mRes.json();
        if (refreshSerial !== refreshSerialRef.current) return;
        setMembers(mJson.members ?? []);
      } else {
        setMembers([]);
      }
      setError(null);
    } catch (err) {
      if (refreshSerial !== refreshSerialRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (refreshSerial === refreshSerialRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    setShowForm(false);
    setForm(emptyForm());
    setEditingId(null);
    setSubmitting(false);
    setOwnerTargets({});
    setExpandedId(null);
    setBusyId(null);
    setError(null);
  }, [currentWorkspaceId]);

  useEffect(() => {
    void refresh({ clear: true });
  }, [currentWorkspaceId]);

  const projectsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const workspaceId = currentWorkspaceId;
    setSubmitting(true);
    setError(null);
    try {
      if (form.mode === 'reuse' && !form.projectId) {
        throw new Error(t('routines.errorPickProject'));
      }
      const target: RoutineProjectTarget =
        form.mode === 'reuse' && form.projectId
          ? { mode: 'reuse', projectId: form.projectId }
          : { mode: 'create_each_run' };
      const body: CreateRoutineRequest = {
        ...(workspaceId ? { workspaceId } : {}),
        name: form.name.trim(),
        prompt: form.prompt,
        schedule: buildSchedule(form),
        target,
        enabled: true,
      };
      const isEdit = editingId !== null;
      const url = isEdit ? `/api/routines/${editingId}` : '/api/routines';
      const payload = isEdit
        ? { workspaceId: body.workspaceId, name: body.name, prompt: body.prompt, schedule: body.schedule, target: body.target }
        : body;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `${isEdit ? 'update' : 'create'} failed: ${res.status}`);
      }
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      void refresh();
    } catch (err) {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setSubmitting(false);
      }
    }
  };

  const runNow = async (id: string) => {
    const workspaceId = currentWorkspaceId;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/routines/${id}/run`, { method: 'POST' });
      if (!res.ok && res.status !== 202) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `run failed: ${res.status}`);
      }
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      void refresh();
      setExpandedId(id);
      setHistoryTick((v) => v + 1);
    } catch (err) {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setBusyId((current) => (current === id ? null : current));
      }
    }
  };

  const toggleEnabled = async (routine: Routine) => {
    const workspaceId = currentWorkspaceId;
    setBusyId(routine.id);
    try {
      const res = await fetch(`/api/routines/${routine.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !routine.enabled }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `update failed: ${res.status}`);
      }
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      void refresh();
    } catch (err) {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setBusyId((current) => (current === routine.id ? null : current));
      }
    }
  };

  const transferOwner = async (routine: Routine) => {
    const workspaceId = currentWorkspaceId;
    const ownedByUserId = ownerTargets[routine.id] ?? routine.ownedByUserId ?? '';
    if (!ownedByUserId || ownedByUserId === routine.ownedByUserId) return;
    setBusyId(routine.id);
    try {
      const res = await fetch(`/api/routines/${routine.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ownedByUserId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `update failed: ${res.status}`);
      }
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      setOwnerTargets((current) => {
        const next = { ...current };
        delete next[routine.id];
        return next;
      });
      void refresh();
    } catch (err) {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setBusyId((current) => (current === routine.id ? null : current));
      }
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('routines.confirmDelete'))) return;
    const workspaceId = currentWorkspaceId;
    setBusyId(id);
    try {
      const res = await fetch(`/api/routines/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `delete failed: ${res.status}`);
      }
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      if (expandedId === id) setExpandedId(null);
      void refresh();
    } catch (err) {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setBusyId((current) => (current === id ? null : current));
      }
    }
  };

  return (
    <section className="settings-section routines-section">
      <div className="section-head">
        <div>
          <h3>{t('routines.title')}</h3>
          <p>Scheduled agent sessions for {currentWorkspaceName}.</p>
        </div>
        {!showForm ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canManageRoutines}
            onClick={() => {
              if (!canManageRoutines) return;
              setForm(emptyForm());
              setShowForm(true);
            }}
          >
            <Icon name="plus" size={14} />
            <span>{t('routines.newAutomation')}</span>
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="settings-notice error" role="alert">
          {error}
        </div>
      ) : null}
      {!canManageRoutines ? (
        <div className="settings-notice" role="status">
          Admin or owner access required to manage workspace routines.
        </div>
      ) : null}

      {showForm ? (
        <form onSubmit={submit} className="routines-card routines-form">
          <label className="routines-field">
            <span>{t('routines.fieldName')}</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('routines.fieldNamePlaceholder')}
              autoFocus
            />
          </label>
          <label className="routines-field">
            <span>{t('routines.fieldPrompt')}</span>
            <textarea
              required
              rows={4}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder={t('routines.fieldPromptPlaceholder')}
            />
          </label>

          <ScheduleEditor form={form} setForm={setForm} timezones={timezones} t={t} />

          <fieldset className="routines-fieldset">
            <legend>{t('routines.fieldsetProject')}</legend>

            <label className="routines-radio">
              <input
                type="radio"
                checked={form.mode === 'create_each_run'}
                onChange={() => setForm({ ...form, mode: 'create_each_run' })}
              />
              <span>
                <strong>{t('routines.modeCreate')}</strong>
                <small>{t('routines.modeCreateHint')}</small>
              </span>
            </label>

            <label className="routines-radio">
              <input
                type="radio"
                checked={form.mode === 'reuse'}
                onChange={() => setForm({ ...form, mode: 'reuse' })}
              />
              <span>
                <strong>{t('routines.modeReuse')}</strong>
                <small>{t('routines.modeReuseHint')}</small>
              </span>
            </label>

            {form.mode === 'reuse' && (
              <select
                className="routines-project-select"
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                required
              >
                <option value="">{t('routines.pickProject')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </fieldset>

          <div className="routines-form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setForm(emptyForm());
              }}
            >
              {t('routines.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {editingId
                ? submitting
                  ? t('routines.saving')
                  : t('routines.save')
                : submitting
                  ? t('routines.creating')
                  : t('routines.create')}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <div className="routines-empty">{t('routines.loading')}</div>
      ) : routines.length === 0 ? (
        <div className="routines-empty">
          <strong>{t('routines.empty')}</strong>
          <p>{t('routines.emptyHint')}</p>
        </div>
      ) : (
        <ul className="routines-list">
          {routines.map((r) => {
            const targetLabel =
              r.target.mode === 'reuse'
                ? t('routines.targetReuse', {
                    project:
                      projectsById.get(r.target.projectId) ?? r.target.projectId,
                  })
                : t('routines.targetCreate');
            const isBusy = busyId === r.id;
            const isExpanded = expandedId === r.id;
            const failureReason = runFailureReason(r.lastRun);
            const ownerTarget = ownerTargets[r.id] ?? r.ownedByUserId ?? '';
            return (
              <li key={r.id} className={`routines-card routines-item${r.enabled ? '' : ' is-disabled'}`}>
                <div className="routines-item-head">
                  <div className="routines-item-main">
                    <div className="routines-item-title">
                      <strong>{r.name}</strong>
                      {!r.enabled ? (
                        <span className="routines-tag">{t('routines.tagPaused')}</span>
                      ) : null}
                    </div>
                    <div className="routines-item-line">{describeSchedule(r.schedule, t, r.nextRunAt)}</div>
                    <div className="routines-item-meta">
                      <span>{targetLabel}</span>
                      {r.ownedByUserId ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>owned by {r.ownedByUserId}</span>
                        </>
                      ) : null}
                      {r.createdByUserId && r.createdByUserId !== r.ownedByUserId ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>created by {r.createdByUserId}</span>
                        </>
                      ) : null}
                      <span aria-hidden>·</span>
                      <span>{t('routines.metaNext', { when: formatRelative(r.nextRunAt) })}</span>
                      {r.lastRun ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>
                            {t('routines.metaLast')}{' '}
                            <StatusPill status={r.lastRun.status} t={t} />{' '}
                            {formatRelative(r.lastRun.startedAt)}
                          </span>
                        </>
                      ) : null}
                    </div>
                    {failureReason ? (
                      <div className="routines-item-error">{failureReason}</div>
                    ) : null}
                  </div>
                  <div className="routines-item-actions">
                    <select
                      aria-label={`Transfer owner for ${r.name}`}
                      value={ownerTarget}
                      disabled={!canManageRoutines || isBusy || members.length === 0}
                      onChange={(event) => setOwnerTargets((current) => ({
                        ...current,
                        [r.id]: event.target.value,
                      }))}
                    >
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          Owner: {member.userId === r.ownedByUserId ? `${member.userId} (current)` : member.userId}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => transferOwner(r)}
                      disabled={!canManageRoutines || isBusy || !ownerTarget || ownerTarget === r.ownedByUserId}
                    >
                      Transfer
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => runNow(r.id)}
                      disabled={!canManageRoutines || isBusy}
                    >
                      {t('routines.runNow')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (!canManageRoutines) return;
                        setForm(formFromRoutine(r));
                        setEditingId(r.id);
                        setShowForm(true);
                      }}
                      disabled={!canManageRoutines || isBusy}
                    >
                      {t('routines.edit')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => toggleEnabled(r)}
                      disabled={!canManageRoutines || isBusy}
                    >
                      {r.enabled ? t('routines.pause') : t('routines.resume')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? t('routines.hideHistory') : t('routines.history')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger"
                      onClick={() => remove(r.id)}
                      disabled={!canManageRoutines || isBusy}
                      title={t('routines.deleteTitle')}
                    >
                      {t('routines.delete')}
                    </button>
                  </div>
                </div>
                {isExpanded ? (
                  <div className="routines-item-history">
                    <RunHistory routineId={r.id} refreshKey={historyTick} onClose={onClose} t={t} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
