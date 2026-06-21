import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
  className?: string;
}

/** Friendly empty/zero-data placeholder with an optional call to action. */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
  className,
}: Props) {
  const navigate = useNavigate();
  const handle = () => {
    if (onAction) onAction();
    else if (actionTo) navigate(actionTo);
  };

  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      <div className="grid size-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
        <Icon className="size-6" />
      </div>
      <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
      <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
      {actionLabel && (
        <Button onClick={handle} className="mt-2 h-10 rounded-full px-5">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
