import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import PlaybackModeModal from '../components/PlaybackModeModal/PlaybackModeModal';

describe('PlaybackModeModal', () => {
  it('renders null when isOpen is false', () => {
    const { container } = render(
      <PlaybackModeModal isOpen={false} onClose={() => {}} onSelect={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onSelect with "live" when Listen Live is clicked', () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <PlaybackModeModal isOpen={true} onClose={() => {}} onSelect={onSelect} />
    );
    fireEvent.click(getByText(/Listen Live/i));
    expect(onSelect).toHaveBeenCalledWith('live');
  });

  it('calls onSelect with "export" when Export & Save is clicked', () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <PlaybackModeModal isOpen={true} onClose={() => {}} onSelect={onSelect} />
    );
    fireEvent.click(getByText(/Export & Save/i));
    expect(onSelect).toHaveBeenCalledWith('export');
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <PlaybackModeModal isOpen={true} onClose={onClose} onSelect={() => {}} />
    );
    fireEvent.click(getByText(/Cancel/i));
    expect(onClose).toHaveBeenCalled();
  });
});
