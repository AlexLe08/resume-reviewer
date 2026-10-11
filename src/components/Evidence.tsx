/** A quote from the resume: highlighted if it's really there, flagged if it isn't. */
export function Evidence({ text, found }: { text: string; found: boolean }) {
  if (!text) return null;
  if (found) {
    return (
      <blockquote className="evidence">
        <mark>{text}</mark>
      </blockquote>
    );
  }
  return (
    <blockquote className="evidence evidence-unverified">
      <span>{text}</span>
      <span className="evidence-note">
        This quote isn&apos;t in your resume word-for-word. Check the point against what you actually
        wrote.
      </span>
    </blockquote>
  );
}
