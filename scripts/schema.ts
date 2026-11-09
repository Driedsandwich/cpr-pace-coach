import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { SessionResultSchema } from '../src/session.js';
const schema = { ...z.toJSONSchema(SessionResultSchema, { target: 'draft-2020-12' }),
  title: 'CPR practice session result',
  description: 'Practice-only measurements. Fractions range 0–1. Times in ms; pause endpoints relative to session start. See README for definitions. Cross-field arithmetic is validated by parseSessionResult.' };
await writeFile(new URL('../schema/session.schema.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n');
