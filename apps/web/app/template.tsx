'use client';

/**
 * Re-mounts on every navigation so the prototype's 150ms screen fade
 * (.screen.on animation) replays when switching overview ↔ detail.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="screen on">{children}</div>;
}
