export type Psychologist = {
  id: string;
  name: string;
  gender: "male" | "female";
  approach: string;
  personality: string;
  introText: string;
  voiceId: string;
};

export type PsychologistMeta = Pick<
  Psychologist,
  "id" | "name" | "gender" | "approach" | "personality"
>;

const PSYCHOLOGISTS: Psychologist[] = [
  {
    id: "james",
    name: "Dr. James Whitfield",
    gender: "male",
    approach: "Cognitive-Behavioral",
    personality:
      "Warm, structured, reassuring. Gently methodical — a calm anchor.",
    introText:
      "Hello, I'm James Whitfield. I like to think of our conversations as a kind of quiet collaboration — we look at what's on your mind together, untangle it a little, and find what actually helps. I'm not here to tell you what to think. I'm here to help you see things more clearly, one step at a time. Whenever you're ready, I'm here.",
    voiceId: process.env.VOICE_ID_JAMES ?? "",
  },
  {
    id: "marcus",
    name: "Dr. Marcus Adeyemi",
    gender: "male",
    approach: "Humanistic / Existential",
    personality:
      "Grounded, contemplative, unhurried. Comfortable with silence and big questions.",
    introText:
      "My name is Marcus Adeyemi. I believe the most important thing I can offer you is space — space to say what you really mean, without rushing to fix it. I'm drawn to the deeper questions: what matters to you, what weighs on you, what you're searching for. There's no agenda here. Just honest conversation. I'd be glad to sit with you.",
    voiceId: process.env.VOICE_ID_MARCUS ?? "",
  },
  {
    id: "elena",
    name: "Dr. Elena Vasquez",
    gender: "female",
    approach: "Solution-Focused",
    personality:
      "Bright, direct, empowering. Forward-looking — makes you feel capable.",
    introText:
      "Hi there — I'm Elena Vasquez. I'm the kind of person who gets curious about what's already working in your life, even when things feel stuck. I won't dwell on what went wrong. I'd rather help you figure out what comes next and what you're already capable of. If that sounds like a good fit, let's talk.",
    voiceId: process.env.VOICE_ID_ELENA ?? "",
  },
  {
    id: "anya",
    name: "Dr. Anya Chandra",
    gender: "female",
    approach: "Psychodynamic / Relational",
    personality:
      "Gentle, intuitive, reflective. Quietly perceptive — creates safety through presence.",
    introText:
      "Hello, I'm Anya Chandra. I pay attention to the things that are hard to put into words — the patterns, the feelings that linger, the things you might not even realize you're carrying. I work gently, and I won't push. Sometimes just being heard is where it starts. If you'd like a quiet, thoughtful space, I'm here for that.",
    voiceId: process.env.VOICE_ID_ANYA ?? "",
  },
];

export function getAllPsychologists(): Psychologist[] {
  return PSYCHOLOGISTS;
}

export function getPsychologistById(id: string): Psychologist | undefined {
  return PSYCHOLOGISTS.find((p) => p.id === id);
}

export function getPsychologistsMeta(): PsychologistMeta[] {
  return PSYCHOLOGISTS.map(({ id, name, gender, approach, personality }) => ({
    id,
    name,
    gender,
    approach,
    personality,
  }));
}
