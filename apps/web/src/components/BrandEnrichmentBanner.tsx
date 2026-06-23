// "Continue with AI optimization" banner for programmatically-extracted brand
// projects.
//
// When a brand's design system is harvested PROGRAMMATICALLY (no agent), the
// backing project opens with a finished design system but an empty chat — the
// AI never ran. This banner is the opt-in entry point to refine that design
// system with the agent: the user optionally picks one or more curated
// design-system skills, then hits the button, which sends the project's seeded
// enrichment prompt with those skills attached for that turn.

import { useEffect, useMemo, useState } from 'react';
import type { SkillSummary } from '../types';
import { fetchSkills } from '../providers/registry';
import { Icon } from './Icon';
import styles from './BrandEnrichmentBanner.module.css';

interface Props {
  /** Run the enrichment turn with the chosen per-turn skill ids (may be empty). */
  onContinue: (skillIds: string[]) => void;
  /** Locks the controls while the turn is being sent. */
  busy?: boolean;
}

// Curated, design-system-oriented skills offered for the optional AI pass. Only
// those actually installed are shown (the fetch result is intersected with this
// allowlist), so a trimmed registry never surfaces a dead chip. `brand-extract`
// is intentionally omitted: the seeded enrichment prompt already drives that
// flow, so these are the additive refinement lenses on top of it.
const CURATED_DS_SKILL_IDS = ['design-md', 'design-review', 'color-expert', 'brand-guidelines'];

export function BrandEnrichmentBanner({ onContinue, busy = false }: Props) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    void fetchSkills().then((all) => {
      if (cancelled) return;
      const byId = new Map(all.map((skill) => [skill.id, skill]));
      const curated = CURATED_DS_SKILL_IDS.map((id) => byId.get(id)).filter(
        (skill): skill is SkillSummary => Boolean(skill),
      );
      setSkills(curated);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={styles.banner} role="note" data-testid="brand-enrichment-banner">
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden>
          <Icon name="sparkles" size={18} />
        </span>
        <span className={styles.copy}>
          <span className={styles.title}>Continue with AI optimization</span>
          <span className={styles.text}>
            Your design system is already usable from the fast extraction. Run the slower AI extraction
            when you want it to measure deeper and update this system in place.
          </span>
        </span>
      </div>

      {skills.length > 0 ? (
        <div className={styles.skills} role="group" aria-label="Design-system skills">
          {skills.map((skill) => {
            const isOn = selected.has(skill.id);
            return (
              <button
                key={skill.id}
                type="button"
                className={`${styles.skillChip}${isOn ? ` ${styles.skillChipOn}` : ''}`}
                aria-pressed={isOn}
                disabled={busy}
                onClick={() => toggle(skill.id)}
                title={skill.description || skill.name}
                data-testid={`brand-enrichment-skill-${skill.id}`}
              >
                {isOn ? <Icon name="check" size={12} /> : null}
                {skill.name}
              </button>
            );
          })}
        </div>
      ) : null}

      <button
        type="button"
        className={styles.cta}
        disabled={busy}
        onClick={() => onContinue(selectedIds)}
        data-testid="brand-enrichment-continue"
      >
        <Icon name="sparkles" size={13} />
        {selectedIds.length > 0
          ? `Optimize with ${selectedIds.length} skill${selectedIds.length === 1 ? '' : 's'}`
          : 'Optimize with AI'}
      </button>
    </div>
  );
}
