import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  subtitle?: string;
  back?: boolean;
  action?: ReactNode;
  className?: string;
}

/** Sticky page header with optional back affordance and a trailing action slot. */
export default function PageHeader({ title, subtitle, back, action, className }: Props) {
  const navigate = useNavigate();

  return (
    <header
      className={cn(
        'sticky top-0 z-20 -mx-4 mb-5 flex items-center gap-3 border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-xl md:-mx-8 md:px-8',
        className,
      )}
    >
      {back && (
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
