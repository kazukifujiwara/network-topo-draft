/** Process wiring for the pure runCli — kept thin (see run.ts). */
import { readFileSync } from 'node:fs';
import { runCli } from './run';

declare const __CLI_VERSION__: string | undefined;
const VERSION = typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : 'dev';

process.exitCode = runCli(
  process.argv.slice(2),
  {
    readFile: (path) => readFileSync(path, 'utf8'),
    stdout: (line) => process.stdout.write(line + '\n'),
    stderr: (line) => process.stderr.write(line + '\n'),
  },
  VERSION,
);
