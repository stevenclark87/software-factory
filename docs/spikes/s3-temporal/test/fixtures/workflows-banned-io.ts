// Fixture: workflow code that imports a Node module (fs) and reads the wall clock with new Date().
import { readFileSync } from 'node:fs';


export async function bannedIoWorkflow(): Promise<string> {
  const size = readFileSync(__filename).length; // I/O inside a workflow
  return `size=${size} now=${new Date().getTime()}`;
}
