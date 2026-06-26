import type { Locale } from '../../i18n/types';

export type LocalTemplatePresetChipId = 'social-card' | 'diagram';

export type LocalTemplatePresetVariant =
  | 'social-editorial-cover'
  | 'social-swiss-carousel'
  | 'social-wechat-pair'
  | 'social-thread-strip'
  | 'social-linkedin-metric'
  | 'social-story'
  | 'diagram-flat-architecture'
  | 'diagram-dark-terminal'
  | 'diagram-blueprint'
  | 'diagram-agent-loop'
  | 'diagram-uml-sequence'
  | 'diagram-data-lineage';

export interface LocalTemplatePreset {
  id: string;
  chipId: LocalTemplatePresetChipId;
  subcategorySlug: string;
  title: string;
  description: string;
  promptText: string;
  variant: LocalTemplatePresetVariant;
}

interface LocalizedPresetSource {
  id: string;
  chipId: LocalTemplatePresetChipId;
  subcategorySlug: string;
  variant: LocalTemplatePresetVariant;
  title: { en: string; zh: string };
  description: { en: string; zh: string };
  promptText: { en: string; zh: string };
}

const PRESET_SOURCES: LocalizedPresetSource[] = [
  {
    id: 'social-x-founder-update',
    chipId: 'social-card',
    subcategorySlug: 'x-twitter-card',
    variant: 'social-thread-strip',
    title: { en: 'X Founder Update', zh: 'X 创始人更新' },
    description: { en: 'Metric, lesson, next step', zh: '指标、经验、下一步' },
    promptText: {
      en: 'Create an X founder-update card set from this note: one sharp metric, one lesson, one product screenshot card, and one next-step CTA. Use compact 16:9 timeline-friendly compositions.',
      zh: '把这段笔记做成 X 创始人更新卡片组：一个关键指标、一个经验、一张产品截图卡和一个下一步 CTA。使用适合 16:9 时间线的紧凑构图。',
    },
  },
  {
    id: 'social-editorial-xhs',
    chipId: 'social-card',
    subcategorySlug: 'xiaohongshu-carousel',
    variant: 'social-editorial-cover',
    title: { en: 'Editorial Rednote', zh: '杂志风小红书' },
    description: { en: '3:4 editorial carousel', zh: '3:4 图文组图' },
    promptText: {
      en: 'Create a Rednote / Xiaohongshu 3:4 editorial carousel from my notes: image-led cover, three value cards, comparison card, and save-worthy checklist. Use a restrained magazine layout inspired by Monocle / Kinfolk / Cereal.',
      zh: '把我的笔记做成小红书 3:4 杂志风图文组图：图片主导封面、三张价值点、对比卡和一张值得收藏的 checklist。版式参考 Monocle / Kinfolk / Cereal 的克制编辑感。',
    },
  },
  {
    id: 'social-swiss-product-review',
    chipId: 'social-card',
    subcategorySlug: 'xiaohongshu-carousel',
    variant: 'social-swiss-carousel',
    title: { en: 'Swiss Review Cards', zh: '瑞士风测评卡' },
    description: { en: 'KPI, matrix, before-after', zh: 'KPI、矩阵、前后对比' },
    promptText: {
      en: 'Turn this product review into a Swiss-style social carousel with one accent color, grid typography, KPI tower, before-after card, matrix card, and final recommendation. Export-ready 1080x1440 frames.',
      zh: '把这份产品测评做成瑞士国际主义风格社媒轮播：单一强调色、网格排版、KPI Tower、前后对比卡、矩阵卡和最终推荐结论，输出 1080x1440 画板。',
    },
  },
  {
    id: 'social-wechat-cover-pair',
    chipId: 'social-card',
    subcategorySlug: 'wechat-cover',
    variant: 'social-wechat-pair',
    title: { en: 'WeChat Cover Pair', zh: '公众号封面对' },
    description: { en: '21:9 header + 1:1 share', zh: '21:9 头图 + 1:1 分享卡' },
    promptText: {
      en: 'Create a WeChat article cover pair from this draft: 21:9 header plus 1:1 share card, matching typography, image treatment, title hierarchy, and mobile-readable crop.',
      zh: '基于这篇草稿做一套公众号封面对：21:9 头图 + 1:1 分享卡，字体、图像处理、标题层级一致，并保证手机裁切可读。',
    },
  },
  {
    id: 'social-thread-launch',
    chipId: 'social-card',
    subcategorySlug: 'threads-card',
    variant: 'social-thread-strip',
    title: { en: 'Thread Launch Set', zh: 'Thread 发布组图' },
    description: { en: 'Hook, proof, takeaway', zh: 'Hook、证据、结论' },
    promptText: {
      en: 'Create a launch card set for Threads and X: hook card, proof card, product screenshot card, takeaway card, and reply-friendly CTA. Keep the layout conversational and easy to scan.',
      zh: '做一套适合 Threads 和 X 的发布组图：hook 卡、证据卡、产品截图卡、结论卡和适合引发回复的 CTA。语气像对话，版面易扫读。',
    },
  },
  {
    id: 'social-linkedin-insight',
    chipId: 'social-card',
    subcategorySlug: 'linkedin-card',
    variant: 'social-linkedin-metric',
    title: { en: 'LinkedIn Insight', zh: 'LinkedIn 洞察卡' },
    description: { en: 'B2B metric narrative', zh: 'B2B 指标叙事' },
    promptText: {
      en: 'Design a LinkedIn thought-leadership card from this point of view with a strong claim, one supporting statistic, chart-like structure, and executive-readable visual hierarchy.',
      zh: '把这个观点设计成 LinkedIn 思想领导力卡片：强主张、一个支撑数据、图表化结构，以及适合管理层快速阅读的信息层级。',
    },
  },
  {
    id: 'social-story-countdown',
    chipId: 'social-card',
    subcategorySlug: 'instagram-story',
    variant: 'social-story',
    title: { en: 'Story Countdown', zh: 'Story 倒计时' },
    description: { en: '9:16 launch sequence', zh: '9:16 发布序列' },
    promptText: {
      en: 'Create a 9:16 Instagram story sequence for this launch: opening hook, product reveal, benefit card, countdown marker, and swipe-up style CTA with one consistent accent color.',
      zh: '为这次发布做一套 9:16 Instagram story：开场 hook、产品揭示、卖点卡、倒计时标记和 swipe-up 风格 CTA，保持一个统一强调色。',
    },
  },
  {
    id: 'diagram-flat-architecture',
    chipId: 'diagram',
    subcategorySlug: 'architecture-diagram',
    variant: 'diagram-flat-architecture',
    title: { en: 'Flat Architecture', zh: '扁平架构图' },
    description: { en: 'Product-doc friendly SVG', zh: '适合产品文档的 SVG' },
    promptText: {
      en: 'Draw a product-doc friendly system architecture diagram in a clean flat-icon style. Include client, API gateway, services, workers, database, cache, object storage, observability, semantic arrows, and a bottom-right legend.',
      zh: '用干净的扁平图标风画一张适合产品文档的系统架构图：客户端、API gateway、服务、worker、数据库、缓存、对象存储、可观测性、语义箭头和右下角图例。',
    },
  },
  {
    id: 'diagram-dark-tool-call',
    chipId: 'diagram',
    subcategorySlug: 'rag-agent-diagram',
    variant: 'diagram-dark-terminal',
    title: { en: 'Dark Tool Flow', zh: '暗色工具调用图' },
    description: { en: 'Terminal style agent loop', zh: '终端风 Agent 回路' },
    promptText: {
      en: 'Draw an AI tool-call flow diagram in dark terminal style with planner, model calls, tool inputs, tool outputs, validation, retry path, memory, and final response. Use neon accents and clear arrow labels.',
      zh: '用暗色终端风画一张 AI 工具调用流程图：planner、模型调用、工具输入、工具输出、校验、重试路径、记忆和最终响应，使用霓虹强调色和清晰箭头标签。',
    },
  },
  {
    id: 'diagram-blueprint-microservices',
    chipId: 'diagram',
    subcategorySlug: 'architecture-diagram',
    variant: 'diagram-blueprint',
    title: { en: 'Blueprint Services', zh: '蓝图微服务' },
    description: { en: 'Cloud deployment map', zh: '云部署结构图' },
    promptText: {
      en: 'Create a blueprint-style microservices deployment diagram with regions, ingress, queues, services, storage, secrets, monitoring, failure paths, and rollback path. Use a deep blue grid and cyan strokes.',
      zh: '画一张蓝图风微服务部署图：region、入口、队列、服务、存储、密钥、监控、失败路径和回滚路径，使用深蓝网格和青色线条。',
    },
  },
  {
    id: 'diagram-workflow-swimlane',
    chipId: 'diagram',
    subcategorySlug: 'workflow-diagram',
    variant: 'diagram-flat-architecture',
    title: { en: 'Workflow Swimlane', zh: '泳道流程图' },
    description: { en: 'Roles, states, handoffs', zh: '角色、状态、交接' },
    promptText: {
      en: 'Create a swimlane workflow diagram for this process with owner lanes, triggers, states, decision branches, handoffs, exceptions, timeout handling, and final outputs.',
      zh: '为这个流程画一张泳道流程图：负责人泳道、触发条件、状态、决策分支、交接、异常、超时处理和最终产出。',
    },
  },
  {
    id: 'diagram-rag-memory',
    chipId: 'diagram',
    subcategorySlug: 'rag-agent-diagram',
    variant: 'diagram-agent-loop',
    title: { en: 'RAG Memory Map', zh: 'RAG 记忆图' },
    description: { en: 'Retriever, reranker, memory', zh: '检索、重排、记忆' },
    promptText: {
      en: 'Draw a RAG memory architecture diagram with ingestion, chunking, embeddings, vector store, retriever, reranker, working memory, long-term memory, citations, feedback loop, and personalized response.',
      zh: '画一张 RAG 记忆架构图：采集、切块、embedding、向量库、retriever、reranker、工作记忆、长期记忆、引用、反馈循环和个性化响应。',
    },
  },
  {
    id: 'diagram-uml-sequence',
    chipId: 'diagram',
    subcategorySlug: 'uml-diagram',
    variant: 'diagram-uml-sequence',
    title: { en: 'UML Sequence', zh: 'UML 时序图' },
    description: { en: 'Checkout / API timeline', zh: '支付 / API 时间线' },
    promptText: {
      en: 'Create a UML sequence diagram for this flow with user, frontend, API, payment provider, database, notification service, success path, error path, and retry behavior.',
      zh: '为这个流程画 UML 时序图：用户、前端、API、支付服务、数据库、通知服务、成功路径、错误路径和重试行为。',
    },
  },
  {
    id: 'diagram-comparison-matrix',
    chipId: 'diagram',
    subcategorySlug: 'comparison-diagram',
    variant: 'diagram-data-lineage',
    title: { en: 'Decision Matrix', zh: '决策矩阵图' },
    description: { en: 'Options, constraints, tradeoffs', zh: '方案、约束、取舍' },
    promptText: {
      en: 'Turn this tradeoff analysis into a comparison diagram with options, constraints, cost, latency, reliability, implementation effort, lock-in, recommendation, and next validation step.',
      zh: '把这份 tradeoff 分析转成对比图：候选方案、约束、成本、延迟、可靠性、实现工作量、锁定风险、推荐结论和下一步验证。',
    },
  },
  {
    id: 'diagram-data-lineage',
    chipId: 'diagram',
    subcategorySlug: 'data-flow-diagram',
    variant: 'diagram-data-lineage',
    title: { en: 'Data Lineage', zh: '数据血缘图' },
    description: { en: 'Events to warehouse', zh: '事件到数仓' },
    promptText: {
      en: 'Draw a data lineage diagram from UI events to ingestion, stream processing, warehouse, semantic layer, dashboards, quality checks, retention, and deletion path. Distinguish read, write, async, and audit arrows.',
      zh: '画一张数据血缘图，从 UI 事件到采集、流处理、数仓、语义层、看板、质量检查、保留周期和删除路径，并区分 read、write、async、audit 箭头。',
    },
  },
];

function promptLocale(locale: Locale): 'en' | 'zh' {
  return locale === 'zh-CN' || locale === 'zh-TW' ? 'zh' : 'en';
}

function localizePreset(source: LocalizedPresetSource, locale: Locale): LocalTemplatePreset {
  const kind = promptLocale(locale);
  return {
    id: source.id,
    chipId: source.chipId,
    subcategorySlug: source.subcategorySlug,
    title: source.title[kind] ?? source.title.en,
    description: source.description[kind] ?? source.description.en,
    promptText: source.promptText[kind] ?? source.promptText.en,
    variant: source.variant,
  };
}

export function localTemplatePresetsForChip(
  chipId: string | null,
  locale: Locale,
  subcategorySlug: string | null = null,
): LocalTemplatePreset[] {
  if (chipId !== 'social-card' && chipId !== 'diagram') return [];
  return PRESET_SOURCES
    .filter((preset) => preset.chipId === chipId)
    .filter((preset) => !subcategorySlug || preset.subcategorySlug === subcategorySlug)
    .map((preset) => localizePreset(preset, locale));
}

export function localTemplatePresetSearchText(chipId: string, locale: Locale): string {
  return localTemplatePresetsForChip(chipId, locale)
    .map((preset) => `${preset.title} ${preset.description} ${preset.promptText} ${preset.subcategorySlug}`)
    .join(' ');
}
