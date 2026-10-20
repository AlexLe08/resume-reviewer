import { recordedOn } from '@/lib/demo/catalog';

/** Says plainly that the reviews were not generated just now. */
export function DemoBanner({ model }: { model: string | undefined }) {
  return (
    <p className="demo-banner" role="note">
      <strong>Demo.</strong> These reviews were recorded from one real run{model ? ` of ${model}` : ''} on {recordedOn()}. Nothing is being generated now.
      The parser view and checks are live. Run the app locally to review your own resume with a model.
    </p>
  );
}
