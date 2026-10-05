import ora from 'ora';
import { styleText } from 'node:util';

export { styleText };

export async function spin<T>(
  msg: string,
  doneMsg: string,
  task: () => Promise<T>
): Promise<T> {
  const spinner = ora({
    text: msg,
    stream: process.stderr,
    color: 'cyan',
  }).start();

  try {
    const result = await task();
    spinner.stopAndPersist({
      symbol: styleText('green', 'done'),
      text: styleText('green', ` ${doneMsg}`),
    });
    return result;
  } catch (err) {
    spinner.stopAndPersist({
      symbol: styleText('red', 'fail'),
      text: styleText('red', ` ${msg}`),
    });
    throw err;
  }
}
