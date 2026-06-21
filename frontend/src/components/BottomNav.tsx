import { NavLink } from 'react-router-dom';
import { Home, ListMusic, Disc3, Compass, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import NowPlayingBar from './NowPlayingBar';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  center?: boolean;
}

const ITEMS: NavItem[] = [
  { to: '/app', label: 'Home', icon: Home },
  { to: '/history', label: 'History', icon: ListMusic },
  { to: '/now-playing', label: 'Playing', icon: Disc3, center: true },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/profile', label: 'Profile', icon: User },
];

/** Floating pill navigation for mobile. Hidden on desktop (sidebar takes over). */
export default function BottomNav() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden">
      <NowPlayingBar className="pointer-events-auto w-full max-w-md" />
      <nav className="pointer-events-auto flex w-full max-w-md items-center justify-around rounded-full bg-card/85 px-2 py-2 ring-1 ring-foreground/10 backdrop-blur-xl shadow-xl">
        {ITEMS.map(({ to, label, icon: Icon, center }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 rounded-full px-3 py-1.5 transition-colors',
                center && 'relative',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'grid place-items-center transition-all',
                    center &&
                      'size-10 -translate-y-3 rounded-full bg-linear-to-br from-(--aura-a) to-(--aura-b) text-primary-foreground shadow-lg ring-4 ring-card',
                  )}
                >
                  <Icon className={cn(center ? 'size-5' : 'size-5', isActive && !center && 'scale-110')} />
                </span>
                <span className={cn('text-[10px] font-medium', center && '-mt-2')}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
