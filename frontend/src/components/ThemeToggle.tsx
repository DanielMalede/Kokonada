import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

/** Three-way appearance control (Light / Dark / System) for the Settings page. */
export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid a hydration/first-paint mismatch: theme is undefined until mounted.
  useEffect(() => setMounted(true), []);

  return (
    <ToggleGroup
      type="single"
      value={mounted ? theme : undefined}
      onValueChange={(v) => v && setTheme(v)}
      variant="outline"
      spacing={0}
      className={cn('w-full', className)}
      aria-label="Theme"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          className="flex-1 gap-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          <Icon className="size-4" />
          <span className="text-sm">{label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
