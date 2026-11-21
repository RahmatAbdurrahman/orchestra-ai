'use client';

import { FileImage, FileText, FileUp, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

const KNOWN_TYPES: Record<string, string> = {
  'application/pdf': 'PDF document',
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
};

/**
 * Click-or-drop file picker for a single file. It only selects the file: the caller uploads it,
 * and the server stays the authority on type and size.
 */
export function FileDropzone({
  file,
  onChange,
  accept,
  disabled,
  hint,
  testId,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  accept: string;
  disabled?: boolean;
  hint?: string;
  testId?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const typeLabel = file ? (KNOWN_TYPES[file.type] ?? (file.type || 'Unknown type')) : null;
  const recognised = file ? file.type in KNOWN_TYPES : true;
  const Icon = file?.type.startsWith('image/') ? FileImage : FileText;

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled) return;
          const dropped = event.dataTransfer.files?.[0];
          if (dropped) onChange(dropped);
        }}
        className={cn(
          'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-[border-color,background-color,transform] duration-200',
          'focus-within:border-ring focus-within:shadow-[var(--focus-ring)]',
          dragging ? 'scale-[1.01] border-primary bg-primary/6' : 'border-border-strong/70 hover:border-primary/50 hover:bg-muted/50',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground transition-[transform,color,background-color] duration-200',
            dragging ? '-translate-y-0.5 bg-primary/12 text-primary' : 'group-hover:text-primary',
          )}
        >
          <FileUp className="size-5" aria-hidden />
        </span>
        <span className="text-sm">
          <span className="font-medium text-primary">{dragging ? 'Drop the file here' : 'Choose a file'}</span>
          {dragging ? null : <span className="text-muted-foreground"> or drag it here</span>}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        <input
          ref={input}
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          disabled={disabled}
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
          data-testid={testId}
        />
      </label>

      {file ? (
        <div className="flex animate-fade-up items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5" aria-live="polite">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-card text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" title={file.name}>
              {file.name}
            </span>
            <span className="block text-xs text-muted-foreground">
              {typeLabel} · {formatBytes(file.size)}
            </span>
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              if (input.current) input.current.value = '';
            }}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:opacity-50"
            aria-label={`Remove ${file.name}`}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      {file && !recognised ? (
        <p className="animate-message-in text-xs text-warning-foreground" role="alert">
          This file type is not one of the accepted formats (PDF, PNG, JPEG); the upload will likely be rejected.
        </p>
      ) : null}
    </div>
  );
}
