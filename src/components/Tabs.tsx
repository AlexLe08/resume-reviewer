'use client';

import { useRef, type KeyboardEvent } from 'react';
import { nextTabIndex } from './tab-keys';

export type TabStatus = 'waiting' | 'running' | 'done' | 'error';

export interface TabItem<Id extends string> {
  id: Id;
  label: string;
  /** Work behind the tab, for tabs whose content arrives over time. Shown as a mark and spoken to screen readers. */
  status?: TabStatus;
}

const STATUS_TEXT: Record<TabStatus, string> = {
  waiting: 'waiting',
  running: 'in progress',
  done: 'ready',
  error: 'failed',
};

interface TabsProps<Id extends string> {
  /** Names the tab list for screen readers. */
  label: string;
  tabs: readonly TabItem<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
}

/**
 * A tab list. The caller renders the panels, each with id `panel-<id>` and
 * aria-labelledby `tab-<id>`, which is how the tabs here point at them.
 */
export function Tabs<Id extends string>({ label, tabs, selected, onSelect }: TabsProps<Id>) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextTabIndex(event.key, index, tabs.length);
    if (next === null) return;
    onSelect(tabs[next]!.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="modes">
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          ref={(el) => {
            tabRefs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={selected === tab.id}
          aria-controls={`panel-${tab.id}`}
          tabIndex={selected === tab.id ? 0 : -1}
          className="mode-tab"
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => handleKey(event, i)}
        >
          {tab.label}
          {tab.status && (
            <>
              <span className={`tab-status tab-status-${tab.status}`} aria-hidden="true">
                {tab.status === 'running' ? <span className="pending-dot" /> : tab.status === 'done' ? '✓' : tab.status === 'error' ? '!' : ''}
              </span>
              <span className="visually-hidden"> ({STATUS_TEXT[tab.status]})</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
