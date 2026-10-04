// A stand-in for the adb binary, for lib/adb.mjs's tests: a real process with adb's shape.
//   [-s SERIAL] shell ...      prints {"serial", "args"} as JSON
//   [-s SERIAL] exec-out ...   writes the bytes 0..255, binary
//   [-s SERIAL] pull R L       writes "pulled R" into L
//   [-s SERIAL] logcat ...     prints three lines, then waits to be killed
//   [-s SERIAL] fail           exits 3 with "boom" on stderr
//   [-s SERIAL] slow           waits 10 s
import fs from 'node:fs';

const argv = process.argv.slice(2);
let serial = null;
if (argv[0] === '-s') { serial = argv[1]; argv.splice(0, 2); }
const [command, ...rest] = argv;

if (command === 'shell') process.stdout.write(JSON.stringify({ serial, args: argv }));
else if (command === 'exec-out') process.stdout.write(Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
else if (command === 'pull') fs.writeFileSync(rest[1], `pulled ${rest[0]}`);
else if (command === 'logcat') {
  const lines = ['first line', 'KOKONADA_LAB READY {"run":"r","seq":0}', 'third line'];
  lines.forEach((line, i) => setTimeout(() => process.stdout.write(`${line}\n`), 20 * (i + 1)));
  setInterval(() => {}, 1000);
} else if (command === 'fail') {
  process.stderr.write('boom');
  process.exitCode = 3;
} else if (command === 'slow') setTimeout(() => {}, 10000);
else {
  process.stderr.write(`fake adb: unknown command ${command}`);
  process.exitCode = 1;
}
