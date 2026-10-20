'use client';

import { DEMO_SAMPLES } from '@/lib/demo/catalog';

interface SamplePickerProps {
  selected: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}

/** The demo's sample resumes: the only ones with recorded model reviews. */
export function SamplePicker({ selected, onSelect, disabled }: SamplePickerProps) {
  return (
    <fieldset className="samples" disabled={disabled}>
      <legend>Try a sample resume</legend>
      <p className="samples-hint">The reviews for these are recorded from real model runs, so they appear in seconds.</p>
      <div className="samples-grid">
        {DEMO_SAMPLES.map((sample) => (
          <label key={sample.id} className="sample">
            <input
              type="radio"
              name="sample"
              value={sample.id}
              checked={selected === sample.id}
              onChange={() => onSelect(sample.id)}
              className="visually-hidden"
            />
            <span className="sample-title">{sample.title}</span>
            <span className="sample-blurb">{sample.blurb}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
