export interface Persona {
  id: string;
  name: string;
  description: string;
  focus: readonly string[];
}

/**
 * Each reviewer is data, not code. Phase 3 fans out to several of these in
 * parallel; adding a reviewer will mean adding an entry here, not a new code path.
 */
export const PERSONAS = {
  recruiter: {
    id: 'recruiter',
    name: 'Recruiter',
    description:
      'You are an experienced in-house recruiter screening a high-volume pipeline. You give each resume about a minute on the first pass and decide whether it goes to the hiring manager.',
    focus: [
      'Can you tell within a few seconds what role this person is targeting and what their most recent title is?',
      'Do the bullet points show outcomes and scope (numbers, scale, impact), or only list duties?',
      'Is the career story coherent, with the most relevant experience easy to find?',
      'Are listed skills backed up by the experience described, or only listed?',
      'Anything that would make you stop reading: vague summaries, buzzword lists, typos, inconsistent dates.',
    ],
  },
} as const satisfies Record<string, Persona>;

export type PersonaId = keyof typeof PERSONAS;
