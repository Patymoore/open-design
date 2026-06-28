import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Excalidraw,
  convertToExcalidrawElements,
} from '@excalidraw/excalidraw';
import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { Button } from '@open-design/components';
import { useI18n, type Locale } from '../i18n';
import { Icon } from './Icon';
import { readDefaultSketchToolColor } from './sketch-colors';
import {
  emptySketchScene,
  sketchSceneHasContent,
  type ExcalidrawSketchScene,
  type SketchItem,
} from './sketch-model';

const SAVED_VISIBLE_MS = 2000;

interface SketchSceneChangeOptions {
  markDirty?: boolean;
  discardLegacyItems?: boolean;
}

interface Props {
  scene: ExcalidrawSketchScene;
  legacyItems?: SketchItem[];
  hasPreservedRawItems?: boolean;
  onSceneChange: (scene: ExcalidrawSketchScene, options?: SketchSceneChangeOptions) => void;
  onClear?: () => void;
  onSave: (scene?: ExcalidrawSketchScene) => Promise<boolean | void> | boolean | void;
  onCancel?: () => void;
  saving?: boolean;
  dirty?: boolean;
  fileName: string;
}

export function SketchEditor({
  scene,
  legacyItems = [],
  hasPreservedRawItems = false,
  onSceneChange,
  onClear,
  onSave,
  onCancel,
  saving = false,
  dirty = false,
  fileName,
}: Props) {
  const { t, locale } = useI18n();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const firstProgrammaticChangeRef = useRef(true);
  const [resetNonce, setResetNonce] = useState(0);
  const [showSaved, setShowSaved] = useState(false);
  const [theme, setTheme] = useState(readExcalidrawTheme);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    firstProgrammaticChangeRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      firstProgrammaticChangeRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fileName, resetNonce]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(readExcalidrawTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => clearTimeout(savedTimerRef.current);
  }, []);

  useEffect(() => {
    if (dirty) {
      clearTimeout(savedTimerRef.current);
      setShowSaved(false);
    }
  }, [dirty]);

  const initialData = useMemo<ExcalidrawInitialDataState>(() => {
    const convertedLegacyElements = legacyItems.length > 0
      ? convertLegacySketchItemsToExcalidrawElements(legacyItems)
      : null;
    const initialElements = convertedLegacyElements ?? scene.elements;
    return {
      elements: initialElements as ExcalidrawInitialDataState['elements'],
      appState: {
        ...(scene.appState ?? {}),
        name: fileName,
        currentItemStrokeColor: readDefaultSketchToolColor(),
        viewBackgroundColor: typeof scene.appState?.viewBackgroundColor === 'string'
          ? scene.appState.viewBackgroundColor
          : '#ffffff',
      } as ExcalidrawInitialDataState['appState'],
      files: scene.files as ExcalidrawInitialDataState['files'],
      scrollToContent: initialElements.length > 0,
    };
  }, [fileName, legacyItems, scene]);

  const handleChange = useCallback<NonNullable<ExcalidrawProps['onChange']>>((elements, appState, files) => {
    const nextScene = sceneFromExcalidraw(elements, appState, files);
    const isProgrammatic = firstProgrammaticChangeRef.current;
    onSceneChange(nextScene, {
      markDirty: !isProgrammatic,
      discardLegacyItems: !isProgrammatic,
    });
  }, [onSceneChange]);

  const currentScene = useCallback((): ExcalidrawSketchScene => {
    const api = apiRef.current;
    if (!api) return scene;
    return sceneFromExcalidraw(
      api.getSceneElementsIncludingDeleted(),
      api.getAppState(),
      api.getFiles(),
    );
  }, [scene]);

  const handleClear = useCallback(() => {
    if (onClear) {
      onClear();
    } else {
      onSceneChange(emptySketchScene(fileName), {
        markDirty: true,
        discardLegacyItems: true,
      });
    }
    setResetNonce((value) => value + 1);
  }, [fileName, onClear, onSceneChange]);

  const handleSave = useCallback(async () => {
    const ok = await onSave(currentScene());
    if (ok === false) {
      clearTimeout(savedTimerRef.current);
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setShowSaved(false), SAVED_VISIBLE_MS);
  }, [currentScene, onSave]);

  const canClear = sketchSceneHasContent(scene) || legacyItems.length > 0 || hasPreservedRawItems;
  const canSave = dirty || sketchSceneHasContent(scene) || legacyItems.length > 0 || hasPreservedRawItems;

  const renderTopRightUI = useCallback(() => (
    <div
      className="sketch-excalidraw-actions"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="sketch-name" title={fileName}>
        {fileName}
        {dirty ? ' *' : ''}
      </span>
      <Button variant="ghost" onClick={handleClear} disabled={!canClear}>
        {t('sketch.clear')}
      </Button>
      {onCancel ? (
        <Button variant="ghost" onClick={onCancel}>
          {t('sketch.close')}
        </Button>
      ) : null}
      <Button
        variant="primary"
        onClick={handleSave}
        disabled={saving || !canSave}
        aria-label={saving ? t('sketch.saving') : showSaved ? t('sketch.saved') : t('common.save')}
      >
        {saving ? t('sketch.saving') : showSaved ? <Icon name="check" size={14} /> : t('common.save')}
      </Button>
    </div>
  ), [canClear, canSave, dirty, fileName, handleClear, handleSave, onCancel, saving, showSaved, t]);

  return (
    <div className="sketch-editor">
      <div className="sketch-canvas-wrap sketch-excalidraw-wrap" data-testid="sketch-excalidraw-editor">
        <Excalidraw
          key={`${fileName}:${resetNonce}`}
          initialData={initialData}
          excalidrawAPI={(api) => {
            apiRef.current = api;
          }}
          onChange={handleChange}
          renderTopRightUI={renderTopRightUI}
          langCode={excalidrawLangCode(locale)}
          theme={theme}
          detectScroll={false}
          handleKeyboardGlobally={false}
          autoFocus
          name={fileName}
          UIOptions={{
            canvasActions: {
              saveToActiveFile: false,
              loadScene: false,
              toggleTheme: false,
              export: { saveFileToDisk: false },
            },
            tools: {
              image: true,
            },
          }}
        />
      </div>
    </div>
  );
}

function sceneFromExcalidraw(
  elements: readonly OrderedExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): ExcalidrawSketchScene {
  return {
    elements: cloneJson<unknown[]>(elements, []),
    appState: cloneJson<Record<string, unknown> | null>(appState as unknown, null),
    files: cloneJson<Record<string, unknown>>(files, {}),
  };
}

function convertLegacySketchItemsToExcalidrawElements(items: SketchItem[]): unknown[] {
  const skeletons: unknown[] = [];
  for (const item of items) {
    if (item.kind === 'rect') {
      const x = Math.min(item.x, item.x + item.w);
      const y = Math.min(item.y, item.y + item.h);
      skeletons.push({
        type: 'rectangle',
        x,
        y,
        width: Math.abs(item.w),
        height: Math.abs(item.h),
        strokeColor: item.color,
        backgroundColor: 'transparent',
        strokeWidth: item.size,
        roughness: 1,
      });
      continue;
    }
    if (item.kind === 'arrow') {
      skeletons.push({
        type: 'arrow',
        x: item.x1,
        y: item.y1,
        points: [[0, 0], [item.x2 - item.x1, item.y2 - item.y1]],
        strokeColor: item.color,
        backgroundColor: 'transparent',
        strokeWidth: item.size,
        endArrowhead: 'arrow',
        roughness: 1,
      });
      continue;
    }
    if (item.kind === 'text') {
      skeletons.push({
        type: 'text',
        x: item.x,
        y: item.y - item.size,
        text: item.text,
        fontSize: Math.max(12, item.size),
        strokeColor: item.color,
        backgroundColor: 'transparent',
      });
      continue;
    }
    if (item.points.length === 0) continue;
    const origin = item.points[0]!;
    skeletons.push({
      type: 'line',
      x: origin.x,
      y: origin.y,
      points: item.points.map((point) => [point.x - origin.x, point.y - origin.y]),
      strokeColor: item.color,
      backgroundColor: 'transparent',
      strokeWidth: item.size,
      roughness: 1,
    });
  }

  try {
    return convertToExcalidrawElements(skeletons as never[], { regenerateIds: true }) as unknown[];
  } catch {
    return [];
  }
}

function excalidrawLangCode(locale: Locale): string {
  const map: Record<Locale, string> = {
    'en': 'en',
    'id': 'id-ID',
    'de': 'de-DE',
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'pt-BR': 'pt-BR',
    'es-ES': 'es-ES',
    'ru': 'ru-RU',
    'fa': 'fa-IR',
    'ar': 'ar-SA',
    'ja': 'ja-JP',
    'ko': 'ko-KR',
    'pl': 'pl-PL',
    'hu': 'hu-HU',
    'fr': 'fr-FR',
    'uk': 'uk-UA',
    'tr': 'tr-TR',
    'th': 'en',
    'it': 'it-IT',
  };
  return map[locale] ?? 'en';
}

function readExcalidrawTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function cloneJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return fallback;
  }
}
