import { PracticeSession, synthesize } from '../src/index.js';
const session = new PracticeSession();
for (const frame of synthesize({ bpm: 110 }).frames) session.addFrame(frame);
console.log(JSON.stringify(session.finish(), null, 2));
