// Project-page design-system picker — small dropdown rendered in the
// project chrome header next to the title. Mirrors the homepage
// settings chip (`HomeHeroSettingsChips` > design system) but binds
// to an existing project: changing the selection PATCHes
// `project.designSystemId` so the next chat run carries the new
// design-system metadata into the agent's system prompt (the daemon
// already threads `designSystemId` from project state through
// `/api/runs` — see providers/daemon.ts).
//
// Kept intentionally narrower than the homepage version: there is no
// preview pane here because the project header has very little vertical
// room — surfacing the swatches + summary suffices to identify the
// system at a glance.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesignSystemSummary } from '@open-design/contracts';
import { Icon } from './Icon';

interface Props {
  designSystems: DesignSystemSummary[];
  selectedId: string | null;
  loading?: boolean;
  onChange: (id: string | null) => void;
}

export function ProjectDesignSystemPicker({
  designSystems,
  selectedId,
  loading,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => designSystems.find((d) => d.id === selectedId) ?? null,
    [designSystems, selectedId],
  );

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery('');
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return designSystems;
    return designSystems.filter((d) => {
      const haystack = `${d.title} ${d.category} ${d.summary}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [query, designSystems]);

  return (
    <div
      ref={wrapRef}
      className={`project-ds-picker${open ? ' open' : ''}`}
      data-testid="project-ds-picker"
    >
      <button
        type="button"
        className={`project-ds-picker-trigger${selected ? ' picked' : ''}`}
        data-testid="project-ds-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        title={selected?.title ?? '选择设计系统'}
      >
        {selected && selected.swatches && selected.swatches.length > 0 ? (
          <span className="project-ds-picker-swatches" aria-hidden>
            {selected.swatches.slice(0, 3).map((sw, i) => (
              <span
                key={`pdsp-sw-${i}`}
                className="project-ds-picker-swatch"
                style={{ background: sw }}
              />
            ))}
          </span>
        ) : (
          <Icon name="palette" size={13} />
        )}
        <span className="project-ds-picker-label">
          {loading
            ? '加载设计系统…'
            : selected?.title ?? '选择设计系统'}
        </span>
        <Icon name="chevron-down" size={11} />
      </button>
      {open ? (
        <div
          className="project-ds-picker-popover"
          data-testid="project-ds-picker-popover"
          role="listbox"
        >
          <div className="project-ds-picker-search">
            <Icon name="search" size={12} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索设计系统"
              data-testid="project-ds-picker-search"
            />
          </div>
          <div className="project-ds-picker-list">
            <button
              type="button"
              className={`project-ds-picker-option${selectedId == null ? ' active' : ''}`}
              role="option"
              aria-selected={selectedId == null}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <span className="project-ds-picker-option-title">不指定设计系统</span>
              <span className="project-ds-picker-option-summary">
                让模型自由发挥
              </span>
            </button>
            {filtered.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`project-ds-picker-option${d.id === selectedId ? ' active' : ''}`}
                role="option"
                aria-selected={d.id === selectedId}
                onClick={() => {
                  onChange(d.id);
                  setOpen(false);
                }}
                data-testid={`project-ds-picker-option-${d.id}`}
              >
                <div className="project-ds-picker-option-head">
                  <span className="project-ds-picker-option-title">{d.title}</span>
                  {d.category ? (
                    <span className="project-ds-picker-option-cat">{d.category}</span>
                  ) : null}
                </div>
                {d.swatches && d.swatches.length > 0 ? (
                  <div className="project-ds-picker-option-swatches">
                    {d.swatches.slice(0, 6).map((sw, i) => (
                      <span
                        key={`${d.id}-sw-${i}`}
                        className="project-ds-picker-option-swatch"
                        style={{ background: sw }}
                      />
                    ))}
                  </div>
                ) : null}
                {d.summary ? (
                  <span className="project-ds-picker-option-summary">{d.summary}</span>
                ) : null}
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className="project-ds-picker-empty">没有匹配的设计系统</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
