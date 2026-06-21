import { NavLink } from 'react-router-dom';
import { Home, ListMusic, Disc3, Compass, User, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import NowPlayingBar from './NowPlayingBar';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const MAIN: NavItem[] = [
  { to: '/app', label: 'Home', icon: Home },
  { to: '/now-playing', label: 'Now Playing', icon: Disc3 },
  { to: '/history', label: 'History', icon: ListMusic },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/profile', label: 'Profile', icon: User },
];

function Item({ to, label, icon: Icon }: NavItem) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        )
      }
    >
      <Icon className="size-5 shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

/** Persistent left navigation for tablet/desktop. Hidden on mobile. */
export default function DesktopSidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar px-4 py-6 md:flex">
      <div className="flex items-center gap-2 px-2 pb-4">
        <span className="grid size-8 place-items-center rounded-lg bg-linear-to-br from-emotion-focus to-emotion-unwind text-primary-foreground">
          <Disc3 className="size-5" />
        </span>
        <span className="font-display text-lg font-semibold text-sidebar-foreground">Kokonada</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {MAIN.map((item) => (
          <Item key={item.to} {...item} />
        ))}
      </nav>

      <NowPlayingBar className="mb-2" />
      <Item to="/settings" label="Settings" icon={Settings} />
    </aside>
  );
}
