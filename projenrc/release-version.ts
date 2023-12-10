import { promises as fs } from 'fs';
import { join } from 'path';
import * as logging from 'projen/lib/logging';
import { exec } from 'projen/lib/util';

export interface BumpOptions {
  /**
   * The name of the file which will include the release tag (a text file).
   *
   * Relative to cwd.
   *
   * @default 'dist/releasetag.txt'
   */
  readonly releaseTagFile?: string;

  /**
   * The github ref (branch or tag) that triggered the release.
   */
  readonly githubRef: string;

  /**
   * The github repository (e.g. "owner/repo").
   */
  readonly githubRepo: string;

  readonly dryRun: boolean;
}

/**
 *
 *
 * @param cwd working directory (git repository)
 * @param options options
 */
export async function release(cwd: string, options: BumpOptions) {
  const releaseTagFile = join(cwd, options.releaseTagFile ?? 'dist/releasetag.txt');

  const tagVersion = (await fs.readFile(releaseTagFile, 'utf-8')).trim();

  logging.info(
    `${releaseTagFile} has resolved version: ${tagVersion}`,
  );
  logging.info(JSON.stringify(options));

  const [majorVersion, minorVersion] = tagVersion.split('.');

  const cmds = [
    // `gh release create ${tagVersion} -R ${options.githubRepo} -F dist/changelog.md -t ${tagVersion} --target ${options.githubRef}`,
    createTagCmd(options.githubRepo, majorVersion, options.githubRef),
    createTagCmd(options.githubRepo, `${majorVersion}.${minorVersion}`, options.githubRef),
  ];
  if (options.dryRun) {
    cmds.forEach(cmd => {
      logging.info(cmd);
    });
  } else {
    cmds.forEach(cmd => {
      logging.info(cmd);
      exec(cmd, { cwd });
    });
  }
}

function createTagCmd(repo: string, tagValue: string, ref: string): string {
  return [
    'gh api',
    '--method POST',
    '-H "Accept: application/vnd.github+json"',
    '-H "X-GitHub-Api-Version: 2022-11-28"',
    `/repos/${repo}/git/refs`,
    `-f ref='refs/tags/${tagValue}'`,
    `-f sha='${ref}'`,
    '-F force=true',
  ].join(' ');
}

const releaseTagFile = process.env.RELEASETAG;
const githubRepo = process.env.GITHUB_REPOSITORY;
const githubRef = process.env.GITHUB_REF;
const dryRun = process.env.RELEASE_DRY_RUN;

if (!githubRepo) {
  throw new Error('GITHUB_REPOSITORY is required');
}

if (!githubRef) {
  throw new Error('GITHUB_REF is required');
}

const opts: BumpOptions = {
  dryRun: dryRun === 'true',
  releaseTagFile,
  githubRef,
  githubRepo,
};
logging.debug(opts);

release(process.cwd(), opts).catch((e: Error) => {
  console.log(e.stack);
  process.exit(1);
});
