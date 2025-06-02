import { promises as fs } from 'fs';
import { join } from 'path';
import * as logging from 'projen/lib/logging';
import { exec, execCapture, execOrUndefined } from 'projen/lib/util';

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

  /**
   * If this is true, then commands will be printed and not executed
   *
   * @default false
   */
  readonly dryRun: boolean;
}

/**
 *
 *
 * @param cwd working directory (git repository)
 * @param options options
 */
export async function release(cwd: string, options: BumpOptions) {
  const releaseTagFile = join(
    cwd,
    options.releaseTagFile ?? 'dist/releasetag.txt',
  );

  const tagVersion = (await fs.readFile(releaseTagFile, 'utf-8')).trim();

  logging.info(`${releaseTagFile} has resolved version: ${tagVersion}`);
  logging.info(JSON.stringify(options));

  const [majorVersion, minorVersion] = tagVersion.split('.');

  const cmds = [
    `gh release create ${tagVersion} -R ${options.githubRepo} -F dist/changelog.md -t ${tagVersion} --target ${options.githubRef}`,
    tagCmd(options.githubRepo, majorVersion, cwd),
    tagCmd(options.githubRepo, `${majorVersion}.${minorVersion}`, cwd),
  ];
  if (options.dryRun) {
    cmds.forEach((cmd) => {
      logging.info(cmd);
    });
  } else {
    cmds.forEach((cmd) => {
      logging.info(cmd);
      exec(cmd, { cwd });
    });
  }
}

function tagCmd(repo: string, tagValue: string, cwd: string): string {
  if (tagExists(repo, tagValue, cwd)) {
    return updateTagCmd(repo, tagValue, cwd);
  }
  return createTagCmd(repo, tagValue, cwd);
}

function createTagCmd(repo: string, tagValue: string, cwd: string): string {
  const sha = getShaFromRef(repo, cwd);
  return [
    'gh api',
    '--method POST',
    '-H "Accept: application/vnd.github+json"',
    '-H "X-GitHub-Api-Version: 2022-11-28"',
    `/repos/${repo}/git/refs`,
    `-f ref='refs/tags/${tagValue}'`,
    `-f sha='${sha}'`,
  ].join(' ');
}

function updateTagCmd(repo: string, tagValue: string, cwd: string): string {
  const sha = getShaFromRef(repo, cwd);
  return [
    'gh api',
    '--method PATCH',
    '-H "Accept: application/vnd.github+json"',
    '-H "X-GitHub-Api-Version: 2022-11-28"',
    `/repos/${repo}/git/refs/tags/${tagValue}`,
    `-f sha='${sha}'`,
    '-F force=true',
  ].join(' ');
}

function getShaFromRef(repo: string, cwd: string): string {
  const shaCmd = [
    'gh api',
    '-H "Accept: application/vnd.github+json"',
    '-H "X-GitHub-Api-Version: 2022-11-28"',
    `/repos/${repo}/git/matching-refs/heads/main`,
  ].join(' ');
  const res = execCapture(shaCmd, { cwd }).toString('utf-8');
  const shaRes = JSON.parse(res);
  logging.info(res, shaRes);
  return shaRes[0].object.sha;
}

function tagExists(repo: string, tag: string, cwd: string): boolean {
  const cmd = [
    'gh api',
    '-H "Accept: application/vnd.github+json"',
    '-H "X-GitHub-Api-Version: 2022-11-28"',
    `/repos/${repo}/git/ref/tags/${tag}`,
  ].join(' ');
  const ok = execOrUndefined(cmd, { cwd });
  return ok != undefined;
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
