import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpotifyAttribution from '../components/SpotifyAttribution';

describe('SpotifyAttribution', () => {
  it('renders the Spotify mark + link for a spotify:track: uri', () => {
    render(<SpotifyAttribution uri="spotify:track:4uLU6hMCjMI75M1A2tKUQC" />);
    const link = screen.getByRole('link', { name: /listen on spotify/i });
    expect(link).toHaveAttribute('href', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('img', { name: /spotify/i })).toBeInTheDocument();
  });

  it('renders nothing for a youtube_music track uri', () => {
    const { container } = render(<SpotifyAttribution uri="youtube_music:track:abc123" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an mbid-provider track (no spotify uri)', () => {
    const { container } = render(<SpotifyAttribution uri="mbid:00000000-0000-0000-0000-000000000000" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when uri is null/undefined and no recordingKey is given', () => {
    const { container: c1 } = render(<SpotifyAttribution uri={null} />);
    expect(c1).toBeEmptyDOMElement();
    const { container: c2 } = render(<SpotifyAttribution />);
    expect(c2).toBeEmptyDOMElement();
  });

  it('falls back to a bare 22-char recordingKey when no uri is given', () => {
    render(<SpotifyAttribution recordingKey="4uLU6hMCjMI75M1A2tKUQC" />);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    );
  });

  it('does not treat a non-track-id recordingKey (e.g. an mbid uuid) as a Spotify id', () => {
    const { container } = render(<SpotifyAttribution recordingKey="00000000-0000-0000-0000-000000000000" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('compact mode hides the "Listen on Spotify" label but keeps the mark + link', () => {
    render(<SpotifyAttribution uri="spotify:track:4uLU6hMCjMI75M1A2tKUQC" compact />);
    expect(screen.queryByText(/listen on spotify/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', expect.stringContaining('open.spotify.com/track/'));
  });

  it('stops click propagation so a parent row/button does not also navigate', () => {
    render(<SpotifyAttribution uri="spotify:track:4uLU6hMCjMI75M1A2tKUQC" />);
    const link = screen.getByRole('link');
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(evt, 'stopPropagation');
    link.dispatchEvent(evt);
    expect(stopSpy).toHaveBeenCalled();
  });
});
