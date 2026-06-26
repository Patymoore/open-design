// Second-level "sub-type" rail for the Home input card.
//
// After a first-level create chip is picked (Prototype / Slide deck), this
// rail surfaces a compact row of sub-categories — mirroring how Manus shows
// "landing page / dashboard / portfolio" under its "Website" choice, and
// matching the exact sub-category taxonomy the Community plugin grid uses.
//
// The list is NOT hand-authored here: it is derived from the same
// `SUBCATEGORIES` facet table the Community section uses
// (`plugins-home/facets.ts`), so the labels and grouping stay in lockstep.
// Picking a sub-type filters the example-prompt cards below the rail to that
// scene; it does NOT bind a plugin or stamp an active badge.

import type { InstalledPluginRecord } from '@open-design/contracts';
import type { Locale } from '../../i18n/types';
import type { IconName } from '../Icon';
import {
  buildSubcategoryCatalog,
  extractSubcategories,
  type FacetOption,
} from '../plugins-home/facets';

// Parent chips that carry a second-level rail. Prototype/deck draw from the
// Community facet catalog; social-card/diagram use a local taxonomy because
// they are template scenarios, not installed plugin subfacets.
export type SubChipParentId = 'prototype' | 'deck' | 'social-card' | 'diagram';

export interface HomeHeroSubChip {
  // Facet subcategory slug, e.g. 'business-dashboards'.
  slug: string;
  label: string;
  icon: IconName;
}

const PARENT_IDS: readonly SubChipParentId[] = ['prototype', 'deck', 'social-card', 'diagram'];

// Icon per facet subcategory slug. Falls back to a neutral glyph so a newly
// added facet still renders a pill rather than crashing.
const SUBCATEGORY_ICONS: Record<string, IconName> = {
  // prototype
  'business-dashboards': 'grid',
  'app-prototypes': 'blocks',
  'landing-marketing': 'globe',
  'developer-tools': 'terminal',
  'docs-reports': 'file',
  'brand-design': 'palette',
  // deck
  'pitch-business': 'present',
  'course-training': 'lightbulb',
  'reports-briefings': 'file',
  'product-sales': 'star',
  'engineering-talks': 'terminal',
  'creative-decks': 'palette',
  // social-card
  'x-twitter-card': 'share',
  'threads-card': 'comment',
  'xiaohongshu-carousel': 'image',
  'wechat-cover': 'file-text',
  'linkedin-card': 'file',
  'instagram-story': 'smartphone',
  // diagram
  'architecture-diagram': 'grid',
  'workflow-diagram': 'refresh',
  'rag-agent-diagram': 'sparkles',
  'uml-diagram': 'blocks',
  'data-flow-diagram': 'kanban',
  'comparison-diagram': 'layers-filled',
};
const DEFAULT_SUBCATEGORY_ICON: IconName = 'blocks';

export function isSubChipParent(chipId: string | null): chipId is SubChipParentId {
  return chipId === 'prototype' || chipId === 'deck' || chipId === 'social-card' || chipId === 'diagram';
}

const LOCAL_SUBCHIPS: Record<'social-card' | 'diagram', HomeHeroSubChip[]> = {
  'social-card': [
    { slug: 'x-twitter-card', label: 'Twitter / X', icon: SUBCATEGORY_ICONS['x-twitter-card'] ?? DEFAULT_SUBCATEGORY_ICON },
    { slug: 'threads-card', label: 'Threads', icon: SUBCATEGORY_ICONS['threads-card'] ?? DEFAULT_SUBCATEGORY_ICON },
    { slug: 'xiaohongshu-carousel', label: 'Xiaohongshu / Rednote', icon: SUBCATEGORY_ICONS['xiaohongshu-carousel'] ?? DEFAULT_SUBCATEGORY_ICON },
    { slug: 'wechat-cover', label: 'WeChat cover', icon: SUBCATEGORY_ICONS['wechat-cover'] ?? DEFAULT_SUBCATEGORY_ICON },
    { slug: 'linkedin-card', label: 'LinkedIn', icon: SUBCATEGORY_ICONS['linkedin-card'] ?? DEFAULT_SUBCATEGORY_ICON },
    { slug: 'instagram-story', label: 'Instagram story', icon: SUBCATEGORY_ICONS['instagram-story'] ?? DEFAULT_SUBCATEGORY_ICON },
  ],
  diagram: [
    { slug: 'architecture-diagram', label: 'Architecture', icon: SUBCATEGORY_ICONS['architecture-diagram'] ?? DEFAULT_SUBCATEGORY_ICON },
    { slug: 'workflow-diagram', label: 'Workflow', icon: SUBCATEGORY_ICONS['workflow-diagram'] ?? DEFAULT_SUBCATEGORY_ICON },
    { slug: 'rag-agent-diagram', label: 'RAG / Agent', icon: SUBCATEGORY_ICONS['rag-agent-diagram'] ?? DEFAULT_SUBCATEGORY_ICON },
    { slug: 'uml-diagram', label: 'UML', icon: SUBCATEGORY_ICONS['uml-diagram'] ?? DEFAULT_SUBCATEGORY_ICON },
    { slug: 'data-flow-diagram', label: 'Data flow', icon: SUBCATEGORY_ICONS['data-flow-diagram'] ?? DEFAULT_SUBCATEGORY_ICON },
    { slug: 'comparison-diagram', label: 'Comparison', icon: SUBCATEGORY_ICONS['comparison-diagram'] ?? DEFAULT_SUBCATEGORY_ICON },
  ],
};

const LOCAL_SUBCHIP_LABELS_ZH: Record<string, string> = {
  'x-twitter-card': 'Twitter / X',
  'threads-card': 'Threads',
  'xiaohongshu-carousel': '小红书图文',
  'wechat-cover': '公众号封面',
  'linkedin-card': 'LinkedIn',
  'instagram-story': 'Instagram Story',
  'architecture-diagram': '架构图',
  'workflow-diagram': '流程图',
  'rag-agent-diagram': 'RAG / Agent',
  'uml-diagram': 'UML',
  'data-flow-diagram': '数据流',
  'comparison-diagram': '对比图',
};

function localizeLocalSubChip(sub: HomeHeroSubChip, locale: Locale | undefined): HomeHeroSubChip {
  if (locale !== 'zh-CN' && locale !== 'zh-TW') return sub;
  return {
    ...sub,
    label: LOCAL_SUBCHIP_LABELS_ZH[sub.slug] ?? sub.label,
  };
}

// Sub-types for a first-level chip, drawn from the Community facet catalog so
// the labels, set, AND order match the Community section exactly. The display
// order is whatever `SUBCATEGORIES` (in `plugins-home/facets.ts`) declares for
// the parent — there is no Home-only reordering, so the two surfaces stay in
// lockstep. Only sub-categories that actually have installed plugins
// (count > 0) are surfaced. Returns [] for chips without a second-level rail.
export function subChipsForChip(
  chipId: string | null,
  plugins: InstalledPluginRecord[],
  locale?: Locale,
): HomeHeroSubChip[] {
  if (!isSubChipParent(chipId)) return [];
  if (chipId === 'social-card' || chipId === 'diagram') {
    return LOCAL_SUBCHIPS[chipId].map((sub) => localizeLocalSubChip(sub, locale));
  }
  const catalog = buildSubcategoryCatalog(plugins);
  const options: FacetOption[] = catalog[chipId] ?? [];
  return options
    .filter((option) => option.count > 0)
    .map((option) => ({
      slug: option.slug,
      label: option.label,
      icon: SUBCATEGORY_ICONS[option.slug] ?? DEFAULT_SUBCATEGORY_ICON,
    }));
}

// Narrow a list of example-prompt plugins to a chosen sub-category. The
// `parent` chip id scopes which facet subcategory table is consulted.
export function filterPluginsBySubChip(
  plugins: InstalledPluginRecord[],
  parent: SubChipParentId,
  subcategorySlug: string,
): InstalledPluginRecord[] {
  return plugins.filter((plugin) =>
    extractSubcategories(plugin, parent).includes(subcategorySlug),
  );
}

export { PARENT_IDS };
