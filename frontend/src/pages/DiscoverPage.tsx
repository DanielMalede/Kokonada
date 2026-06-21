import { Compass } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';

export default function DiscoverPage() {
  return (
    <>
      <PageHeader title="Discover" />
      <EmptyState
        icon={Compass}
        title="Discover is coming soon"
        description="Curated mood mixes, friends’ sessions, and trending biometric playlists will live here."
        actionLabel="Back to dashboard"
        actionTo="/app"
      />
    </>
  );
}
