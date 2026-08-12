import { GitHub } from '@actions/github/lib/utils';

// @actions/github v9 no longer exports ./lib/context; derive the type from
// the main entry's `context` value instead.
type Context = typeof import('@actions/github').context;
import { PullRequestEvent } from '@octokit/webhooks-definitions/schema';

/**
 * GitHub's hard limit on the length of an issue/PR comment body. A request
 * with a longer body is rejected with a "body is too long" validation error.
 */
const GITHUB_MAX_COMMENT_LENGTH = 65536;

/**
 * Substituted for a stack's diff when the assembled comment would exceed
 * GitHub's size limit. Only the fenced diff block is replaced -- every other
 * part of the comment (hash marker, headers, destructive-change warnings,
 * commit footer) is preserved. The diff is the one unbounded part of a
 * comment, so it is what we drop; the full diff is always in the run logs.
 */
const DIFF_OMITTED_NOTICE = [
  '> [!NOTE]',
  "> This stack's diff was omitted because the comment would exceed GitHub's",
  `> ${GITHUB_MAX_COMMENT_LENGTH}-character limit. The full diff is in this job's GitHub Actions run logs.`,
];

/**
 * Replace every fenced ```shell diff block in `content` with a short pointer
 * to the run logs, leaving all other lines untouched. The diff is emitted as
 * three discrete array elements ("```shell", the diff payload, "```") by
 * AssemblyProcessor.formatStackComment, so matching the fence lines exactly
 * isolates the diff from the surrounding scaffolding.
 */
function omitDiffBlocks(content: string[]): string[] {
  const out: string[] = [];
  let inDiff = false;
  for (const line of content) {
    if (!inDiff && line === '```shell') {
      inDiff = true;
      out.push(...DIFF_OMITTED_NOTICE);
      continue;
    }
    if (inDiff) {
      if (line === '```') {
        inDiff = false;
      }
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Comments controls interacting with GitHub to make comments
 */
export class Comments {
  private readonly issueNumber: number;
  private readonly commitSha: string;
  constructor(
    private readonly octokit: InstanceType<typeof GitHub>,
    private readonly context: Context,
  ) {
    const payload = context.payload as PullRequestEvent;
    this.commitSha = payload.pull_request.head.sha;
    if (!payload.pull_request.number) {
      throw new Error('Cannot find PR number, is this from a pull request?');
    }
    this.issueNumber = this.context.payload.pull_request?.number!;
  }

  /**
   * Find the previous comment with the given hash
   *
   * @param hash the unique hash identifying the stage comment to look for
   * @returns the PR comment id or undefined if there is no previous comment
   */
  public async findPrevious(hash: string): Promise<number | undefined> {
    const comments = await this.octokit.rest.issues.listComments({
      ...this.context.repo,
      issue_number: this.issueNumber,
    });
    return comments.data.find((comment) => comment.body?.includes(hash))?.id;
  }

  /**
   * Whether a comment assembled from `content` fits within GitHub's size
   * limit with its diff intact. Drives the stage->per-stack split: a stage
   * comment that doesn't fit is posted as one comment per stack instead, so
   * every stack's diff gets its own budget before any diff is dropped.
   */
  public fits(hash: string, content: string[]): boolean {
    return this.compose(hash, content).length <= GITHUB_MAX_COMMENT_LENGTH;
  }

  /**
   * Assemble the comment body: hash marker first (so findPrevious always
   * matches even after a cut), then the content, then the commit footer.
   */
  private compose(hash: string, content: string[]): string {
    const footer = `_Generated for commit ${this.commitSha} at ${new Date().toISOString()}_`;
    return [
      `<!-- cdk diff action with hash ${hash} -->`,
      ...content,
      '',
      footer,
    ].join('\n');
  }

  /**
   * Build the body to post. If the full body fits, post it verbatim. If not,
   * drop the diff block(s) -- the only unbounded part -- and keep all the
   * surrounding text. As a last resort, when there is no diff to drop and the
   * body is still too long (e.g. a teardown with thousands of destructive-
   * change lines), hard-cut to fit; the hash marker is first, so it survives.
   */
  private buildBody(hash: string, content: string[]): string {
    const body = this.compose(hash, content);
    if (body.length <= GITHUB_MAX_COMMENT_LENGTH) {
      return body;
    }
    const trimmed = this.compose(hash, omitDiffBlocks(content));
    return trimmed.length <= GITHUB_MAX_COMMENT_LENGTH
      ? trimmed
      : trimmed.slice(0, GITHUB_MAX_COMMENT_LENGTH);
  }

  /**
   * Update an existing comment
   *
   * @param commentId the id of the comment to update
   * @param hash the unique hash identifying the stage comment to look for
   * @param content the content of the comment
   */
  public async updateComment(
    commentId: number,
    hash: string,
    content: string[],
  ) {
    await this.octokit.rest.issues.updateComment({
      ...this.context.repo,
      body: this.buildBody(hash, content),
      comment_id: commentId,
    });
  }

  /**
   * Create a new comment
   *
   * @param hash the unique hash identifying the stage comment to look for
   * @param content the content of the comment
   */
  public async createComment(hash: string, content: string[]) {
    await this.octokit.rest.issues.createComment({
      ...this.context.repo,
      body: this.buildBody(hash, content),
      issue_number: this.issueNumber,
    });
  }
}
