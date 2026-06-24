// DesignKitView — the shared brand.html-style kit layout.
//
// Renders a normalized DesignKit (see runtime/design-kit.ts) as the full module
// stack — cover, identity, logo, typography, palette, voice, imagery & layout,
// images, design-system kit, and assets — exactly matching the rendered
// brand.html. Every design-system surface (Brands tab, Design Systems list
// preview, in-project Design System tab) feeds this one component so they look
// identical regardless of whether the data came from brand.json or a parsed
// DESIGN.md.
//
// DESIGN.md stays the editable text contract, but this view exposes it through
// direct module actions instead of a separate Visualize / Edit / Source block.
// Empty modules expose upload affordances when the backing kit is writable.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, Textarea } from '@open-design/components';
import { useT } from '../i18n';
import { openExternalUrl, projectRawUrl } from '../providers/registry';
import { buildSrcdoc } from '../runtime/srcdoc';
import {
  fontStack,
  isLightHex,
  type DesignKit,
  type KitFont,
} from '../runtime/design-kit';
import type { KitUploadModule } from '../runtime/kit-upload';
import { Icon, type IconName } from './Icon';
import styles from './BrandPreviewCard.module.css';

const IMAGE_CAP = 8;
const DESIGN_KIT_PREVIEW_SANDBOX = 'allow-scripts allow-popups';

// ── Logo with fallback chain ────────────────────────────────────────
// Brand stage (`/api/brands/:id/logo`) when a brandId is known, else an explicit
// logoSrc, then Google's favicon for the domain, then a monogram letter.
type LogoStage = 'brand' | 'custom' | 'favicon' | 'letter';

interface KitLogoProps {
  /** Legacy alias for `brandId` (Brands list rows pass `id`). */
  id?: string;
  brandId?: string;
  logoSrc?: string | null;
  host?: string;
  name: string;
  faviconSize: number;
  className?: string;
  fallbackClassName?: string;
}

export function BrandLogo({
  id,
  brandId,
  logoSrc,
  host,
  name,
  faviconSize,
  className,
  fallbackClassName,
}: KitLogoProps) {
  const bid = brandId ?? id;
  const first: LogoStage = bid ? 'brand' : logoSrc ? 'custom' : host ? 'favicon' : 'letter';
  const [stage, setStage] = useState<LogoStage>(first);
  useEffect(() => {
    setStage(first);
  }, [first, bid, logoSrc, host]);

  const src =
    stage === 'brand' && bid
      ? `/api/brands/${encodeURIComponent(bid)}/logo`
      : stage === 'custom' && logoSrc
        ? logoSrc
        : stage === 'favicon' && host
          ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${faviconSize}`
          : null;

  if (!src) {
    return (
      <span className={fallbackClassName} aria-hidden>
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() =>
        setStage((s) =>
          s === 'brand' ? (logoSrc ? 'custom' : host ? 'favicon' : 'letter') : s === 'custom' ? 'favicon' : 'letter',
        )
      }
    />
  );
}

interface BrandFontManifestFile {
  family: string;
  weight: string;
  style: string;
  file: string;
  format: string;
}

// Load real typefaces so specimens render for real: append any Google Fonts
// stylesheets the kit declares, and inject self-hosted @font-face from the
// project's fonts/manifest.json. Both are best-effort and torn down on change.
export function useBrandFonts(
  projectId: string | undefined,
  fonts: { googleFontsUrl?: string }[],
): void {
  const googleUrls = useMemo(() => {
    const urls = fonts
      .map((f) => f.googleFontsUrl)
      .filter((u): u is string => Boolean(u && /^https:\/\/fonts\.googleapis\.com\//i.test(u)));
    return Array.from(new Set(urls));
  }, [fonts]);

  useEffect(() => {
    const links = googleUrls.map((href) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
      return link;
    });
    return () => {
      for (const link of links) link.remove();
    };
  }, [googleUrls]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let styleEl: HTMLStyleElement | null = null;
    void (async () => {
      try {
        const resp = await fetch(projectRawUrl(projectId, 'fonts/manifest.json'), {
          cache: 'no-store',
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as { files?: BrandFontManifestFile[] };
        const files = Array.isArray(data?.files) ? data.files : [];
        if (cancelled || files.length === 0) return;
        const css = files
          .map((f) => {
            const url = projectRawUrl(projectId, `fonts/${f.file}`);
            return [
              '@font-face {',
              `  font-family: '${f.family.replace(/'/g, '')}';`,
              `  src: url('${url}') format('${f.format}');`,
              `  font-weight: ${f.weight};`,
              `  font-style: ${f.style};`,
              '  font-display: swap;',
              '}',
            ].join('\n');
          })
          .join('\n');
        styleEl = document.createElement('style');
        styleEl.dataset.brandFonts = projectId;
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
      } catch {
        // A missing/malformed manifest is expected for some systems.
      }
    })();
    return () => {
      cancelled = true;
      if (styleEl) styleEl.remove();
    };
  }, [projectId]);
}

interface BrandTokenSubset {
  colorPrimary?: string;
  colorPrimaryBg?: string;
  colorPrimaryHover?: string;
  colorPrimaryActive?: string;
  fontSize?: number;
  borderRadius?: number;
}

export interface KitDesignMdActions {
  body: string;
  onSave?: (value: string) => void | Promise<void>;
  onOpenFile?: () => void;
  saving?: boolean;
  canEdit?: boolean;
}

export interface DesignKitViewProps {
  kit: DesignKit;
  variant?: 'panel' | 'compact';
  /** Rendered next to the title (status badges). */
  badgeSlot?: ReactNode;
  /** Rendered on the header's right (action buttons). */
  actionsSlot?: ReactNode;
  /** Rendered directly under the header (notices / errors). */
  noticeSlot?: ReactNode;
  /** Rendered above the modules (e.g. publish / default card). */
  topSlot?: ReactNode;
  /**
   * Opens a full, scrollable preview when the user clicks the hover button
   * over the showcase cover. When omitted, the cover falls back to a built-in
   * scrollable modal of the same showcase HTML. Lets the Design Systems list
   * route the hover button to its richer "Preview full system" modal.
   */
  onPreviewCover?: () => void;
  designMd?: KitDesignMdActions;
  onUploadModule?: (module: KitUploadModule, file: File) => void;
  onColorChange?: (index: number, hex: string) => void;
  onDeleteLogo?: (index: number) => void;
  onDeleteImage?: (index: number) => void;
  onRefresh?: () => void;
  onDownload?: () => void;
  onImport?: () => void;
  onReset?: () => void;
  uploading?: KitUploadModule | null;
  dataTestId?: string;
}

export function DesignKitView({
  kit,
  variant = 'panel',
  badgeSlot,
  actionsSlot,
  noticeSlot,
  topSlot,
  onPreviewCover,
  designMd,
  onUploadModule,
  onColorChange,
  onDeleteLogo,
  onDeleteImage,
  onRefresh,
  onDownload,
  onImport,
  onReset,
  uploading,
  dataTestId = 'design-kit-view',
}: DesignKitViewProps) {
  const t = useT();
  const compact = variant === 'compact';
  const [coverPreviewOpen, setCoverPreviewOpen] = useState(false);
  const [tokens, setTokens] = useState<BrandTokenSubset | null>(null);
  const [dsTheme, setDsTheme] = useState<'light' | 'dark'>('light');
  const [activeLogo, setActiveLogo] = useState(0);
  const [imagesExpanded, setImagesExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; caption: string } | null>(null);
  const [assetPreview, setAssetPreview] = useState<{ url: string; label: string } | null>(null);
  const [designMdOpen, setDesignMdOpen] = useState(false);
  const [designMdDraft, setDesignMdDraft] = useState('');
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fontInputRef = useRef<HTMLInputElement | null>(null);
  const designMdInputRef = useRef<HTMLInputElement | null>(null);

  useBrandFonts(kit.projectId, kit.fonts);

  const logoCandidates = useMemo(
    () => [kit.logoSrc, ...kit.logoAlternates].filter((c): c is string => Boolean(c)),
    [kit.logoSrc, kit.logoAlternates],
  );
  const activeLogoSrc = logoCandidates[activeLogo] ?? logoCandidates[0] ?? null;

  useEffect(() => {
    setActiveLogo(0);
    setImagesExpanded(false);
    setLightbox(null);
    setAssetPreview(null);
    setCoverPreviewOpen(false);
  }, [kit.designSystemId, kit.brandId]);

  useEffect(() => {
    if (!lightbox && !assetPreview && !coverPreviewOpen && !designMdOpen) return undefined;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setLightbox(null);
      setAssetPreview(null);
      setCoverPreviewOpen(false);
      setDesignMdOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [assetPreview, coverPreviewOpen, designMdOpen, lightbox]);

  // Engine token chips, when the system dir exists.
  useEffect(() => {
    const url = kit.system?.tokensUrl;
    if (!url) {
      setTokens(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) return;
        const raw = (await resp.json()) as Record<string, unknown>;
        if (cancelled) return;
        const next: BrandTokenSubset = {};
        if (typeof raw.colorPrimary === 'string') next.colorPrimary = raw.colorPrimary;
        if (typeof raw.colorPrimaryBg === 'string') next.colorPrimaryBg = raw.colorPrimaryBg;
        if (typeof raw.colorPrimaryHover === 'string') next.colorPrimaryHover = raw.colorPrimaryHover;
        if (typeof raw.colorPrimaryActive === 'string') next.colorPrimaryActive = raw.colorPrimaryActive;
        if (typeof raw.fontSize === 'number') next.fontSize = raw.fontSize;
        if (typeof raw.borderRadius === 'number') next.borderRadius = raw.borderRadius;
        setTokens(next.colorPrimary ? next : null);
      } catch {
        // Token chips are decorative.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kit.system?.tokensUrl]);

  const colors = kit.colors;
  const fonts = useMemo<{ font: KitFont; label: string }[]>(() => {
    const out: { font: KitFont; label: string }[] = [];
    if (kit.typography.display) out.push({ font: kit.typography.display, label: 'Display' });
    if (kit.typography.body) out.push({ font: kit.typography.body, label: 'Body' });
    if (kit.typography.mono) out.push({ font: kit.typography.mono, label: 'Mono' });
    return out;
  }, [kit.typography]);

  const voice = kit.voice;
  const imagery = kit.imagery;
  const layout = kit.layout;
  const samples = imagery?.samples ?? [];
  const dsKitUrl = dsTheme === 'dark' ? kit.system?.kitDarkUrl ?? kit.system?.kitUrl : kit.system?.kitUrl;
  const canUpload = Boolean(kit.canUpload && onUploadModule);
  const canEditDesignMd = Boolean(designMd?.canEdit !== false && designMd?.onSave);

  function handleFile(module: KitUploadModule, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && onUploadModule) onUploadModule(module, file);
  }

  function openInBrowser(event: MouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault();
    void openExternalUrl(url);
  }

  function handleModuleDragOver(event: DragEvent<HTMLElement>) {
    if (!canUpload) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleModuleDrop(module: KitUploadModule, event: DragEvent<HTMLElement>) {
    if (!canUpload || !onUploadModule) return;
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((f) =>
      module === 'font'
        ? /\.(otf|ttf|woff2?)$/i.test(f.name)
        : f.type.startsWith('image/') || /\.svg$/i.test(f.name),
    );
    if (file) onUploadModule(module, file);
  }

  async function pasteImage(module: Exclude<KitUploadModule, 'font'>) {
    if (!canUpload || !onUploadModule || !navigator.clipboard?.read) return;
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const ext = imageType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        onUploadModule(module, new File([blob], `clipboard-${module}-${Date.now()}.${ext}`, { type: imageType }));
        return;
      }
    } catch {
      // Clipboard image reads are browser-permission dependent.
    }
  }

  function openDesignMdEditor() {
    if (!designMd) return;
    setDesignMdDraft(designMd.body);
    setDesignMdOpen(true);
  }

  async function copyDesignMd() {
    if (!designMd?.body || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(designMd.body);
    } catch {
      // Clipboard write failures are non-fatal.
    }
  }

  async function saveDesignMdDraft() {
    if (!designMd?.onSave) return;
    await designMd.onSave(designMdDraft);
    setDesignMdOpen(false);
  }

  async function handleDesignMdUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    setDesignMdDraft(text);
    setDesignMdOpen(true);
  }

  function moduleActions(actions: ReactNode) {
    return actions ? <div className={styles.moduleActions}>{actions}</div> : null;
  }

  function moduleActionButton(
    label: string,
    icon: IconName,
    onClick: () => void,
    disabled = false,
  ) {
    return (
      <button
        type="button"
        className={styles.moduleAction}
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
      >
        <Icon name={icon} size={13} />
        <span>{label}</span>
      </button>
    );
  }

  function designMdActionButtons() {
    if (!designMd) return null;
    return (
      <>
        {moduleActionButton(t('ds.copyDesignMd'), 'copy', () => void copyDesignMd(), !designMd.body)}
        {canEditDesignMd
          ? moduleActionButton(t('ds.editDesignMd'), 'edit', openDesignMdEditor, Boolean(designMd.saving))
          : designMd.onOpenFile
            ? moduleActionButton(t('ds.openDesignMd'), 'file-text', designMd.onOpenFile)
            : null}
        {canEditDesignMd
          ? moduleActionButton(t('ds.uploadMd'), 'upload', () => designMdInputRef.current?.click(), Boolean(designMd.saving))
          : null}
      </>
    );
  }

  function uploadAction(module: KitUploadModule) {
    if (!canUpload) return null;
    const label =
      uploading === module
        ? t('ds.uploading')
        : module === 'logo'
          ? t('ds.uploadLogo')
          : module === 'font'
            ? t('ds.uploadFont')
            : t('ds.uploadImage');
    return moduleActionButton(
      label,
      'upload',
      () => (module === 'logo' ? logoInputRef : module === 'font' ? fontInputRef : imageInputRef).current?.click(),
      Boolean(uploading),
    );
  }

  function emptyModule(hint: string, module?: KitUploadModule) {
    return (
      <div className={styles.emptyModule}>
        <span className={styles.emptyModuleText}>{hint}</span>
        {module && canUpload ? (
          <button
            type="button"
            className={styles.uploadBtn}
            disabled={uploading === module}
            onClick={() => (module === 'logo' ? logoInputRef : module === 'font' ? fontInputRef : imageInputRef).current?.click()}
          >
            {uploading === module
              ? t('ds.uploading')
              : module === 'logo'
                ? t('ds.uploadLogo')
                : module === 'font'
                  ? t('ds.uploadFont')
                : t('ds.uploadImage')}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`${styles.previewInner} ${compact ? styles.compact : ''}`}
      data-testid={dataTestId}
      data-variant={variant}
    >
      <input
        ref={logoInputRef}
        type="file"
        accept="image/*,.svg"
        hidden
        onChange={(e) => handleFile('logo', e)}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFile('image', e)}
      />
      <input
        ref={fontInputRef}
        type="file"
        accept=".otf,.ttf,.woff,.woff2"
        hidden
        onChange={(e) => handleFile('font', e)}
      />
      <input
        ref={designMdInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        hidden
        onChange={(e) => void handleDesignMdUpload(e)}
      />

      <div className={styles.cover}>
        {kit.showcaseHtml ? (
          <>
            <span className={styles.coverFrameViewport} aria-hidden>
              <iframe
                className={styles.coverFrame}
                title={`${kit.name} preview`}
                sandbox={DESIGN_KIT_PREVIEW_SANDBOX}
                srcDoc={buildSrcdoc(kit.showcaseHtml)}
                tabIndex={-1}
              />
            </span>
            {!compact ? (
              <button
                type="button"
                className={styles.coverPreviewBtn}
                onClick={() =>
                  onPreviewCover ? onPreviewCover() : setCoverPreviewOpen(true)
                }
                data-testid="design-kit-cover-preview"
                aria-label={t('common.openPreview')}
              >
                <span className={styles.coverPreviewPill}>
                  <ExpandGlyph />
                  {t('common.openPreview')}
                </span>
              </button>
            ) : null}
          </>
        ) : activeLogoSrc ? (
          <button
            type="button"
            className={styles.coverImageButton}
            onClick={() => setLightbox({ src: activeLogoSrc, caption: kit.name })}
            aria-label={`${t('common.openPreview')}: ${kit.name}`}
          >
            <BrandLogo
              brandId={kit.brandId}
              logoSrc={kit.logoSrc}
              host={kit.host}
              name={kit.name}
              faviconSize={128}
              className={styles.coverLogo}
              fallbackClassName={styles.coverLogoFallback}
            />
          </button>
        ) : (
          <BrandLogo
            brandId={kit.brandId}
            logoSrc={kit.logoSrc}
            host={kit.host}
            name={kit.name}
            faviconSize={128}
            className={styles.coverLogo}
            fallbackClassName={styles.coverLogoFallback}
          />
        )}
      </div>

      <header className={styles.previewHead}>
        <div className={styles.previewHeadText}>
          <div className={styles.previewTitleRow}>
            <h2 className={styles.previewName}>{kit.name}</h2>
            {badgeSlot}
          </div>
          {kit.tagline ? <p className={styles.previewTagline}>{kit.tagline}</p> : null}
          {kit.host && kit.sourceUrl ? (
            <a
              className={styles.previewDomain}
              href={kit.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(event) => openInBrowser(event, kit.sourceUrl!)}
            >
              {kit.host}
              <ExternalGlyph />
            </a>
          ) : null}
        </div>
        {actionsSlot ? <div className={styles.previewActions}>{actionsSlot}</div> : null}
      </header>

      {noticeSlot}
      {topSlot}

      <>
          {kit.description ? (
            <section className={styles.section} aria-label={t('brandDetail.identity')}>
              <div className={styles.dsHead}>
                <h3 className={styles.sectionTitle}>{t('brandDetail.identity')}</h3>
                {moduleActions(designMdActionButtons())}
              </div>
              <p className={styles.description}>{kit.description}</p>
            </section>
          ) : null}

          {!compact ? (
            <section
              className={styles.section}
              aria-label={t('brandDetail.logo')}
              onDragOver={handleModuleDragOver}
              onDrop={(event) => handleModuleDrop('logo', event)}
            >
              <div className={styles.dsHead}>
                <h3 className={styles.sectionTitle}>{t('brandDetail.logo')}</h3>
                {moduleActions(
                  <>
                    {uploadAction('logo')}
                    {canUpload ? moduleActionButton('Paste image', 'copy', () => void pasteImage('logo'), Boolean(uploading)) : null}
                    {activeLogoSrc && onDeleteLogo
                      ? moduleActionButton('Delete', 'trash', () => onDeleteLogo(activeLogo), Boolean(uploading))
                      : null}
                  </>,
                )}
              </div>
              {activeLogoSrc ? (
                <>
                  <button
                    type="button"
                    className={`${styles.logoStage} ${styles.logoStageButton}`}
                    onClick={() => setLightbox({ src: activeLogoSrc, caption: kit.name })}
                    aria-label={`${t('common.openPreview')}: ${kit.name}`}
                  >
                    <img className={styles.logoStageImg} src={activeLogoSrc} alt={kit.name} />
                  </button>
                  {logoCandidates.length > 1 ? (
                    <div className={styles.logoThumbs}>
                      {logoCandidates.map((cand, i) => (
                        <button
                          key={cand}
                          type="button"
                          className={`${styles.logoThumb} ${i === activeLogo ? styles.logoThumbActive : ''}`}
                          onClick={() => setActiveLogo(i)}
                          aria-pressed={i === activeLogo}
                        >
                          <img src={cand} alt="" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {kit.logoNotes ? <p className={styles.logoNotes}>{kit.logoNotes}</p> : null}
                </>
              ) : (
                emptyModule(t('ds.moduleEmptyLogo'), 'logo')
              )}
            </section>
          ) : null}

          {fonts.length > 0 ? (
            <section
              className={styles.section}
              aria-label={t('brandDetail.typography')}
              onDragOver={handleModuleDragOver}
              onDrop={(event) => handleModuleDrop('font', event)}
            >
              <div className={styles.dsHead}>
                <h3 className={styles.sectionTitle}>{t('brandDetail.typography')}</h3>
                {moduleActions(
                  <>
                    {uploadAction('font')}
                    {designMdActionButtons()}
                  </>,
                )}
              </div>
              <div className={styles.fontTiles}>
                {fonts.map(({ font, label }) => (
                  <div key={`tile-${label}-${font.family}`} className={styles.fontTile}>
                    <div className={styles.fontTileAg} style={{ fontFamily: fontStack(font) }}>
                      Ag
                    </div>
                    <div className={styles.fontTileMeta}>
                      <span className={styles.fontTileName}>{font.family}</span>
                      <span className={styles.fontTileRole}>{label}</span>
                    </div>
                  </div>
                ))}
              </div>
              {compact ? null : (
                <div className={styles.fontList}>
                  {fonts.map(({ font, label }) => (
                    <div key={`row-${label}-${font.family}`} className={styles.fontItem}>
                      <div className={styles.fontItemHead}>
                        <span className={styles.fontRole}>{label}</span>
                        <span className={styles.fontFamily}>
                          {font.family}
                          {font.weights.length > 0 ? (
                            <span className={styles.fontWeights}> · {font.weights.join('/')}</span>
                          ) : null}
                        </span>
                      </div>
                      <span className={styles.fontSpecimen} style={{ fontFamily: fontStack(font) }}>
                        {label === 'Mono' ? 'const brand = await extract(url);' : kit.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : !compact && canUpload ? (
            <section
              className={styles.section}
              aria-label={t('brandDetail.typography')}
              onDragOver={handleModuleDragOver}
              onDrop={(event) => handleModuleDrop('font', event)}
            >
              <div className={styles.dsHead}>
                <h3 className={styles.sectionTitle}>{t('brandDetail.typography')}</h3>
                {moduleActions(uploadAction('font'))}
              </div>
              {emptyModule('No fonts captured.', 'font')}
            </section>
          ) : null}

          {colors.length > 0 ? (
            <section className={styles.section} aria-label={t('brandDetail.palette')}>
              <div className={styles.dsHead}>
                <h3 className={styles.sectionTitle}>{t('brandDetail.palette')}</h3>
                {moduleActions(designMdActionButtons())}
              </div>
              <div className={styles.paletteGrid}>
                {colors.map((c, i) => (
                  <div key={`${c.role}-${c.hex}-${i}`} className={styles.swatch}>
                    <span className={styles.swatchChip} style={{ background: c.hex }}>
                      {onColorChange ? (
                        <input
                          className={styles.swatchPicker}
                          type="color"
                          value={normalizeColorInput(c.hex)}
                          aria-label={`Edit ${c.name || c.role || 'color'}`}
                          onChange={(event) => onColorChange(i, event.target.value)}
                        />
                      ) : null}
                      <span
                        className={styles.swatchHex}
                        style={{ color: isLightHex(c.hex) ? 'rgba(0,0,0,.65)' : 'rgba(255,255,255,.9)' }}
                      >
                        {c.hex}
                      </span>
                    </span>
                    <div className={styles.swatchBody}>
                      <span className={styles.swatchName}>{c.name || c.role}</span>
                      {c.role ? <span className={styles.swatchRole}>{c.role}</span> : null}
                      {!compact && c.usage ? <span className={styles.swatchUsage}>{c.usage}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {!compact && voice ? (
            <section className={styles.section} aria-label={t('brandDetail.voiceTone')}>
              <div className={styles.dsHead}>
                <h3 className={styles.sectionTitle}>{t('brandDetail.voiceTone')}</h3>
                {moduleActions(designMdActionButtons())}
              </div>
              {voice.adjectives.length > 0 ? (
                <div className={styles.pills}>
                  {voice.adjectives.map((adj, i) => (
                    <span key={`${adj}-${i}`} className={styles.pill}>
                      {adj}
                    </span>
                  ))}
                </div>
              ) : null}
              {voice.tone ? <p className={styles.aesthetic}>{voice.tone}</p> : null}
              {voice.messagingPillars.length > 0 ? (
                <ul className={styles.pillars}>
                  {voice.messagingPillars.map((p, i) => (
                    <li key={`pillar-${i}`}>{p}</li>
                  ))}
                </ul>
              ) : null}
              {voice.vocabulary.use.length > 0 || voice.vocabulary.avoid.length > 0 ? (
                <div className={styles.vocab}>
                  {voice.vocabulary.use.length > 0 ? (
                    <div className={styles.vocabCol}>
                      <span className={styles.vocabUse}>{t('brandDetail.useLabel')}</span>
                      <span className={styles.vocabVals}>{voice.vocabulary.use.join(' · ')}</span>
                    </div>
                  ) : null}
                  {voice.vocabulary.avoid.length > 0 ? (
                    <div className={styles.vocabCol}>
                      <span className={styles.vocabAvoid}>{t('brandDetail.avoidLabel')}</span>
                      <span className={styles.vocabVals}>{voice.vocabulary.avoid.join(' · ')}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {!compact && (imagery || layout) ? (
            <section className={styles.section} aria-label={t('brandDetail.imageryLayout')}>
              <div className={styles.dsHead}>
                <h3 className={styles.sectionTitle}>{t('brandDetail.imageryLayout')}</h3>
                {moduleActions(designMdActionButtons())}
              </div>
              {imagery?.style ? <p className={styles.description}>{imagery.style}</p> : null}
              {(imagery?.subjects.length ?? 0) > 0 ? (
                <p className={styles.imageryLine}>
                  <span className={styles.imageryKey}>{t('brandDetail.subjects')}:</span>{' '}
                  {imagery?.subjects.join(', ')}
                </p>
              ) : null}
              {imagery?.treatment ? (
                <p className={styles.imageryLine}>
                  <span className={styles.imageryKey}>{t('brandDetail.treatment')}:</span>{' '}
                  {imagery.treatment}
                </p>
              ) : null}
              {(imagery?.avoid.length ?? 0) > 0 ? (
                <p className={styles.imageryLine}>
                  <span className={styles.imageryKeyAvoid}>{t('brandDetail.avoidLabel')}:</span>{' '}
                  {imagery?.avoid.join(', ')}
                </p>
              ) : null}
              {(layout?.postureRules.length ?? 0) > 0 ? (
                <div className={styles.posture}>
                  <h4 className={styles.subTitle}>{t('brandDetail.layoutPosture')}</h4>
                  <ul className={styles.postureList}>
                    {layout?.postureRules.map((r, i) => (
                      <li key={`posture-${i}`}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {!compact && (samples.length > 0 || canUpload) ? (
            <section
              className={styles.section}
              aria-label={t('brandDetail.images')}
              onDragOver={handleModuleDragOver}
              onDrop={(event) => handleModuleDrop('image', event)}
            >
              <div className={styles.dsHead}>
                <h3 className={styles.sectionTitle}>{t('brandDetail.images')}</h3>
                {moduleActions(
                  <>
                    {uploadAction('image')}
                    {canUpload ? moduleActionButton('Paste image', 'copy', () => void pasteImage('image'), Boolean(uploading)) : null}
                    {samples.length > IMAGE_CAP ? (
                      <button
                        type="button"
                        className={styles.sectionAction}
                        onClick={() => setImagesExpanded((v) => !v)}
                      >
                        {imagesExpanded
                          ? t('brandDetail.viewLess')
                          : t('brandDetail.viewMore').replace('{count}', String(samples.length))}
                      </button>
                    ) : null}
                  </>,
                )}
              </div>
              {samples.length > 0 ? (
                <div className={styles.gallery}>
                  {(imagesExpanded ? samples : samples.slice(0, IMAGE_CAP)).map((s, i) => {
                    const sampleIndex = imagesExpanded ? i : i;
                    const cap = s.caption || s.kind || kit.name;
                    return (
                      <figure key={`${s.url}-${i}`} className={styles.shot}>
                        <button
                          type="button"
                          className={styles.shotFrame}
                          onClick={() => setLightbox({ src: s.url, caption: cap })}
                          aria-label={cap}
                        >
                          <img src={s.url} alt={cap} loading="lazy" />
                        </button>
                        {onDeleteImage ? (
                          <button
                            type="button"
                            className={styles.shotDelete}
                            onClick={() => onDeleteImage(sampleIndex)}
                            aria-label={`Delete ${cap}`}
                            title="Delete"
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        ) : null}
                        {s.caption || s.kind ? (
                          <figcaption className={styles.shotMeta}>
                            <span className={styles.shotCap}>{s.caption || s.kind}</span>
                            {s.caption && s.kind ? <span className={styles.shotKind}>{s.kind}</span> : null}
                          </figcaption>
                        ) : null}
                      </figure>
                    );
                  })}
                </div>
              ) : (
                emptyModule(t('ds.moduleEmptyImages'), 'image')
              )}
            </section>
          ) : null}

          {!compact && kit.system && dsKitUrl ? (
            <section className={styles.section} aria-label={t('brandDetail.designSystem')}>
              <div className={styles.dsHead}>
                <h3 className={styles.sectionTitle}>{t('brandDetail.designSystem')}</h3>
                {moduleActions(
                  <>
                    {designMdActionButtons()}
                    {onRefresh ? moduleActionButton(t('ds.refresh'), 'refresh', onRefresh) : null}
                    {onDownload ? moduleActionButton(t('ds.download'), 'download', onDownload) : null}
                    {onImport ? moduleActionButton(t('ds.importFolder'), 'import', onImport) : null}
                    {onReset ? moduleActionButton(t('ds.reset'), 'reload', onReset) : null}
                    {kit.system.indexUrl ? (
                      <a
                        className={styles.dsOpen}
                        href={kit.system.indexUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(event) => openInBrowser(event, kit.system!.indexUrl!)}
                      >
                        {t('brandDetail.openFullSystem')}
                        <ExternalGlyph />
                      </a>
                    ) : null}
                  </>,
                )}
              </div>
              <div className={styles.dsFrameWrap}>
                <div className={styles.dsBar}>
                  <div className={styles.dsTabs}>
                    <button
                      type="button"
                      className={`${styles.dsTab} ${dsTheme === 'light' ? styles.dsTabActive : ''}`}
                      onClick={() => setDsTheme('light')}
                      aria-pressed={dsTheme === 'light'}
                    >
                      {t('brandDetail.themeLight')}
                    </button>
                    {kit.system.kitDarkUrl ? (
                      <button
                        type="button"
                        className={`${styles.dsTab} ${dsTheme === 'dark' ? styles.dsTabActive : ''}`}
                        onClick={() => setDsTheme('dark')}
                        aria-pressed={dsTheme === 'dark'}
                      >
                        {t('brandDetail.themeDark')}
                      </button>
                    ) : null}
                  </div>
                  <span className={styles.dsCap}>system/kit.html</span>
                </div>
                <iframe
                  key={dsKitUrl}
                  className={styles.dsFrame}
                  src={dsKitUrl}
                  loading="lazy"
                  sandbox={DESIGN_KIT_PREVIEW_SANDBOX}
                  title={t('brandDetail.designSystem')}
                />
              </div>
              {tokens?.colorPrimary ? (
                <div className={styles.dsTokens}>
                  <TokenChip label="colorPrimary" hex={tokens.colorPrimary} />
                  {tokens.colorPrimaryBg ? <TokenChip label="colorPrimaryBg" hex={tokens.colorPrimaryBg} /> : null}
                  {tokens.colorPrimaryHover ? (
                    <TokenChip label="colorPrimaryHover" hex={tokens.colorPrimaryHover} />
                  ) : null}
                  {tokens.colorPrimaryActive ? (
                    <TokenChip label="colorPrimaryActive" hex={tokens.colorPrimaryActive} />
                  ) : null}
                  {tokens.fontSize != null ? <ValueChip label="fontSize" value={String(tokens.fontSize)} /> : null}
                  {tokens.borderRadius != null ? (
                    <ValueChip label="borderRadius" value={String(tokens.borderRadius)} />
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {!compact && kit.assets && kit.assets.length > 0 ? (
            <section className={styles.section} aria-label={t('brandDetail.brandAssets')}>
              <h3 className={styles.sectionTitle}>{t('brandDetail.brandAssets')}</h3>
              <div className={styles.assets}>
                {kit.assets.map((a) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={a.kind}
                    className={styles.asset}
                    onClick={() => setAssetPreview({ url: a.url, label: a.label })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setAssetPreview({ url: a.url, label: a.label });
                      }
                    }}
                  >
                    <div className={styles.assetFrame}>
                      <iframe
                        src={a.url}
                        loading="lazy"
                        tabIndex={-1}
                        aria-hidden="true"
                        sandbox={DESIGN_KIT_PREVIEW_SANDBOX}
                        title={a.label}
                      />
                    </div>
                    <div className={styles.assetMeta}>
                      <span className={styles.assetName}>{a.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>

      {/* Overlays portal to <body> so their z-index resolves in the ROOT
          stacking context. Rendered inline, the DesignKitView host pane traps
          them in a lower stacking context and the chat composer (a root-level
          position:fixed layer) paints over them despite their higher z-index. */}
      {typeof document !== 'undefined'
        ? createPortal(
            <>
              {lightbox ? (
                <div
                  className={styles.lightbox}
                  role="dialog"
                  aria-modal="true"
                  aria-label={lightbox.caption}
                  onClick={() => setLightbox(null)}
                >
                  <button
                    type="button"
                    className={styles.lightboxClose}
                    onClick={() => setLightbox(null)}
                    aria-label={t('newBrand.close')}
                  >
                    <CloseGlyph />
                  </button>
                  <img
                    className={styles.lightboxImg}
                    src={lightbox.src}
                    alt={lightbox.caption}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : null}

              {assetPreview ? (
                <div
                  className={styles.assetModal}
                  role="dialog"
                  aria-modal="true"
                  aria-label={assetPreview.label}
                  onClick={() => setAssetPreview(null)}
                >
                  <div className={styles.assetModalPanel} onClick={(event) => event.stopPropagation()}>
                    <div className={styles.assetModalHeader}>
                      <h3>{assetPreview.label}</h3>
                      <button
                        type="button"
                        className={styles.assetModalClose}
                        onClick={() => setAssetPreview(null)}
                        aria-label={t('newBrand.close')}
                      >
                        <CloseGlyph />
                      </button>
                    </div>
                    <iframe
                      className={styles.assetModalFrame}
                      src={assetPreview.url}
                      title={assetPreview.label}
                      sandbox={DESIGN_KIT_PREVIEW_SANDBOX}
                    />
                  </div>
                </div>
              ) : null}

              {coverPreviewOpen && kit.showcaseHtml ? (
                <div
                  className={styles.assetModal}
                  role="dialog"
                  aria-modal="true"
                  aria-label={`${kit.name} preview`}
                  onClick={() => setCoverPreviewOpen(false)}
                >
                  <div className={styles.assetModalPanel} onClick={(event) => event.stopPropagation()}>
                    <div className={styles.assetModalHeader}>
                      <h3>{kit.name}</h3>
                      <button
                        type="button"
                        className={styles.assetModalClose}
                        onClick={() => setCoverPreviewOpen(false)}
                        aria-label={t('newBrand.close')}
                      >
                        <CloseGlyph />
                      </button>
                    </div>
                    <iframe
                      className={styles.assetModalFrame}
                      title={`${kit.name} preview`}
                      sandbox={DESIGN_KIT_PREVIEW_SANDBOX}
                      srcDoc={buildSrcdoc(kit.showcaseHtml)}
                    />
                  </div>
                </div>
              ) : null}

              {designMdOpen && designMd ? (
                <div
                  className={styles.assetModal}
                  role="dialog"
                  aria-modal="true"
                  aria-label="DESIGN.md"
                  onClick={() => setDesignMdOpen(false)}
                >
                  <div className={`${styles.assetModalPanel} ${styles.designMdModalPanel}`} onClick={(event) => event.stopPropagation()}>
                    <div className={styles.assetModalHeader}>
                      <h3>DESIGN.md</h3>
                      <button
                        type="button"
                        className={styles.assetModalClose}
                        onClick={() => setDesignMdOpen(false)}
                        aria-label={t('newBrand.close')}
                      >
                        <CloseGlyph />
                      </button>
                    </div>
                    <Textarea
                      className={styles.designMdTextarea}
                      value={designMdDraft}
                      onChange={(event) => setDesignMdDraft(event.target.value)}
                      rows={20}
                      spellCheck={false}
                      aria-label="DESIGN.md"
                    />
                    <div className={styles.designMdModalBar}>
                      <span>{t('ds.editingDesignMdHint')}</span>
                      <Button variant="primary" disabled={Boolean(designMd.saving)} onClick={() => void saveDesignMdDraft()}>
                        {designMd.saving ? t('ds.saving') : t('ds.saveDesignMd')}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

function normalizeColorInput(hex: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return '#000000';
}

function TokenChip({ label, hex }: { label: string; hex: string }) {
  return (
    <div className={styles.tok}>
      <span className={styles.tokSwatch} style={{ background: hex }} />
      <span className={styles.tokText}>
        <span className={styles.tokKey}>{label}</span>
        <span className={styles.tokHex}>{hex}</span>
      </span>
    </div>
  );
}

function ValueChip({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.tok}>
      <span className={styles.tokValue}>{value}</span>
      <span className={styles.tokKey}>{label}</span>
    </div>
  );
}

function ExternalGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden>
      <path
        d="M6 3.5h6.5V10M12.5 3.5L6.5 9.5M9 3.5H4.5a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ExpandGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden>
      <path
        d="M9.5 2.5H13.5V6.5M6.5 13.5H2.5V9.5M13.5 2.5L9 7M2.5 13.5L7 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
