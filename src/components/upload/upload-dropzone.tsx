'use client';

import {
  AlertCircle,
  CheckCircle2,
  FileText,
  ImageIcon,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';
import { Button, IconButton } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/feedback';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import type { Dictionary } from '@/i18n';

/**
 * UploadDropzone — the visual foundation only.
 *
 * It renders states and reports the files a user chose. It deliberately does
 * **not** upload, store, validate a content type, enforce a size limit, or call
 * an API. Every one of those is a server-side decision: `SECURITY.md` section 6
 * is explicit that a client-side file check is a convenience and never the
 * boundary, so implementing one here would invite someone to trust it.
 *
 * The state is driven from outside (`state`, `progress`, `error`) so the
 * component stays a pure rendering of whatever the upload service reports.
 *
 * Mobile gets explicit "Take a photo" and "Choose file" buttons rather than a
 * drag target, because dragging does not exist on a phone (section 8).
 */

export type UploadState = 'idle' | 'uploading' | 'success' | 'error';

export type UploadDropzoneProps = {
  state?: UploadState;
  /** 0–100, shown while `state` is `uploading`. */
  progress?: number;
  /** Shown while `state` is `error`. */
  error?: string;
  disabled?: boolean;
  /** Passed straight to the input. Server-side validation is what counts. */
  accept?: string;
  multiple?: boolean;
  /** Human-readable hint: "PNG, JPG, SVG ou PDF — 10 Mo maximum". */
  hint?: ReactNode;
  onFilesSelected?: (files: File[]) => void;
  className?: string;
};

export function UploadDropzone({
  state = 'idle',
  progress,
  error,
  disabled = false,
  accept,
  multiple = false,
  hint,
  onFilesSelected,
  className,
}: UploadDropzoneProps) {
  const { t } = useDictionary();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const inert = disabled || state === 'uploading';

  function emit(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    onFilesSelected?.(Array.from(fileList));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (inert) return;
    emit(event.dataTransfer.files);
  }

  return (
    <div className={className}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!inert) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={cn(
          'flex min-h-40 flex-col items-center justify-center gap-3 rounded-md p-6 text-center',
          'border-2 border-dashed transition-colors duration-fast ease-out',
          'motion-reduce:transition-none',
          dragActive
            ? 'border-accent bg-accent-subtle'
            : state === 'error'
              ? 'border-status-negative bg-status-negative-subtle'
              : state === 'success'
                ? 'border-status-positive bg-status-positive-subtle'
                : 'border-border-strong bg-bg-subtle',
          // Disabled dims the frame, never the text. Fading a whole container
          // takes the explanation of *why* it is disabled down with it, and
          // that sentence is the one thing the user needs to read.
          inert && 'cursor-not-allowed',
          disabled && 'border-border bg-surface-sunken',
        )}
      >
        <UploadStateIcon state={state} dragActive={dragActive} />

        {state === 'uploading' ? (
          <div className="w-full max-w-64">
            <ProgressBar
              label={t.upload.uploading}
              {...(progress !== undefined ? { value: progress } : {})}
              showValue={progress !== undefined}
            />
          </div>
        ) : state === 'error' ? (
          <Text variant="body-sm" tone="danger" role="alert">
            {error ?? t.upload.failed}
          </Text>
        ) : state === 'success' ? (
          <Text variant="body-sm" tone="muted">
            {t.upload.received}
          </Text>
        ) : (
          <>
            <Text variant="body-sm" tone="muted" className="hidden sm:block">
              {t.upload.dropHere}
            </Text>

            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={inert}
                onClick={() => inputRef.current?.click()}
              >
                {t.upload.chooseFile}
              </Button>
              {/* `capture` opens the camera directly on a phone. */}
              <Button
                variant="ghost"
                size="sm"
                disabled={inert}
                className="sm:hidden"
                onClick={() => {
                  inputRef.current?.setAttribute('capture', 'environment');
                  inputRef.current?.click();
                }}
              >
                {t.upload.takePhoto}
              </Button>
            </div>

            {hint && (
              <Text variant="caption" tone="subtle">
                {hint}
              </Text>
            )}
          </>
        )}

        {/* The visible buttons are the control; this input is the mechanism
         * they drive. It is unreachable by keyboard and hidden from the
         * accessibility tree, so it is not announced as a second, unlabelled
         * file field sitting beside the one the user can actually see. */}
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          disabled={inert}
          multiple={multiple}
          {...(accept ? { accept } : {})}
          onChange={(event) => {
            emit(event.target.files);
            // Reset so choosing the same file twice still fires a change.
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function UploadStateIcon({
  state,
  dragActive,
}: {
  state: UploadState;
  dragActive: boolean;
}) {
  const className = 'size-7 shrink-0';

  if (state === 'uploading') {
    return (
      <Loader2
        className={cn(className, 'text-fg-muted animate-spin motion-reduce:animate-none')}
        aria-hidden="true"
      />
    );
  }
  if (state === 'success') {
    return (
      <CheckCircle2
        className={cn(className, 'text-status-positive')}
        aria-hidden="true"
      />
    );
  }
  if (state === 'error') {
    return (
      <AlertCircle className={cn(className, 'text-status-negative')} aria-hidden="true" />
    );
  }
  return (
    <Upload
      className={cn(className, dragActive ? 'text-accent' : 'text-fg-subtle')}
      aria-hidden="true"
    />
  );
}

/**
 * FileCard — one uploaded artwork.
 *
 * The V1 preview rule from ADR-011 lives here: a raster PNG or JPG shows a
 * thumbnail; **SVG and PDF get the file-card treatment with no preview**. That
 * is not a limitation to work around — rendering untrusted SVG is the attack
 * `SECURITY.md` section 6 is most concerned about, and a PDF thumbnail needs a
 * renderer we do not have.
 */
export type FileCardProps = {
  name: string;
  /** Bytes. Formatted for display only. */
  size?: number;
  contentType?: string;
  /** Only used when the type is previewable. */
  thumbnailSrc?: string;
  onRemove?: () => void;
  className?: string;
};

const PREVIEWABLE = ['image/png', 'image/jpeg', 'image/jpg'];

export function isPreviewable(contentType: string | undefined): boolean {
  return contentType !== undefined && PREVIEWABLE.includes(contentType.toLowerCase());
}

function formatBytes(bytes: number, t: Dictionary): string {
  if (bytes < 1024) return `${bytes} ${t.upload.bytes}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${t.upload.kilobytes}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${t.upload.megabytes}`;
}

export function FileCard({
  name,
  size,
  contentType,
  thumbnailSrc,
  onRemove,
  className,
}: FileCardProps) {
  const { t } = useDictionary();
  const previewable = isPreviewable(contentType);

  return (
    <div
      className={cn(
        'bg-surface border-border flex items-center gap-3 rounded-md border p-3',
        className,
      )}
    >
      <div className="bg-surface-sunken text-fg-subtle flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-sm">
        {previewable && thumbnailSrc ? (
          // A plain img: this is a blob or signed URL of unknown dimensions,
          // which is exactly the case next/image is not for.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailSrc} alt="" className="size-full object-cover" />
        ) : previewable ? (
          <ImageIcon className="size-5" aria-hidden="true" />
        ) : (
          <FileText className="size-5" aria-hidden="true" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Text variant="body-sm" clamp={1} className="font-medium">
          {name}
        </Text>
        <Text variant="caption" tone="subtle">
          {[contentType, size !== undefined ? formatBytes(size, t) : null]
            .filter(Boolean)
            .join(' · ')}
          {!previewable && contentType ? t.upload.noPreviewSuffix : ''}
        </Text>
      </div>

      {onRemove && (
        <IconButton
          label={`Retirer ${name}`}
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="shrink-0"
        >
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
