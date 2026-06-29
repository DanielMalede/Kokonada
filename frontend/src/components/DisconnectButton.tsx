import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useConnections, type DisconnectKind } from '@/hooks/useConnections';

const LABELS: Record<DisconnectKind, string> = {
  spotify: 'Spotify',
  youtube: 'YouTube Music',
  garmin: 'Garmin',
};

/**
 * "Disconnect" link that confirms before revoking a provider's connection.
 * Reused by the Integrations and Settings pages so the wording + behaviour match.
 */
export default function DisconnectButton({ kind }: { kind: DisconnectKind }) {
  const { disconnect } = useConnections();
  const label = LABELS[kind];

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          className="text-xs font-medium text-destructive hover:underline"
          aria-label={`Disconnect ${label}`}
        >
          Disconnect
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            You can reconnect any time — your taste profile is kept, so it’s instant.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => disconnect(kind)}>Disconnect</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
