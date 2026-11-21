import * as LabelPrimitive from '@radix-ui/react-label';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cva, type VariantProps } from 'class-variance-authority';
import { Search } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- Card
export function Card({ className, interactive, ...props }: React.ComponentProps<'div'> & { interactive?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-xs',
        interactive && 'transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-px hover:border-border-strong hover:shadow-md',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 px-5 pt-5 pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('text-sm leading-5 font-semibold tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-[13px] leading-5 text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

// ---------------------------------------------------------------- Form controls
const fieldBase =
  'w-full min-w-0 rounded-md border border-input bg-card text-sm text-foreground shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-invalid:border-destructive aria-invalid:focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--destructive)_25%,transparent)]';

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(fieldBase, 'flex h-9 px-3 py-1 file:border-0 file:bg-transparent file:text-sm file:font-medium', className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldBase, 'flex min-h-20 px-3 py-2 leading-relaxed', className)} {...props} />;
}

export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        fieldBase,
        'flex h-9 cursor-pointer appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8 pl-3',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    />
  );
}

/** Search field with a leading icon. Pass the usual input props. */
export function SearchInput({ className, containerClassName, ...props }: React.ComponentProps<'input'> & { containerClassName?: string }) {
  return (
    <div className={cn('relative', containerClassName)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
      <Input type="search" className={cn('pl-9', className)} {...props} />
    </div>
  );
}

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-[13px] leading-none font-medium text-foreground select-none', className)} {...props} />;
}

/** Validation or help message under a field; animates in when it appears. */
export function FieldMessage({ className, tone = 'error', ...props }: React.ComponentProps<'p'> & { tone?: 'error' | 'hint' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={cn('animate-message-in text-xs', tone === 'error' ? 'text-destructive-foreground' : 'text-muted-foreground', className)}
      {...props}
    />
  );
}

export function Separator({ className, orientation = 'horizontal', ...props }: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative
      orientation={orientation}
      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--muted)_0%,color-mix(in_oklab,var(--muted)_55%,var(--card))_50%,var(--muted)_100%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------- Badge
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap transition-colors [&>svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-secondary-foreground',
        info: 'border-info/20 bg-info/10 text-info-foreground',
        primary: 'border-primary/20 bg-primary/10 text-primary dark:text-info-foreground',
        success: 'border-success/25 bg-success/10 text-success-foreground',
        warning: 'border-warning/30 bg-warning/12 text-warning-foreground',
        danger: 'border-destructive/25 bg-destructive/10 text-destructive-foreground',
        outline: 'border-border text-muted-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({ className, tone, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

// ---------------------------------------------------------------- Alert
const alertVariants = cva(
  'relative w-full animate-message-in rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:top-3.5 [&>svg]:left-4 [&>svg~*]:pl-7',
  {
    variants: {
      tone: {
        info: 'border-info/25 bg-info/6 [&>svg]:text-info-foreground',
        warning: 'border-warning/35 bg-warning/8 [&>svg]:text-warning-foreground',
        danger: 'border-destructive/30 bg-destructive/6 text-destructive-foreground',
        success: 'border-success/30 bg-success/6 [&>svg]:text-success-foreground',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

export function Alert({ className, tone, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ tone }), className)} {...props} />;
}

// ---------------------------------------------------------------- Table
export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="scrollbar-thin relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}
export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('bg-muted/50 [&_tr]:border-b [&_tr]:hover:bg-transparent', className)} {...props} />;
}
export function TBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}
export function TR({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr className={cn('border-b transition-colors duration-150 hover:bg-muted/50', className)} {...props} />;
}
export function TH({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-10 px-4 text-left align-middle text-2xs font-semibold tracking-wider whitespace-nowrap text-muted-foreground uppercase first:rounded-tl-xl last:rounded-tr-xl',
        className,
      )}
      {...props}
    />
  );
}
export function TD({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3 align-middle', className)} {...props} />;
}
